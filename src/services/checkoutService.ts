import { authenticatedSelect } from "./authenticatedDataClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { withTimeout } from "./asyncUtils";
import { AppError, edgeFunctionError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  ensureCheckoutOperationId,
  readOfflineQueue,
  withOfflineQueueLock,
  writeOfflineQueue,
  type BufferedCheckoutItem,
  type CheckoutReturnPayload,
} from "./offlineCheckoutQueue";
import {
  applyConfirmedTransactionToOfflinePack,
  findOfflineBorrower,
  findOfflineItem,
  getOfflineCheckedOutItems,
  getOfflineWorkflowSummary,
  queueOfflineOperation,
  refreshOfflineCheckoutPackIfNeeded,
  syncOfflineCheckoutLedger,
  type OfflinePackBorrower,
  type OfflinePackItem,
} from "./offlineCheckoutWorkflow";
import { getAuthState } from "../store/authState";
import {
  isServerUnreachableStatus,
  markItemTraxxServerConfirmed,
  markItemTraxxServerUnreachable,
} from "./offlineConnectionState";

export { consumeCheckoutOfflineWarning } from "./offlineCheckoutQueue";
export type { CheckoutReturnPayload } from "./offlineCheckoutQueue";

type SubmitCheckoutReturnResult = {
  buffered: boolean;
  queuedCount: number;
};

export type OfflineSubmitContext = {
  borrower: OfflinePackBorrower | null;
  items: Array<{ item: OfflinePackItem; intent: "checkout" | "return" | "quick_return" }>;
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

class CheckoutRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: CheckoutReturnResponse | null,
  ) {
    super(message);
  }
}

const isQueueableFailure = (error: unknown) => {
  if (error instanceof CheckoutRequestError) {
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message : "";
  return isRetryableNetworkFailure(0, message);
};

const recordCheckoutResponse = (ok: boolean, status: number) => {
  if (ok) markItemTraxxServerConfirmed();
  else if (isServerUnreachableStatus(status)) markItemTraxxServerUnreachable();
};

const isLookupConnectivityFailure = (error: unknown) => {
  if (error instanceof AppError) return error.code === "NETWORK" || error.code === "TIMEOUT" || error.status === 0;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return error instanceof TypeError || message.includes("network") || message.includes("timed out") || message.includes("unable to connect");
};

const getOfflineScope = () => {
  const auth = getAuthState();
  if (!auth.workspaceContextId || !auth.userId) throw new Error("A workspace session is required.");
  return { workspaceId: auth.workspaceContextId, profileId: auth.userId };
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

  recordCheckoutResponse(result.ok, result.status);

  if (!result.ok) {
    const message = result.status === 429
      ? "Rate limit exceeded, please try again in a minute."
      : edgeFunctionError(result, "Request failed. Please contact support.").message;
    throw new CheckoutRequestError(message, result.status, result.data);
  }

  const skippedBarcodes = result.data?.skipped_barcodes ?? [];
  if (skippedBarcodes.length > 0) {
    const label =
      skippedBarcodes.length === 1
        ? `Item ${skippedBarcodes[0]} is already checked out or no longer available.`
        : `${skippedBarcodes.length} item(s) are already checked out or no longer available.`;
    throw new CheckoutRequestError(`${label} Refresh and try again.`, 409, result.data);
  }

  if (result.data && result.data.success === false) {
    throw new CheckoutRequestError(result.data.error || result.data.message || "Request failed.", 409, result.data);
  }

  return result.data;
};

export const submitCheckoutReturn = async (
  payload: CheckoutReturnPayload,
  offlineContext?: OfflineSubmitContext,
): Promise<SubmitCheckoutReturnResult> => {
  const payloadWithOperationId = ensureCheckoutOperationId(payload);
  try {
    await executeCheckoutReturn(payloadWithOperationId);
    if (offlineContext) await applyConfirmedTransactionToOfflinePack(offlineContext);
    void refreshOfflineCheckoutPackIfNeeded({ force: true }).catch(() => undefined);
    return {
      buffered: false,
      queuedCount: await withOfflineQueueLock(async () => (await readOfflineQueue()).length),
    };
  } catch (error) {
    if (isQueueableFailure(error)) {
      if (navigator.onLine) {
        try {
          await executeCheckoutReturn(payloadWithOperationId);
          if (offlineContext) await applyConfirmedTransactionToOfflinePack(offlineContext);
          void refreshOfflineCheckoutPackIfNeeded({ force: true }).catch(() => undefined);
          return {
            buffered: false,
            queuedCount: await withOfflineQueueLock(async () => (await readOfflineQueue()).length),
          };
        } catch (retryError) {
          if (!isQueueableFailure(retryError)) throw retryError;
        }
      }
      if (!offlineContext || !payloadWithOperationId.operation_id) {
        throw new Error("Offline checkout is unavailable for this transaction. Reconnect and prepare this device for offline use.");
      }
      const queuedCount = await queueOfflineOperation({
        operationId: payloadWithOperationId.operation_id,
        borrower: offlineContext.borrower,
        items: offlineContext.items,
      });
      return { buffered: true, queuedCount };
    }
    throw error;
  }
};

export const syncBufferedCheckoutQueue = async () => {
  const auth = getAuthState();
  if (!auth.isAuthenticated || !auth.workspaceContextId || !auth.userId) {
    // Checkout can mount while auth is still settling (for example after a
    // session expires). Preserve the local queue and wait for the next session
    // or online event instead of starting a scope-dependent sync that throws.
    return { processed: 0, failed: 0, remaining: 0, review: 0 };
  }

  const workflow = await syncOfflineCheckoutLedger();
  const legacy = await withOfflineQueueLock(async () => {
    const queue = await readOfflineQueue();
    if (queue.length === 0) {
      return { processed: 0, failed: 0, remaining: 0 };
    }

    let processed = 0;
    let failed = 0;
    const remaining: BufferedCheckoutItem[] = [];

    for (const item of queue) {
      const payload = ensureCheckoutOperationId(item.payload);
      if (payload.action_type === "auto") {
        failed += 1;
        remaining.push({ ...item, payload, last_error: "Legacy automatic transaction needs manual review before replay." });
        continue;
      }
      try {
        await executeCheckoutReturn(payload);
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Request failed.";
        remaining.push({
          ...item,
          payload,
          attempts: item.attempts + 1,
          last_error: message,
        });
      }
    }

    await writeOfflineQueue(remaining);
    return {
      processed,
      failed,
      remaining: remaining.length,
    };
  });
  return {
    processed: workflow.processed + legacy.processed,
    failed: workflow.failed + legacy.failed,
    remaining: workflow.remaining + legacy.remaining,
    review: workflow.review,
  };
};

export type BorrowerSummary = {
  id: string;
  username: string;
  borrower_id: string;
};

export type ItemSummary = {
  id: string;
  name: string;
  barcode: string;
  status: string;
  checked_out_by?: string | null;
};

export const fetchItemByBarcode = async (barcode: string) => {
  if (!navigator.onLine) {
    markItemTraxxServerUnreachable();
    const offline = await findOfflineItem(getOfflineScope(), barcode);
    if (!offline) throw new Error("Invalid barcode.");
    return offline as ItemSummary;
  }
  let rows: ItemSummary[];
  try {
    rows = await withTimeout(
      authenticatedSelect<ItemSummary[]>("items", {
        select: "id,name,barcode,status,checked_out_by",
        barcode: `eq.${barcode}`,
        deleted_at: "is.null",
        limit: "1",
      }),
      LOOKUP_TIMEOUT_MS,
      "Unable to connect to ItemTraxx servers. Please check your internet connection and try again."
    );
    markItemTraxxServerConfirmed();
  } catch (error) {
    if (!isLookupConnectivityFailure(error)) throw error;
    markItemTraxxServerUnreachable();
    const offline = await findOfflineItem(getOfflineScope(), barcode);
    if (offline) return offline as ItemSummary;
    throw error;
  }

  if (!rows?.length) {
    throw new Error("Invalid barcode.");
  }

  return rows[0] as ItemSummary;
};

export const fetchBorrowerByBorrowerId = async (borrowerId: string) => {
  if (!navigator.onLine) {
    markItemTraxxServerUnreachable();
    const offline = await findOfflineBorrower(getOfflineScope(), borrowerId);
    if (!offline) throw new Error("Borrower not found.");
    return offline as BorrowerSummary;
  }
  const { deviceId } = getOrCreateDeviceSession();
  let result;
  try {
    result = await withTimeout(
      invokeEdgeFunction<{ data: BorrowerSummary }, { borrower_id: string; device_id: string }>(
        "checkout-borrower-lookup",
        {
          method: "POST",
          body: { borrower_id: borrowerId, device_id: deviceId },
        },
      ),
      LOOKUP_TIMEOUT_MS,
      "Unable to connect to ItemTraxx servers. Please check your internet connection and try again."
    );
  } catch (error) {
    if (!isLookupConnectivityFailure(error)) throw error;
    markItemTraxxServerUnreachable();
    const offline = await findOfflineBorrower(getOfflineScope(), borrowerId);
    if (offline) return offline as BorrowerSummary;
    throw error;
  }

  if (result.status === 0 || result.status === 429 || result.status >= 500) {
    if (isServerUnreachableStatus(result.status)) markItemTraxxServerUnreachable();
    const offline = await findOfflineBorrower(getOfflineScope(), borrowerId);
    if (offline) return offline as BorrowerSummary;
  } else if (result.ok) {
    markItemTraxxServerConfirmed();
  }

  if (!result.ok || !result.data?.data) {
    throw edgeFunctionError(result, "Borrower not found.");
  }

  return result.data.data;
};

export const fetchCheckedOutItem = async (borrowerUuid: string) => {
  if (!navigator.onLine) {
    markItemTraxxServerUnreachable();
    return await getOfflineCheckedOutItems(getOfflineScope(), borrowerUuid) as ItemSummary[];
  }
  let rows: ItemSummary[];
  try {
    rows = await withTimeout(
      authenticatedSelect<ItemSummary[]>("items", {
        select: "id,name,barcode,status,checked_out_by",
        checked_out_by: `eq.${borrowerUuid}`,
        deleted_at: "is.null",
      }),
      LOOKUP_TIMEOUT_MS,
      "Unable to connect to ItemTraxx servers. Please check your internet connection and try again."
    );
    markItemTraxxServerConfirmed();
  } catch (error) {
    if (!isLookupConnectivityFailure(error)) throw error;
    markItemTraxxServerUnreachable();
    const offline = await getOfflineCheckedOutItems(getOfflineScope(), borrowerUuid);
    if (offline) return offline as ItemSummary[];
    throw error;
  }

  return (rows ?? []) as ItemSummary[];
};

export const getCheckoutOfflineSummary = getOfflineWorkflowSummary;
