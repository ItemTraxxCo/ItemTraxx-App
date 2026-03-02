import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { withTimeout } from "./asyncUtils";

type CheckoutReturnPayload = {
  student_id: string;
  gear_barcodes: string[];
  action_type: "checkout" | "return" | "auto" | "admin_return";
};

type SubmitCheckoutReturnResult = {
  buffered: boolean;
  queuedCount: number;
};

type BufferedCheckoutItem = {
  id: string;
  payload: CheckoutReturnPayload;
  created_at: string;
  attempts: number;
  last_error: string | null;
};

const LOOKUP_TIMEOUT_MS = 7000;
const OFFLINE_QUEUE_KEY = "itemtraxx:checkout-offline-buffer:v1";

const isRetryableNetworkFailure = (status: number, message: string) => {
  if (status === 0) return true;
  const normalized = message.toLowerCase();
  return normalized.includes("network request failed") || normalized.includes("timed out");
};

const readOfflineQueue = (): BufferedCheckoutItem[] => {
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as BufferedCheckoutItem[];
  } catch {
    return [];
  }
};

const writeOfflineQueue = (items: BufferedCheckoutItem[]) => {
  try {
    window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage failures so checkout path never crashes.
  }
};

const queueCheckoutPayload = (payload: CheckoutReturnPayload, error: string | null = null) => {
  const queue = readOfflineQueue();
  const item: BufferedCheckoutItem = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `queued-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    payload,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: error,
  };
  queue.push(item);
  writeOfflineQueue(queue);
  return queue.length;
};

const executeCheckoutReturn = async (payload: CheckoutReturnPayload) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session ?? null;

  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }

  const result = await invokeEdgeFunction("checkoutReturn", {
    method: "POST",
    body: payload,
    accessToken: session.access_token,
  });

  if (!result.ok) {
    if (result.status === 429) {
      throw new Error("Rate limit exceeded, please try again in a minute.");
    }
    throw new Error(result.error || "Request failed.");
  }
};

export const submitCheckoutReturn = async (
  payload: CheckoutReturnPayload
): Promise<SubmitCheckoutReturnResult> => {
  try {
    await executeCheckoutReturn(payload);
    return { buffered: false, queuedCount: readOfflineQueue().length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    if (isRetryableNetworkFailure(0, message)) {
      const queuedCount = queueCheckoutPayload(payload, message);
      return { buffered: true, queuedCount };
    }
    throw error;
  }
};

export const getBufferedCheckoutCount = () => readOfflineQueue().length;

export const syncBufferedCheckoutQueue = async () => {
  const queue = readOfflineQueue();
  if (queue.length === 0) {
    return { processed: 0, failed: 0, remaining: 0 };
  }

  let processed = 0;
  let failed = 0;
  const remaining: BufferedCheckoutItem[] = [];

  for (const item of queue) {
    try {
      await executeCheckoutReturn(item.payload);
      processed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Request failed.";
      // Keep retryable network failures in the buffer, drop permanent authorization/policy failures.
      if (isRetryableNetworkFailure(0, message)) {
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          last_error: message,
        });
      }
    }
  }

  writeOfflineQueue(remaining);
  return {
    processed,
    failed,
    remaining: remaining.length,
  };
};

export type StudentSummary = {
  id: string;
  username: string;
  student_id: string;
};

export type GearSummary = {
  id: string;
  name: string;
  barcode: string;
  status: string;
};

export const fetchGearByBarcode = async (barcode: string) => {
  const { data, error } = await withTimeout(
    supabase
      .from("gear")
      .select("id, name, barcode, status")
      .eq("barcode", barcode)
      .is("deleted_at", null)
      .single(),
    LOOKUP_TIMEOUT_MS,
    "Barcode lookup timed out."
  );

  if (error) {
    throw new Error("Invalid barcode.");
  }

  return data as GearSummary;
};

export const fetchStudentByStudentId = async (studentId: string) => {
  const { data, error } = await withTimeout(
    supabase
      .from("students")
      .select("id, username, student_id")
      .eq("student_id", studentId)
      .is("deleted_at", null)
      .single(),
    LOOKUP_TIMEOUT_MS,
    "Student lookup timed out."
  );

  if (error) {
    throw new Error("Student not found.");
  }

  return data as StudentSummary;
};

export const fetchCheckedOutGear = async (studentUuid: string) => {
  const { data, error } = await withTimeout(
    supabase
      .from("gear")
      .select("id, name, barcode, status")
      .eq("checked_out_by", studentUuid)
      .is("deleted_at", null),
    LOOKUP_TIMEOUT_MS,
    "Checked out items lookup timed out."
  );

  if (error) {
    throw new Error("Unable to load items.");
  }

  return (data ?? []) as GearSummary[];
};
