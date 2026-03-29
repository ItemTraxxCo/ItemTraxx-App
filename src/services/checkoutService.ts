import { authenticatedSelect } from "./authenticatedDataClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { withTimeout } from "./asyncUtils";
import { edgeFunctionError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";

type CheckoutReturnPayload = {
  student_id: string;
  gear_barcodes: string[];
  action_type: "checkout" | "return" | "auto" | "admin_return";
  device_id?: string;
  device_label?: string;
};

type SubmitCheckoutReturnResult = {
  buffered: boolean;
  queuedCount: number;
};

type CheckoutReturnResponse = {
  success: boolean;
  processed: number;
  skipped_barcodes?: string[];
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
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<CheckoutReturnResponse>("checkoutReturn", {
    method: "POST",
    body: {
      ...payload,
      device_id: deviceId,
      device_label: deviceLabel,
    },
  });

  if (!result.ok) {
    if (result.status === 429) {
      throw new Error("Rate limit exceeded, please try again in a minute.");
    }
    throw edgeFunctionError(result, "Request failed.");
  }

  const skippedBarcodes = result.data?.skipped_barcodes ?? [];
  if (skippedBarcodes.length > 0) {
    const label =
      skippedBarcodes.length === 1
        ? `Item ${skippedBarcodes[0]} is already checked out or no longer available.`
        : `${skippedBarcodes.length} item(s) are already checked out or no longer available.`;
    throw new Error(`${label} Refresh and try again.`);
  }

  return result.data;
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
  const rows = await withTimeout(
    authenticatedSelect<GearSummary[]>("gear", {
      select: "id,name,barcode,status",
      barcode: `eq.${barcode}`,
      deleted_at: "is.null",
      limit: "1",
    }),
    LOOKUP_TIMEOUT_MS,
    "Barcode lookup timed out."
  );

  if (!rows?.length) {
    throw new Error("Invalid barcode.");
  }

  return rows[0] as GearSummary;
};

export const fetchStudentByStudentId = async (studentId: string) => {
  const rows = await withTimeout(
    authenticatedSelect<StudentSummary[]>("students", {
      select: "id,username,student_id",
      student_id: `eq.${studentId}`,
      deleted_at: "is.null",
      limit: "1",
    }),
    LOOKUP_TIMEOUT_MS,
    "Student lookup timed out."
  );

  if (!rows?.length) {
    throw new Error("Student not found.");
  }

  return rows[0] as StudentSummary;
};

export const fetchCheckedOutGear = async (studentUuid: string) => {
  const rows = await withTimeout(
    authenticatedSelect<GearSummary[]>("gear", {
      select: "id,name,barcode,status",
      checked_out_by: `eq.${studentUuid}`,
      deleted_at: "is.null",
    }),
    LOOKUP_TIMEOUT_MS,
    "Checked out items lookup timed out."
  );

  return (rows ?? []) as GearSummary[];
};
