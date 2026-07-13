import { authenticatedSelect } from "./authenticatedDataClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { withTimeout } from "./asyncUtils";
import { edgeFunctionError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  ensureCheckoutOperationId,
  queueCheckoutPayload,
  readOfflineQueue,
  withOfflineQueueLock,
  writeOfflineQueue,
  type BufferedCheckoutItem,
  type CheckoutReturnPayload,
} from "./offlineCheckoutQueue";

export { consumeCheckoutOfflineWarning, getBufferedCheckoutCount } from "./offlineCheckoutQueue";
export type { CheckoutReturnPayload } from "./offlineCheckoutQueue";

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

const LOOKUP_TIMEOUT_MS = 7000;

const isRetryableNetworkFailure = (status: number, message: string) => {
  if (status === 0) return true;
  const normalized = message.toLowerCase();
  return normalized.includes("network request failed") || normalized.includes("timed out");
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
    throw edgeFunctionError(result, "Request failed. Please contact support.");
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
  const payloadWithOperationId = ensureCheckoutOperationId(payload);
  try {
    await executeCheckoutReturn(payloadWithOperationId);
    return {
      buffered: false,
      queuedCount: await withOfflineQueueLock(async () => (await readOfflineQueue()).length),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    if (isRetryableNetworkFailure(0, message)) {
      if (navigator.onLine) {
        try {
          await executeCheckoutReturn(payloadWithOperationId);
          return {
            buffered: false,
            queuedCount: await withOfflineQueueLock(async () => (await readOfflineQueue()).length),
          };
        } catch (retryError) {
          throw retryError;
        }
      }
      const queuedCount = await queueCheckoutPayload(payloadWithOperationId, message);
      return { buffered: true, queuedCount };
    }
    throw error;
  }
};

export const syncBufferedCheckoutQueue = async () =>
  withOfflineQueueLock(async () => {
    const queue = await readOfflineQueue();
    if (queue.length === 0) {
      return { processed: 0, failed: 0, remaining: 0 };
    }

    let processed = 0;
    let failed = 0;
    const remaining: BufferedCheckoutItem[] = [];

    for (const item of queue) {
      const payload = ensureCheckoutOperationId(item.payload);
      try {
        await executeCheckoutReturn(payload);
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Request failed.";
        if (isRetryableNetworkFailure(0, message)) {
          remaining.push({
            ...item,
            payload,
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
  });

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
    "Unable to connect to ItemTraxx servers. Please check your internet connection and try again."
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
    "Unable to connect to ItemTraxx servers. Please check your internet connection and try again."
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
    "Unable to connect to ItemTraxx servers. Please check your internet connection and try again."
  );

  return (rows ?? []) as GearSummary[];
};
