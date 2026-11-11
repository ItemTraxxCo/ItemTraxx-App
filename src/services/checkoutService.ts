import { authenticatedSelect } from "./authenticatedDataClient";
import { ensureAccountSessionReady } from "./accountSessionService";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { withTimeout } from "./asyncUtils";
import { AppError, edgeFunctionError, notFoundError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  ensureCheckoutOperationId,
  getBufferedCheckoutCount,
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
import { MAX_CHECKOUT_RETURN_ITEMS } from "../types/offlineCheckoutLimits";
import {
  clearCheckoutRetryStatus,
  createCheckoutRetryStatusId,
  getCheckoutRetryDelayMs,
  MAX_CHECKOUT_ATTEMPTS,
  MAX_RATE_LIMIT_RETRIES,
  setCheckoutRetryStatus,
  showCheckoutSavedForSync,
  waitForCheckoutRetry,
  type CheckoutRetryAction,
  type CheckoutRetryReason,
} from "./checkoutRetryStatus";

export { consumeCheckoutOfflineWarning } from "./offlineCheckoutQueue";
export type { CheckoutReturnPayload } from "./offlineCheckoutQueue";

type SubmitCheckoutReturnResult = {
  buffered: boolean;
  queuedCount: number;
  processedItemCount: number;
  queuedItemCount: number;
  skippedBarcodes: string[];
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
  retry_after_seconds?: number | null;
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
  // HTTP failures are classified by edgeFunctionClient already. It promotes
  // 5xx responses with request metadata, so the page catch must not report the
  // same handled response a second time.
  readonly reportToErrorTracking = false;

  constructor(
    message: string,
    readonly status: number,
    readonly data: CheckoutReturnResponse | null,
  ) {
    super(message);
  }
}

type CheckoutReturnExecutionProgress = {
  completedChunks: Set<number>;
  processedItemCount: number;
  skippedBarcodes: string[];
};

const createCheckoutReturnExecutionProgress = (): CheckoutReturnExecutionProgress => ({
  completedChunks: new Set(),
  processedItemCount: 0,
  skippedBarcodes: [],
});

const isQueueableFailure = (error: unknown) => {
  if (error instanceof CheckoutRequestError) {
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message : "";
  return isRetryableNetworkFailure(0, message);
};

const recordCheckoutResponse = (status: number) => {
  if (status > 0) markItemTraxxServerConfirmed();
};

const retryReasonForError = (error: unknown): CheckoutRetryReason => {
  if (error instanceof CheckoutRequestError && error.status === 429) return "rate_limit";
  if (error instanceof CheckoutRequestError && error.status >= 500) return "server";
  return "network";
};

const checkoutRetryAfterSeconds = (error: unknown) =>
  error instanceof CheckoutRequestError ? error.data?.retry_after_seconds : null;

const checkoutRetryAction = (payload: CheckoutReturnPayload): CheckoutRetryAction => {
  if (payload.action_type === "return" || payload.action_type === "admin_return" || payload.action_type === "quick_return") {
    return "return";
  }
  if (payload.action_type === "checkout") return "checkout";
  return "transaction";
};

export const formatSkippedBarcodeConflictMessage = (skippedBarcodes: string[]) => {
  const uniqueBarcodes = [...new Set(skippedBarcodes)];
  if (uniqueBarcodes.length === 0) return "";
  const label = uniqueBarcodes.length === 1
    ? `Item ${uniqueBarcodes[0]} is already checked out or no longer available.`
    : `${uniqueBarcodes.length} item(s) are already checked out or no longer available.`;
  return `${label} Refresh and try again.`;
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

const executeCheckoutReturnChunk = async (payload: CheckoutReturnPayload) => {
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<CheckoutReturnResponse>("checkoutReturn", {
    method: "POST",
    preserveErrorData: true,
    body: {
      ...payload,
      device_id: deviceId,
      device_label: deviceLabel,
    },
  });

  recordCheckoutResponse(result.status);

  if (!result.ok) {
    const message = result.status === 429
      ? "Rate limit exceeded, please try again in a minute."
      : edgeFunctionError(result, "Request failed. Please contact support.").message;
    throw new CheckoutRequestError(message, result.status, result.data);
  }

  if (result.data && result.data.success === false) {
    throw new CheckoutRequestError(result.data.error || result.data.message || "Request failed.", 409, result.data);
  }

  return result.data;
};

const executeCheckoutReturnAttempt = async (
  payload: CheckoutReturnPayload,
  progress: CheckoutReturnExecutionProgress,
) => {
  const chunks: string[][] = [];
  if (payload.item_barcodes.length === 0) chunks.push([]);
  for (let offset = 0; offset < payload.item_barcodes.length; offset += MAX_CHECKOUT_RETURN_ITEMS) {
    chunks.push(payload.item_barcodes.slice(offset, offset + MAX_CHECKOUT_RETURN_ITEMS));
  }

  await ensureAccountSessionReady();
  for (let index = 0; index < chunks.length; index += 1) {
    if (progress.completedChunks.has(index)) continue;
    const result = await executeCheckoutReturnChunk({
      ...payload,
      item_barcodes: chunks[index]!,
    });
    progress.processedItemCount += result?.processed ?? 0;
    progress.skippedBarcodes.push(...(result?.skipped_barcodes ?? []));
    progress.completedChunks.add(index);
  }

  const skippedBarcodes = [...new Set(progress.skippedBarcodes)];
  if (skippedBarcodes.length > 0) {
    throw new CheckoutRequestError(formatSkippedBarcodeConflictMessage(skippedBarcodes), 409, {
      success: true,
      processed: progress.processedItemCount,
      skipped_barcodes: skippedBarcodes,
    });
  }

  return { success: true, processed: progress.processedItemCount, skipped_barcodes: [] };
};

const executeCheckoutReturn = async (
  payload: CheckoutReturnPayload,
  progress: CheckoutReturnExecutionProgress = createCheckoutReturnExecutionProgress(),
) => {
  const retryStatusId = createCheckoutRetryStatusId();
  const action = checkoutRetryAction(payload);
  let attempt = 1;
  let rateLimitRetries = 0;
  let previousReason: CheckoutRetryReason = "network";

  try {
    while (true) {
      try {
        if (attempt > 1) {
          setCheckoutRetryStatus({
            id: retryStatusId,
            phase: "retrying",
            action,
            reason: previousReason,
            attempt,
            maxAttempts: previousReason === "rate_limit" ? attempt : MAX_CHECKOUT_ATTEMPTS,
            secondsRemaining: 0,
          });
        }
        return await executeCheckoutReturnAttempt(payload, progress);
      } catch (error) {
        if (!isQueueableFailure(error)) throw error;

        const reason = retryReasonForError(error);
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          markItemTraxxServerUnreachable();
          throw error;
        }
        if (
          attempt >= MAX_CHECKOUT_ATTEMPTS ||
          (reason === "rate_limit" && rateLimitRetries >= MAX_RATE_LIMIT_RETRIES)
        ) {
          throw error;
        }

        if (reason === "rate_limit") rateLimitRetries += 1;
        previousReason = reason;
        const nextAttempt = attempt + 1;
        const delayMs = getCheckoutRetryDelayMs(
          nextAttempt,
          reason,
          checkoutRetryAfterSeconds(error),
        );
        const initialSeconds = Math.ceil(delayMs / 1_000);
        setCheckoutRetryStatus({
          id: retryStatusId,
          phase: "waiting",
          action,
          reason,
          attempt: nextAttempt,
          maxAttempts: reason === "rate_limit" ? nextAttempt : MAX_CHECKOUT_ATTEMPTS,
          secondsRemaining: initialSeconds,
        });
        const stayedOnline = await waitForCheckoutRetry(delayMs, (secondsRemaining) => {
          setCheckoutRetryStatus({
            id: retryStatusId,
            phase: "waiting",
            action,
            reason,
            attempt: nextAttempt,
            maxAttempts: reason === "rate_limit" ? nextAttempt : MAX_CHECKOUT_ATTEMPTS,
            secondsRemaining,
          });
        });
        if (!stayedOnline) {
          markItemTraxxServerUnreachable();
          throw error;
        }
        attempt = nextAttempt;
      }
    }
  } finally {
    clearCheckoutRetryStatus(retryStatusId);
  }
};

const getUncompletedOfflineItems = (
  items: OfflineSubmitContext["items"],
  progress: CheckoutReturnExecutionProgress,
) => items.filter((_, index) =>
  !progress.completedChunks.has(Math.floor(index / MAX_CHECKOUT_RETURN_ITEMS))
);

export const submitCheckoutReturn = async (
  payload: CheckoutReturnPayload,
  offlineContext?: OfflineSubmitContext,
): Promise<SubmitCheckoutReturnResult> => {
  const payloadWithOperationId = ensureCheckoutOperationId(payload);
  const progress = createCheckoutReturnExecutionProgress();
  try {
    await executeCheckoutReturn(payloadWithOperationId, progress);
    if (payloadWithOperationId.operation_id) {
      clearCheckoutRetryStatus(payloadWithOperationId.operation_id, "saved");
    }
    if (offlineContext) await applyConfirmedTransactionToOfflinePack(offlineContext);
    void refreshOfflineCheckoutPackIfNeeded({ force: true, reportProgress: false }).catch(() => undefined);
    return {
      buffered: false,
      queuedCount: await getBufferedCheckoutCount(),
      processedItemCount: progress.processedItemCount,
      queuedItemCount: 0,
      skippedBarcodes: [],
    };
  } catch (error) {
    if (isQueueableFailure(error)) {
      if (
        error instanceof CheckoutRequestError && error.status === 0 &&
        navigator.onLine && await probeItemTraxxServer()
      ) {
        // A CORS/WAF failure can look like a network outage to fetch even while
        // the edge is reachable. Keep that distinct from a real outage.
        throw error;
      }
      if (!offlineContext || !payloadWithOperationId.operation_id) {
        throw error;
      }
      const remainingItems = getUncompletedOfflineItems(offlineContext.items, progress);
      if (remainingItems.length === 0) {
        throw error;
      }
      const queuedCount = await queueOfflineOperation({
        operationId: payloadWithOperationId.operation_id,
        borrower: offlineContext.borrower,
        items: remainingItems,
      });
      showCheckoutSavedForSync({
        id: payloadWithOperationId.operation_id,
        phase: "saved",
        action: checkoutRetryAction(payloadWithOperationId),
        itemCount: remainingItems.length,
      });
      return {
        buffered: true,
        queuedCount,
        processedItemCount: progress.processedItemCount,
        queuedItemCount: remainingItems.length,
        skippedBarcodes: [...new Set(progress.skippedBarcodes)],
      };
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

    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index]!;
      if (item.review_required === true) {
        failed += 1;
        review += 1;
        remaining.push({
          ...item,
          last_error: item.last_error || LEGACY_QUEUE_REVIEW_MESSAGE,
        });
        continue;
      }
      const nextRetryAt = item.next_retry_at ? Date.parse(item.next_retry_at) : Number.NaN;
      if (Number.isFinite(nextRetryAt) && nextRetryAt > Date.now()) {
        failed += 1;
        remaining.push(item);
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
        if (payload.operation_id) clearCheckoutRetryStatus(payload.operation_id, "saved");
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Request failed.";
        remaining.push({
          ...item,
          payload,
          attempts: item.attempts + 1,
          last_error: message,
          next_retry_at: isQueueableFailure(error)
            ? new Date(Date.now() + getCheckoutRetryDelayMs(
              MAX_CHECKOUT_ATTEMPTS + 1,
              retryReasonForError(error),
              checkoutRetryAfterSeconds(error),
            )).toISOString()
            : null,
        });
        if (isQueueableFailure(error)) {
          const unprocessed = queue.slice(index + 1);
          remaining.push(...unprocessed);
          failed += unprocessed.length;
          review += unprocessed.filter((queued) => queued.review_required === true).length;
          break;
        }
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
  await refreshOfflineCheckoutPackIfNeeded({ force: true, reportProgress: false }).catch(() => undefined);
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
      return { ...result, serverReachable };
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
      (async () => {
        await ensureAccountSessionReady();
        return invokeEdgeFunction<{ data: BorrowerSummary }, { borrower_id: string; device_id: string }>(
          "checkout-borrower-lookup",
          {
            method: "POST",
            body: { borrower_id: borrowerId, device_id: deviceId },
          },
        );
      })(),
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
