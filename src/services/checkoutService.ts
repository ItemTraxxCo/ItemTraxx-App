import { authenticatedSelect } from "./authenticatedDataClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { withTimeout } from "./asyncUtils";
import { AppError, edgeFunctionError, notFoundError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  ensureCheckoutOperationId,
  isOfflineQueueItemScopedTo,
  readOfflineQueue,
  withOfflineQueueLock,
  writeOfflineQueue,
  type BufferedCheckoutItem,
  type CheckoutReturnPayload,
  type OfflineQueueScope,
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
  markItemTraxxServerConfirmed,
  markItemTraxxServerUnreachable,
} from "./offlineConnectionState";
import { fetchSystemStatus, probeSystemStatusTransport } from "./systemStatusService";
import { fetchHttpSessionSummary } from "./httpSessionService";
import { trackProductEvent } from "./productEvents";

export { consumeCheckoutOfflineWarning } from "./offlineCheckoutQueue";
export type { CheckoutReturnPayload } from "./offlineCheckoutQueue";

type SubmitCheckoutReturnResult = {
  buffered: boolean;
  queuedCount: number;
};

export type CheckoutQueueSyncResult = {
  processed: number;
  failed: number;
  remaining: number;
  review: number;
  serverReachable: boolean | null;
};

type BufferedCheckoutQueueSyncResult = Omit<CheckoutQueueSyncResult, "serverReachable">;

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
const SERVER_PROBE_TIMEOUT_MS = 2000;
const LEGACY_QUEUE_REVIEW_MESSAGE =
  "Legacy offline transaction is not bound to this session and needs manual review before replay.";
const LEGACY_QUEUE_SCOPE_UNAVAILABLE_MESSAGE =
  "Unable to verify the current session for legacy offline replay; retry when connected.";

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

const recordCheckoutResponse = (ok: boolean) => {
  if (ok) markItemTraxxServerConfirmed();
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

type AuthoritativeOfflineQueueScopeResult = {
  scope: OfflineQueueScope | null;
  unavailable: boolean;
};

const getAuthoritativeOfflineQueueScope = async (): Promise<AuthoritativeOfflineQueueScopeResult> => {
  const authBefore = getAuthState();
  const identityBefore = {
    isAuthenticated: authBefore.isAuthenticated,
    userId: authBefore.userId,
    workspaceId: authBefore.workspaceContextId ?? authBefore.sessionWorkspaceId ?? null,
  };
  try {
    const session = await fetchHttpSessionSummary();
    const authAfter = getAuthState();
    const workspaceAfter = authAfter.workspaceContextId ?? authAfter.sessionWorkspaceId ?? null;
    if (
      identityBefore.isAuthenticated !== authAfter.isAuthenticated ||
      identityBefore.userId !== authAfter.userId ||
      identityBefore.workspaceId !== workspaceAfter
    ) {
      return { scope: null, unavailable: true };
    }
    if (!session.authenticated || !session.user?.id || !session.profile?.workspace_id) {
      return { scope: null, unavailable: false };
    }
    const { deviceId } = getOrCreateDeviceSession();
    if (!deviceId) return { scope: null, unavailable: false };
    return {
      scope: {
        workspaceId: session.profile.workspace_id,
        profileId: session.user.id,
        deviceId,
      },
      unavailable: false,
    };
  } catch {
    // A failed session read is not evidence that the record is unbound. Keep
    // it pending and fail closed until the authoritative identity is known.
    return { scope: null, unavailable: true };
  }
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

  recordCheckoutResponse(result.ok);

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
          if (retryError instanceof CheckoutRequestError && retryError.status === 0 && await probeItemTraxxServer()) {
            // A CORS/WAF failure can look like a network outage to fetch even
            // while the edge is reachable. Do not silently turn that request
            // into an offline transaction; let the operator retry it.
            throw retryError;
          }
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

const syncBufferedCheckoutQueueInternal = async () => {
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
      return { processed: 0, failed: 0, remaining: 0, review: 0 };
    }

    let processed = 0;
    let failed = 0;
    let review = 0;
    const remaining: BufferedCheckoutItem[] = [];

    for (const item of queue) {
      if (item.review_required === true) {
        failed += 1;
        review += 1;
        remaining.push({
          ...item,
          last_error: item.last_error || LEGACY_QUEUE_REVIEW_MESSAGE,
        });
        continue;
      }
      const { scope, unavailable } = await getAuthoritativeOfflineQueueScope();
      if (unavailable) {
        failed += 1;
        remaining.push({
          ...item,
          last_error: LEGACY_QUEUE_SCOPE_UNAVAILABLE_MESSAGE,
        });
        continue;
      }
      if (!scope || !isOfflineQueueItemScopedTo(item, scope)) {
        failed += 1;
        review += 1;
        remaining.push({
          ...item,
          review_required: true,
          last_error: LEGACY_QUEUE_REVIEW_MESSAGE,
        });
        continue;
      }
      const payload = ensureCheckoutOperationId(item.payload);
      if (payload.action_type === "auto") {
        failed += 1;
        review += 1;
        remaining.push({
          ...item,
          payload,
          review_required: true,
          last_error: "Legacy automatic transaction needs manual review before replay.",
        });
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
    window.dispatchEvent(new CustomEvent("itemtraxx:offline-queue-changed"));
    return {
      processed,
      failed,
      // Review-required records remain stored for the local review surface,
      // but are not retryable work and must not be counted as pending.
      remaining: remaining.filter((item) => item.review_required !== true).length,
      review,
    };
  });
  return {
    processed: workflow.processed + legacy.processed,
    failed: workflow.failed + legacy.failed,
    remaining: workflow.remaining + legacy.remaining,
    review: workflow.review + legacy.review,
  };
};

let bufferedCheckoutQueueSyncInFlight: Promise<BufferedCheckoutQueueSyncResult> | null = null;
let checkoutQueueSyncInFlight: Promise<CheckoutQueueSyncResult> | null = null;

const refreshOfflinePackAfterQueueSync = async (
  result: BufferedCheckoutQueueSyncResult,
  serverReachable: boolean | null = true,
) => {
  if (result.processed === 0 || result.remaining > 0 || result.review > 0 || serverReachable === false) return;
  await refreshOfflineCheckoutPackIfNeeded({ force: true }).catch(() => undefined);
};

// A buffered transaction is only safe once the server accepts it. Report the
// outcome of every real sync run so a queue that never drains is visible
// instead of silent. This lives here, not at the call sites, because
// syncCheckoutQueues hands the same in-flight promise to each caller and would
// otherwise report one flush once per caller.
const reportQueueSyncOutcome = (result: CheckoutQueueSyncResult) => {
  if (result.processed > 0) {
    trackProductEvent({
      posthog: {
        name: "checkout_transaction_synced",
        properties: {
          synced_count: result.processed,
          remaining_count: result.remaining,
          review_count: result.review,
        },
      },
    });
  }
  if (result.failed > 0) {
    trackProductEvent({
      posthog: {
        name: "checkout_transaction_sync_failed",
        properties: {
          failed_count: result.failed,
          remaining_count: result.remaining,
          review_count: result.review,
          server_reachable: result.serverReachable === true,
        },
      },
    });
  }
};

export const probeItemTraxxServer = async () => {
  try {
    const result = await fetchSystemStatus({ force: true, timeoutMs: SERVER_PROBE_TIMEOUT_MS });
    if (result) {
      // Any HTTP response proves the edge is reachable. Application-level
      // failures must not turn into a misleading offline label.
      markItemTraxxServerConfirmed();
      return true;
    }
  } catch {
    // A failed status probe is the only place a fetch-level failure is
    // promoted to the persistent offline state.
  }
  if (await probeSystemStatusTransport(SERVER_PROBE_TIMEOUT_MS)) {
    // A CORS/WAF challenge can make the application probe look like a network
    // failure even though the edge is reachable. Keep that distinct from an
    // actual outage so a borrower lookup cannot flash an offline warning.
    markItemTraxxServerConfirmed();
    return true;
  }
  markItemTraxxServerUnreachable();
  return false;
};

export const syncBufferedCheckoutQueue = () => {
  if (!bufferedCheckoutQueueSyncInFlight) {
    bufferedCheckoutQueueSyncInFlight = (async () => {
      const result = await syncBufferedCheckoutQueueInternal();
      await refreshOfflinePackAfterQueueSync(result);
      return result;
    })().finally(() => { bufferedCheckoutQueueSyncInFlight = null; });
  }
  return bufferedCheckoutQueueSyncInFlight;
};

/**
 * Replays both offline queue formats and actively verifies that ItemTraxx is
 * reachable. `force` is used by the manual Sync now control so a stale
 * navigator.onLine value cannot prevent the request.
 */
export const syncCheckoutQueues = (options: { force?: boolean } = {}) => {
  if (!options.force && typeof navigator !== "undefined" && !navigator.onLine) {
    return Promise.resolve<CheckoutQueueSyncResult>({
      processed: 0,
      failed: 0,
      remaining: 0,
      review: 0,
      serverReachable: null,
    });
  }
  if (!checkoutQueueSyncInFlight) {
    checkoutQueueSyncInFlight = (async () => {
      const result = await syncBufferedCheckoutQueueInternal();
      const serverReachable = await probeItemTraxxServer();
      await refreshOfflinePackAfterQueueSync(result, serverReachable);
      const outcome = { ...result, serverReachable };
      reportQueueSyncOutcome(outcome);
      return outcome;
    })().finally(() => {
      checkoutQueueSyncInFlight = null;
    });
  }
  return checkoutQueueSyncInFlight;
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
    if (!offline) throw notFoundError("Invalid barcode.");
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
    if (await probeItemTraxxServer()) throw error;
    const offline = await findOfflineItem(getOfflineScope(), barcode);
    if (offline) return offline as ItemSummary;
    throw error;
  }

  if (!rows?.length) {
    throw notFoundError("Invalid barcode.");
  }

  return rows[0] as ItemSummary;
};

export const fetchBorrowerByBorrowerId = async (borrowerId: string) => {
  if (!navigator.onLine) {
    markItemTraxxServerUnreachable();
    const offline = await findOfflineBorrower(getOfflineScope(), borrowerId);
    if (!offline) throw notFoundError("Borrower not found.");
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
    if (await probeItemTraxxServer()) throw error;
    const offline = await findOfflineBorrower(getOfflineScope(), borrowerId);
    if (offline) return offline as BorrowerSummary;
    throw error;
  }

  if (result.status === 0) {
    const serverReachable = await probeItemTraxxServer();
    if (serverReachable) throw edgeFunctionError(result, "Borrower lookup failed. Please try again.");
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
    if (await probeItemTraxxServer()) throw error;
    const offline = await getOfflineCheckedOutItems(getOfflineScope(), borrowerUuid);
    if (offline) return offline as ItemSummary[];
    throw error;
  }

  return (rows ?? []) as ItemSummary[];
};

export const getCheckoutOfflineSummary = getOfflineWorkflowSummary;
