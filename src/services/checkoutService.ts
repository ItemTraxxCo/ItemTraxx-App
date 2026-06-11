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
  error?: string;
  message?: string;
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
const OFFLINE_QUEUE_KEY_VERSION = "itemtraxx:checkout-offline-buffer:key:v1";
const OFFLINE_QUEUE_ALGO = "AES-GCM";
let offlineQueueWarning: string | null = null;

const isRetryableNetworkFailure = (status: number, message: string) => {
  if (status === 0) return true;
  const normalized = message.toLowerCase();
  return normalized.includes("network request failed") || normalized.includes("timed out");
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return window.btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const buildFallbackCryptoKey = () => {
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();
  return bytesToBase64(encoder.encode(seed));
};

const getOrCreateOfflineQueueKey = async () => {
  let serialized = window.sessionStorage.getItem(OFFLINE_QUEUE_KEY_VERSION);
  if (!serialized) {
    const key = await window.crypto.subtle.generateKey(
      {
        name: OFFLINE_QUEUE_ALGO,
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
    const exported = await window.crypto.subtle.exportKey("raw", key);
    serialized = bytesToBase64(new Uint8Array(exported));
    window.sessionStorage.setItem(OFFLINE_QUEUE_KEY_VERSION, serialized);
  }

  try {
    return window.crypto.subtle.importKey(
      "raw",
      base64ToBytes(serialized),
      OFFLINE_QUEUE_ALGO,
      false,
      ["encrypt", "decrypt"]
    );
  } catch {
    const fallback = buildFallbackCryptoKey();
    window.sessionStorage.setItem(OFFLINE_QUEUE_KEY_VERSION, fallback);
    return window.crypto.subtle.importKey(
      "raw",
      base64ToBytes(fallback),
      OFFLINE_QUEUE_ALGO,
      false,
      ["encrypt", "decrypt"]
    );
  }
};

const encryptOfflineQueue = async (items: BufferedCheckoutItem[]) => {
  const key = await getOrCreateOfflineQueueKey();
  const encoder = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const payload = encoder.encode(JSON.stringify(items));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: OFFLINE_QUEUE_ALGO, iv },
    key,
    payload
  );
  return JSON.stringify({
    version: 1,
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(encrypted)),
  });
};

const decryptOfflineQueue = async (raw: string) => {
  const parsed = JSON.parse(raw) as { iv?: string; cipher?: string; version?: number };
  if (parsed.version !== 1 || !parsed.iv || !parsed.cipher) {
    throw new Error("invalid-offline-queue");
  }
  const key = await getOrCreateOfflineQueueKey();
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: OFFLINE_QUEUE_ALGO,
      iv: base64ToBytes(parsed.iv),
    },
    key,
    base64ToBytes(parsed.cipher)
  );
  const decoder = new TextDecoder();
  const payload = decoder.decode(decrypted);
  const queue = JSON.parse(payload) as unknown;
  if (!Array.isArray(queue)) {
    throw new Error("invalid-offline-queue");
  }
  return queue as BufferedCheckoutItem[];
};

const markOfflineQueueCorrupted = () => {
  window.localStorage.removeItem(OFFLINE_QUEUE_KEY);
  offlineQueueWarning =
    "Buffered transaction cache was reset because local data could not be verified. Please retry failed requests.";
};

export const consumeCheckoutOfflineWarning = () => {
  const warning = offlineQueueWarning;
  offlineQueueWarning = null;
  return warning;
};

const readLegacyOfflineQueue = (): BufferedCheckoutItem[] => {
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as BufferedCheckoutItem[];
    }
    if (parsed && typeof parsed === "object" && "cipher" in parsed) {
      return [];
    }
    return [];
  } catch {
    return [];
  }
};

const readOfflineQueue = async () => {
  const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [] as BufferedCheckoutItem[];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const migrated = parsed as BufferedCheckoutItem[];
      await writeOfflineQueue(migrated);
      return migrated;
    }
    if (parsed && typeof parsed === "object" && "cipher" in parsed) {
      return await decryptOfflineQueue(raw);
    }
  } catch {
    markOfflineQueueCorrupted();
  }

  return readLegacyOfflineQueue();
};

const writeOfflineQueue = async (items: BufferedCheckoutItem[]) => {
  try {
    const encrypted = await encryptOfflineQueue(items);
    window.localStorage.setItem(OFFLINE_QUEUE_KEY, encrypted);
  } catch {
    // Ignore storage failures so checkout path never crashes.
  }
};

const queueCheckoutPayload = async (payload: CheckoutReturnPayload, error: string | null = null) => {
  const queue = await readOfflineQueue();
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
  await writeOfflineQueue(queue);
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

  if (result.data && result.data.success === false) {
    throw new Error(result.data.error || result.data.message || "Request failed.");
  }

  return result.data;
};

export const submitCheckoutReturn = async (
  payload: CheckoutReturnPayload
): Promise<SubmitCheckoutReturnResult> => {
  try {
    await executeCheckoutReturn(payload);
    return { buffered: false, queuedCount: (await readOfflineQueue()).length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    if (isRetryableNetworkFailure(0, message)) {
      if (navigator.onLine) {
        try {
          await executeCheckoutReturn(payload);
          return { buffered: false, queuedCount: (await readOfflineQueue()).length };
        } catch (retryError) {
          throw retryError;
        }
      }
      const queuedCount = await queueCheckoutPayload(payload, message);
      return { buffered: true, queuedCount };
    }
    throw error;
  }
};

export const getBufferedCheckoutCount = async () => (await readOfflineQueue()).length;

export const syncBufferedCheckoutQueue = async () => {
  const queue = await readOfflineQueue();
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

  await writeOfflineQueue(remaining);
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
  const result = await withTimeout(
    invokeEdgeFunction<{ data: StudentSummary }, { student_id: string }>(
      "checkout-borrower-lookup",
      {
        method: "POST",
        body: { student_id: studentId },
      },
    ),
    LOOKUP_TIMEOUT_MS,
    "Borrower lookup timed out."
  );

  if (!result.ok || !result.data?.data) {
    throw edgeFunctionError(result, "Borrower not found.");
  }

  return result.data.data;
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
