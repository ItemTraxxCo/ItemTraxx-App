import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// withTimeout just races the real promise against a setTimeout; a plain
// passthrough keeps these tests focused on checkoutService's own branching
// rather than asyncUtils' timing behavior (same rationale as
// sessionBootstrap.spec.ts).
vi.mock("./asyncUtils", () => ({
  withTimeout: (promise: Promise<unknown>) => promise,
}));

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("./authenticatedDataClient", () => ({
  authenticatedSelect: vi.fn(),
}));
vi.mock("../utils/deviceSession", () => ({
  getOrCreateDeviceSession: vi.fn(() => ({ deviceId: "device-1", deviceLabel: "Mac" })),
}));
vi.mock("./offlineCheckoutQueue", () => ({
  ensureCheckoutOperationId: vi.fn((payload) => ({ ...payload, operation_id: payload.operation_id ?? "op-mock" })),
  isOfflineQueueItemScopedTo: vi.fn((item, scope) =>
    item?.workspace_id === scope.workspaceId &&
    item?.profile_id === scope.profileId &&
    item?.device_id === scope.deviceId
  ),
  readOfflineQueue: vi.fn(),
  withOfflineQueueLock: vi.fn((callback: () => Promise<unknown>) => callback()),
  writeOfflineQueue: vi.fn(),
  consumeCheckoutOfflineWarning: vi.fn(),
  getBufferedCheckoutCount: vi.fn(),
}));
vi.mock("./offlineCheckoutWorkflow", () => ({
  applyConfirmedTransactionToOfflinePack: vi.fn(),
  findOfflineBorrower: vi.fn(),
  findOfflineItem: vi.fn(),
  getOfflineCheckedOutItems: vi.fn(),
  getOfflineWorkflowSummary: vi.fn(),
  queueOfflineOperation: vi.fn(),
  refreshOfflineCheckoutPackIfNeeded: vi.fn(),
  syncOfflineCheckoutLedger: vi.fn(),
}));
vi.mock("../store/authState", () => ({
  getAuthState: vi.fn(),
}));
vi.mock("./offlineConnectionState", () => ({
  isServerUnreachableStatus: (status: number) => status === 0,
  markItemTraxxServerConfirmed: vi.fn(),
  markItemTraxxServerUnreachable: vi.fn(),
}));
vi.mock("./systemStatusService", () => ({
  fetchSystemStatus: vi.fn(),
  probeSystemStatusTransport: vi.fn(),
}));
vi.mock("./httpSessionService", () => ({
  fetchHttpSessionSummary: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect } from "./authenticatedDataClient";
import {
  ensureCheckoutOperationId,
  isOfflineQueueItemScopedTo,
  readOfflineQueue,
  writeOfflineQueue,
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
} from "./offlineCheckoutWorkflow";
import { getAuthState } from "../store/authState";
import { markItemTraxxServerConfirmed, markItemTraxxServerUnreachable } from "./offlineConnectionState";
import { fetchSystemStatus, probeSystemStatusTransport } from "./systemStatusService";
import { fetchHttpSessionSummary } from "./httpSessionService";
import {
  fetchBorrowerByBorrowerId,
  fetchCheckedOutItem,
  fetchItemByBarcode,
  getCheckoutOfflineSummary,
  submitCheckoutReturn,
  syncBufferedCheckoutQueue,
  syncCheckoutQueues,
  type CheckoutReturnPayload,
} from "./checkoutService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const mockedSelect = vi.mocked(authenticatedSelect);
const mockedEnsureOpId = vi.mocked(ensureCheckoutOperationId);
const mockedIsQueueItemScoped = vi.mocked(isOfflineQueueItemScopedTo);
const mockedReadQueue = vi.mocked(readOfflineQueue);
const mockedWriteQueue = vi.mocked(writeOfflineQueue);
const mockedApplyConfirmed = vi.mocked(applyConfirmedTransactionToOfflinePack);
const mockedFindOfflineBorrower = vi.mocked(findOfflineBorrower);
const mockedFindOfflineItem = vi.mocked(findOfflineItem);
const mockedGetOfflineCheckedOutItems = vi.mocked(getOfflineCheckedOutItems);
const mockedGetOfflineWorkflowSummary = vi.mocked(getOfflineWorkflowSummary);
const mockedQueueOfflineOperation = vi.mocked(queueOfflineOperation);
const mockedRefreshPack = vi.mocked(refreshOfflineCheckoutPackIfNeeded);
const mockedSyncLedger = vi.mocked(syncOfflineCheckoutLedger);
const mockedGetAuthState = vi.mocked(getAuthState);
const mockedMarkConfirmed = vi.mocked(markItemTraxxServerConfirmed);
const mockedMarkUnreachable = vi.mocked(markItemTraxxServerUnreachable);
const mockedFetchSystemStatus = vi.mocked(fetchSystemStatus);
const mockedProbeSystemStatusTransport = vi.mocked(probeSystemStatusTransport);
const mockedFetchHttpSessionSummary = vi.mocked(fetchHttpSessionSummary);

const AUTH_SCOPE = {
  isAuthenticated: true,
  workspaceContextId: "ws-1",
  userId: "profile-1",
} as ReturnType<typeof getAuthState>;

const okResponse = <T,>(data: T) => ({ ok: true, status: 200, error: "", data });
const failResponse = (status: number, error = "boom") => ({ ok: false, status, error, data: null });

const setOnline = (online: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);

const payload: CheckoutReturnPayload = {
  borrower_id: "b-1",
  item_barcodes: ["BC-1"],
  action_type: "checkout",
};

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedSelect.mockReset();
  mockedEnsureOpId.mockImplementation((p) => ({ ...p, operation_id: p.operation_id ?? "op-mock" }));
  mockedIsQueueItemScoped.mockImplementation((item, scope) =>
    item?.workspace_id === scope.workspaceId &&
    item?.profile_id === scope.profileId &&
    item?.device_id === scope.deviceId
  );
  mockedReadQueue.mockReset().mockResolvedValue([]);
  mockedWriteQueue.mockReset();
  mockedApplyConfirmed.mockReset();
  mockedFindOfflineBorrower.mockReset();
  mockedFindOfflineItem.mockReset();
  mockedGetOfflineCheckedOutItems.mockReset();
  mockedGetOfflineWorkflowSummary.mockReset();
  mockedQueueOfflineOperation.mockReset();
  mockedRefreshPack.mockReset().mockResolvedValue({ refreshed: false, firstPreparation: false } as never);
  mockedSyncLedger.mockReset();
  mockedGetAuthState.mockReturnValue(AUTH_SCOPE);
  mockedMarkConfirmed.mockReset();
  mockedMarkUnreachable.mockReset();
  mockedFetchSystemStatus.mockReset().mockResolvedValue(null);
  mockedProbeSystemStatusTransport.mockReset().mockResolvedValue(false);
  mockedFetchHttpSessionSummary.mockReset().mockResolvedValue({
    authenticated: true,
    user: { id: "profile-1", email: null, last_sign_in_at: null },
    profile: {
      role: "tenant_account",
      workspace_id: "ws-1",
      auth_email: null,
      is_active: true,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitCheckoutReturn", () => {
  it("submits successfully, applies the offline pack, and reports the buffered queue length", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ success: true, processed: 1 }) as never);
    mockedApplyConfirmed.mockResolvedValue(true);
    mockedReadQueue.mockResolvedValue([{ id: "q-1" } as never]);

    const result = await submitCheckoutReturn(payload, { borrower: null, items: [] });

    expect(result).toEqual({ buffered: false, queuedCount: 1 });
    expect(mockedApplyConfirmed).toHaveBeenCalledWith({ borrower: null, items: [] });
    expect(mockedMarkConfirmed).toHaveBeenCalled();
    expect(mockedRefreshPack).toHaveBeenCalledWith({ force: true });
  });

  it("marks the server unreachable and does not throw when refreshOfflineCheckoutPackIfNeeded rejects in the background", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ success: true, processed: 1 }) as never);
    mockedRefreshPack.mockRejectedValue(new Error("refresh failed"));

    await expect(submitCheckoutReturn(payload)).resolves.toEqual({ buffered: false, queuedCount: 0 });
  });

  it("treats a 429 as queueable without labeling the reachable server offline", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(failResponse(429) as never);

    // 429 is a queueable status, so submitCheckoutReturn retries once online and then,
    // with no offline context to buffer into, surfaces the generic offline-unavailable
    // error rather than the underlying "rate limit exceeded" message.
    await expect(submitCheckoutReturn(payload)).rejects.toThrow(/offline checkout is unavailable/i);
    expect(mockedMarkUnreachable).not.toHaveBeenCalled();
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });

  it("buffers a persistent 429 offline when an offline context is available", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(failResponse(429) as never);
    mockedQueueOfflineOperation.mockResolvedValue(1);

    const result = await submitCheckoutReturn(payload, { borrower: null, items: [] });
    expect(result).toEqual({ buffered: true, queuedCount: 1 });
  });

  it("throws a 409 conflict error when the server reports skipped barcodes", async () => {
    mockedInvoke.mockResolvedValue(
      okResponse({ success: true, processed: 0, skipped_barcodes: ["BC-1"] }) as never
    );

    await expect(submitCheckoutReturn(payload)).rejects.toThrow(/already checked out.*refresh and try again/i);
  });

  it("throws a 409 conflict error using the multi-item message when several barcodes are skipped", async () => {
    mockedInvoke.mockResolvedValue(
      okResponse({ success: true, processed: 0, skipped_barcodes: ["BC-1", "BC-2"] }) as never
    );

    await expect(submitCheckoutReturn(payload)).rejects.toThrow(/2 item\(s\) are already checked out/i);
  });

  it("throws using the server's explicit error/message when success is false", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ success: false, processed: 0, error: "Item is damaged." }) as never);
    await expect(submitCheckoutReturn(payload)).rejects.toThrow("Item is damaged.");
  });

  it("retries once while online after a queueable (5xx) failure and succeeds", async () => {
    setOnline(true);
    mockedInvoke
      .mockResolvedValueOnce(failResponse(503) as never)
      .mockResolvedValueOnce(okResponse({ success: true, processed: 1 }) as never);

    const result = await submitCheckoutReturn(payload);

    expect(result.buffered).toBe(false);
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });

  it("buffers the transaction offline when online retry also fails and offline context is provided", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(failResponse(503) as never);
    mockedQueueOfflineOperation.mockResolvedValue(3);

    const result = await submitCheckoutReturn(payload, { borrower: null, items: [] });

    expect(result).toEqual({ buffered: true, queuedCount: 3 });
    expect(mockedQueueOfflineOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-mock", borrower: null, items: [] })
    );
    expect(mockedMarkUnreachable).not.toHaveBeenCalled();
  });

  it("buffers immediately without retrying when offline", async () => {
    setOnline(false);
    mockedInvoke.mockResolvedValue(failResponse(0, "Network request failed.") as never);
    mockedQueueOfflineOperation.mockResolvedValue(1);

    const result = await submitCheckoutReturn(payload, { borrower: null, items: [] });

    expect(result).toEqual({ buffered: true, queuedCount: 1 });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("does not silently buffer a status-zero transaction when the edge transport is reachable", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(failResponse(0, "Network request failed.") as never);
    mockedFetchSystemStatus.mockResolvedValue(null);
    mockedProbeSystemStatusTransport.mockResolvedValue(true);

    await expect(submitCheckoutReturn(payload, { borrower: null, items: [] })).rejects.toThrow(/network request failed/i);
    expect(mockedQueueOfflineOperation).not.toHaveBeenCalled();
    expect(mockedMarkUnreachable).not.toHaveBeenCalled();
  });

  it("throws when a queueable failure occurs but there is no offline context to buffer into", async () => {
    setOnline(false);
    mockedInvoke.mockResolvedValue(failResponse(0, "Network request failed.") as never);

    await expect(submitCheckoutReturn(payload)).rejects.toThrow(/offline checkout is unavailable/i);
  });

  it("throws when a queueable failure occurs but the payload has no operation id", async () => {
    setOnline(false);
    mockedEnsureOpId.mockImplementation((p) => ({ ...p, operation_id: undefined }));
    mockedInvoke.mockResolvedValue(failResponse(0, "Network request failed.") as never);

    await expect(submitCheckoutReturn(payload, { borrower: null, items: [] })).rejects.toThrow(
      /offline checkout is unavailable/i
    );
  });

  it("rethrows a non-queueable retry failure instead of buffering", async () => {
    setOnline(true);
    mockedInvoke
      .mockResolvedValueOnce(failResponse(503) as never)
      .mockResolvedValueOnce(failResponse(422, "Rejected by server.") as never);

    await expect(submitCheckoutReturn(payload, { borrower: null, items: [] })).rejects.toThrow(
      "Rejected by server."
    );
    expect(mockedQueueOfflineOperation).not.toHaveBeenCalled();
  });

  it("rethrows a non-queueable original failure without buffering", async () => {
    mockedInvoke.mockResolvedValue(failResponse(422, "Bad request.") as never);

    await expect(submitCheckoutReturn(payload, { borrower: null, items: [] })).rejects.toThrow("Bad request.");
    expect(mockedQueueOfflineOperation).not.toHaveBeenCalled();
  });
});

describe("syncBufferedCheckoutQueue", () => {
  it("does not sync before an authenticated workspace session is ready", async () => {
    mockedGetAuthState.mockReturnValue({
      isAuthenticated: false,
      workspaceContextId: null,
      userId: null,
    } as never);

    await expect(syncBufferedCheckoutQueue()).resolves.toEqual({
      processed: 0,
      failed: 0,
      remaining: 0,
      review: 0,
    });
    expect(mockedSyncLedger).not.toHaveBeenCalled();
    expect(mockedReadQueue).not.toHaveBeenCalled();
  });

  it("combines workflow-ledger sync stats with an empty legacy queue", async () => {
    mockedSyncLedger.mockResolvedValue({ processed: 2, failed: 1, remaining: 1, review: 1 });
    mockedReadQueue.mockResolvedValue([]);

    const result = await syncBufferedCheckoutQueue();

    expect(result).toEqual({ processed: 2, failed: 1, remaining: 1, review: 1 });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("flags legacy 'auto' action items as needing manual review without calling the server", async () => {
    mockedSyncLedger.mockResolvedValue({ processed: 0, failed: 0, remaining: 0, review: 0 });
    mockedReadQueue.mockResolvedValue([
      {
        id: "q-1",
        payload: { ...payload, action_type: "auto" },
        created_at: "2026-01-01T00:00:00Z",
        attempts: 0,
        last_error: null,
        workspace_id: "ws-1",
        profile_id: "profile-1",
        device_id: "device-1",
      },
    ]);

    const result = await syncBufferedCheckoutQueue();

    expect(result).toMatchObject({ processed: 0, failed: 1, remaining: 1, review: 1 });
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedWriteQueue).toHaveBeenCalledWith([
      expect.objectContaining({ id: "q-1", review_required: true, last_error: expect.stringMatching(/manual review/i) }),
    ]);
  });

  it("quarantines an unbound legacy item instead of replaying it under the current session", async () => {
    mockedSyncLedger.mockResolvedValue({ processed: 0, failed: 0, remaining: 0, review: 0 });
    mockedReadQueue.mockResolvedValue([
      {
        id: "q-unbound",
        payload,
        created_at: "2026-01-01T00:00:00Z",
        attempts: 0,
        last_error: null,
      },
    ]);

    const result = await syncBufferedCheckoutQueue();

    expect(result).toEqual({ processed: 0, failed: 1, remaining: 1, review: 1 });
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedWriteQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "q-unbound",
        review_required: true,
        last_error: expect.stringMatching(/manual review/i),
      }),
    ]);
  });

  it("replays legacy queued items, counting successes and requeuing failures with incremented attempts", async () => {
    mockedSyncLedger.mockResolvedValue({ processed: 0, failed: 0, remaining: 0, review: 0 });
    mockedReadQueue.mockResolvedValue([
      {
        id: "q-1",
        payload: { ...payload, borrower_id: "b-1" },
        created_at: "t",
        attempts: 0,
        last_error: null,
        workspace_id: "ws-1",
        profile_id: "profile-1",
        device_id: "device-1",
      },
      {
        id: "q-2",
        payload: { ...payload, borrower_id: "b-2" },
        created_at: "t",
        attempts: 1,
        last_error: null,
        workspace_id: "ws-1",
        profile_id: "profile-1",
        device_id: "device-1",
      },
    ]);
    mockedInvoke
      .mockResolvedValueOnce(okResponse({ success: true, processed: 1 }) as never)
      .mockResolvedValueOnce(failResponse(500, "still down") as never);

    const result = await syncBufferedCheckoutQueue();

    expect(result).toMatchObject({ processed: 1, failed: 1, remaining: 1 });
    expect(mockedWriteQueue).toHaveBeenCalledWith([
      expect.objectContaining({ id: "q-2", attempts: 2, last_error: "still down" }),
    ]);
  });

  it("re-checks the authoritative identity before each legacy replay", async () => {
    mockedSyncLedger.mockResolvedValue({ processed: 0, failed: 0, remaining: 0, review: 0 });
    mockedReadQueue.mockResolvedValue([
      {
        id: "q-current",
        payload,
        created_at: "t",
        attempts: 0,
        last_error: null,
        workspace_id: "ws-1",
        profile_id: "profile-1",
        device_id: "device-1",
      },
      {
        id: "q-after-switch",
        payload: { ...payload, borrower_id: "b-2" },
        created_at: "t",
        attempts: 0,
        last_error: null,
        workspace_id: "ws-1",
        profile_id: "profile-1",
        device_id: "device-1",
      },
    ]);
    mockedFetchHttpSessionSummary
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: "profile-1", email: null, last_sign_in_at: null },
        profile: { role: "tenant_account", workspace_id: "ws-1", auth_email: null, is_active: true },
      })
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: "profile-2", email: null, last_sign_in_at: null },
        profile: { role: "tenant_account", workspace_id: "ws-2", auth_email: null, is_active: true },
      });
    mockedInvoke.mockResolvedValueOnce(okResponse({ success: true, processed: 1 }) as never);

    const result = await syncBufferedCheckoutQueue();

    expect(result).toEqual({ processed: 1, failed: 1, remaining: 1, review: 1 });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedWriteQueue).toHaveBeenCalledWith([
      expect.objectContaining({ id: "q-after-switch", review_required: true }),
    ]);
  });

  it("keeps legacy items pending when the authoritative session cannot be read", async () => {
    mockedSyncLedger.mockResolvedValue({ processed: 0, failed: 0, remaining: 0, review: 0 });
    mockedReadQueue.mockResolvedValue([
      {
        id: "q-pending",
        payload,
        created_at: "t",
        attempts: 0,
        last_error: null,
        workspace_id: "ws-1",
        profile_id: "profile-1",
        device_id: "device-1",
      },
    ]);
    mockedFetchHttpSessionSummary.mockRejectedValueOnce(new Error("session unavailable"));

    const result = await syncBufferedCheckoutQueue();

    expect(result).toEqual({ processed: 0, failed: 1, remaining: 1, review: 0 });
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedWriteQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "q-pending",
        last_error: expect.stringMatching(/verify.*session/i),
      }),
    ]);
  });

  it("fails closed when the tab identity changes while the authoritative session is loading", async () => {
    mockedSyncLedger.mockResolvedValue({ processed: 0, failed: 0, remaining: 0, review: 0 });
    mockedReadQueue.mockResolvedValue([
      {
        id: "q-during-switch",
        payload,
        created_at: "t",
        attempts: 0,
        last_error: null,
        workspace_id: "ws-1",
        profile_id: "profile-1",
        device_id: "device-1",
      },
    ]);
    const tabAuthState = { ...AUTH_SCOPE };
    mockedGetAuthState.mockImplementation(() => tabAuthState);
    mockedFetchHttpSessionSummary.mockImplementationOnce(async () => {
      tabAuthState.userId = "profile-2";
      tabAuthState.workspaceContextId = "ws-2";
      return {
        authenticated: true,
        user: { id: "profile-1", email: null, last_sign_in_at: null },
        profile: { role: "tenant_account", workspace_id: "ws-1", auth_email: null, is_active: true },
      };
    });

    const result = await syncBufferedCheckoutQueue();

    expect(result).toEqual({ processed: 0, failed: 1, remaining: 1, review: 0 });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe("syncCheckoutQueues", () => {
  it("does not start a sync while the browser is explicitly offline", async () => {
    setOnline(false);

    await expect(syncCheckoutQueues()).resolves.toEqual({
      processed: 0,
      failed: 0,
      remaining: 0,
      review: 0,
      serverReachable: null,
    });
    expect(mockedSyncLedger).not.toHaveBeenCalled();
    expect(mockedFetchSystemStatus).not.toHaveBeenCalled();
  });

  it("treats an HTTP application error as reachable instead of marking the browser offline", async () => {
    setOnline(true);
    mockedSyncLedger.mockResolvedValue({ processed: 0, failed: 0, remaining: 0, review: 0 });
    mockedFetchSystemStatus.mockResolvedValue({ ok: false, status: 503, payload: {} });

    await expect(syncCheckoutQueues({ force: true })).resolves.toMatchObject({ serverReachable: true });
    expect(mockedMarkConfirmed).toHaveBeenCalled();
    expect(mockedMarkUnreachable).not.toHaveBeenCalled();
  });

  it("forces a fresh borrower and item pack after a reconnect drains the offline queue", async () => {
    setOnline(true);
    mockedSyncLedger.mockResolvedValue({ processed: 1, failed: 0, remaining: 0, review: 0 });
    mockedFetchSystemStatus.mockResolvedValue({ ok: true, status: 200, payload: {} });

    await expect(syncCheckoutQueues({ force: true })).resolves.toMatchObject({
      processed: 1,
      remaining: 0,
      review: 0,
      serverReachable: true,
    });
    expect(mockedRefreshPack).toHaveBeenCalledWith({ force: true });
  });

  it("does not replace the local pack while replay still has pending or review work", async () => {
    setOnline(true);
    mockedSyncLedger.mockResolvedValue({ processed: 1, failed: 1, remaining: 1, review: 0 });
    mockedFetchSystemStatus.mockResolvedValue({ ok: true, status: 200, payload: {} });

    await syncCheckoutQueues({ force: true });

    expect(mockedRefreshPack).not.toHaveBeenCalled();
  });

  it("keeps a failed transport probe offline only when both application and no-cors probes fail", async () => {
    setOnline(true);
    mockedSyncLedger.mockResolvedValue({ processed: 0, failed: 0, remaining: 0, review: 0 });
    mockedFetchSystemStatus.mockResolvedValue(null);
    mockedProbeSystemStatusTransport.mockResolvedValue(false);

    await expect(syncCheckoutQueues({ force: true })).resolves.toMatchObject({ serverReachable: false });
    expect(mockedMarkUnreachable).toHaveBeenCalled();
  });
});

describe("fetchItemByBarcode", () => {
  it("looks up the item offline immediately when the browser reports offline", async () => {
    setOnline(false);
    mockedFindOfflineItem.mockResolvedValue({ id: "item-1", name: "Drill", barcode: "BC-1", status: "available", checked_out_by: null });

    const result = await fetchItemByBarcode("BC-1");

    expect(result).toMatchObject({ id: "item-1" });
    expect(mockedMarkUnreachable).toHaveBeenCalled();
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it("throws 'Invalid barcode.' when offline and no offline match exists", async () => {
    setOnline(false);
    mockedFindOfflineItem.mockResolvedValue(null);
    await expect(fetchItemByBarcode("BC-1")).rejects.toThrow("Invalid barcode.");
  });

  it("returns the first row on a successful online lookup", async () => {
    setOnline(true);
    mockedSelect.mockResolvedValue([{ id: "item-1", name: "Drill", barcode: "BC-1", status: "available" }] as never);

    const result = await fetchItemByBarcode("BC-1");

    expect(result).toMatchObject({ id: "item-1" });
    expect(mockedMarkConfirmed).toHaveBeenCalled();
  });

  it("throws 'Invalid barcode.' online when no rows are returned", async () => {
    setOnline(true);
    mockedSelect.mockResolvedValue([] as never);
    await expect(fetchItemByBarcode("BC-1")).rejects.toThrow("Invalid barcode.");
  });

  it("falls back to the offline pack on a connectivity failure", async () => {
    setOnline(true);
    mockedSelect.mockRejectedValue(new TypeError("Failed to fetch"));
    mockedFindOfflineItem.mockResolvedValue({ id: "item-1", name: "Drill", barcode: "BC-1", status: "available", checked_out_by: null });

    const result = await fetchItemByBarcode("BC-1");

    expect(result).toMatchObject({ id: "item-1" });
    expect(mockedMarkUnreachable).toHaveBeenCalled();
  });

  it("rethrows the connectivity error when there is no offline match", async () => {
    setOnline(true);
    mockedSelect.mockRejectedValue(new TypeError("Failed to fetch"));
    mockedFindOfflineItem.mockResolvedValue(null);

    await expect(fetchItemByBarcode("BC-1")).rejects.toThrow("Failed to fetch");
  });

  it("rethrows a non-connectivity error without an offline fallback", async () => {
    setOnline(true);
    mockedSelect.mockRejectedValue(new Error("Unexpected server error"));

    await expect(fetchItemByBarcode("BC-1")).rejects.toThrow("Unexpected server error");
    expect(mockedFindOfflineItem).not.toHaveBeenCalled();
  });
});

describe("fetchBorrowerByBorrowerId", () => {
  it("looks up the borrower offline immediately when the browser reports offline", async () => {
    setOnline(false);
    mockedFindOfflineBorrower.mockResolvedValue({ id: "b-1", username: "jdoe", borrower_id: "1234AB" });

    const result = await fetchBorrowerByBorrowerId("1234AB");
    expect(result).toMatchObject({ id: "b-1" });
  });

  it("throws 'Borrower not found.' offline when there is no local match", async () => {
    setOnline(false);
    mockedFindOfflineBorrower.mockResolvedValue(null);
    await expect(fetchBorrowerByBorrowerId("1234AB")).rejects.toThrow("Borrower not found.");
  });

  it("returns the borrower on a successful online lookup", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(okResponse({ data: { id: "b-1", username: "jdoe", borrower_id: "1234AB" } }) as never);

    const result = await fetchBorrowerByBorrowerId("1234AB");
    expect(result).toMatchObject({ id: "b-1" });
    expect(mockedMarkConfirmed).toHaveBeenCalled();
  });

  it("surfaces a server failure without labeling the reachable server offline", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(failResponse(503) as never);

    await expect(fetchBorrowerByBorrowerId("1234AB")).rejects.toThrow("boom");
    expect(mockedMarkUnreachable).not.toHaveBeenCalled();
  });

  it("surfaces a borrower authorization 403 without showing the offline workflow", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(failResponse(403, "Forbidden.") as never);

    await expect(fetchBorrowerByBorrowerId("1234AB")).rejects.toThrow("Forbidden.");
    expect(mockedFindOfflineBorrower).not.toHaveBeenCalled();
    expect(mockedMarkUnreachable).not.toHaveBeenCalled();
  });

  it("does not turn a CORS/WAF-looking status-zero lookup into an offline warning when the edge is reachable", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(failResponse(0, "Network request failed.") as never);
    mockedFetchSystemStatus.mockResolvedValue(null);
    mockedProbeSystemStatusTransport.mockResolvedValue(true);

    await expect(fetchBorrowerByBorrowerId("1234AB")).rejects.toThrow(/network request failed/i);
    expect(mockedFindOfflineBorrower).not.toHaveBeenCalled();
    expect(mockedMarkUnreachable).not.toHaveBeenCalled();
  });

  it("throws a mapped error when the status is a retryable failure but there is no offline match", async () => {
    setOnline(true);
    mockedInvoke.mockResolvedValue(failResponse(503, "Server unavailable.") as never);
    mockedFindOfflineBorrower.mockResolvedValue(null);

    await expect(fetchBorrowerByBorrowerId("1234AB")).rejects.toThrow("Server unavailable.");
  });

  it("falls back offline on a thrown connectivity error", async () => {
    setOnline(true);
    mockedInvoke.mockRejectedValue(new TypeError("Failed to fetch"));
    mockedFindOfflineBorrower.mockResolvedValue({ id: "b-1", username: "jdoe", borrower_id: "1234AB" });

    const result = await fetchBorrowerByBorrowerId("1234AB");
    expect(result).toMatchObject({ id: "b-1" });
  });

  it("rethrows a non-connectivity thrown error", async () => {
    setOnline(true);
    mockedInvoke.mockRejectedValue(new Error("boom"));
    await expect(fetchBorrowerByBorrowerId("1234AB")).rejects.toThrow("boom");
  });

  it("rethrows the connectivity error when a thrown failure has no offline match either", async () => {
    setOnline(true);
    mockedInvoke.mockRejectedValue(new TypeError("Failed to fetch"));
    mockedFindOfflineBorrower.mockResolvedValue(null);

    await expect(fetchBorrowerByBorrowerId("1234AB")).rejects.toThrow("Failed to fetch");
  });
});

describe("fetchCheckedOutItem", () => {
  it("returns offline checked-out items immediately when offline", async () => {
    setOnline(false);
    mockedGetOfflineCheckedOutItems.mockResolvedValue([{ id: "item-1", name: "Drill", barcode: "BC-1", status: "checked_out", checked_out_by: "b-1" }]);

    const result = await fetchCheckedOutItem("b-1");
    expect(result).toHaveLength(1);
    expect(mockedMarkUnreachable).toHaveBeenCalled();
  });

  it("returns rows from the online lookup", async () => {
    setOnline(true);
    mockedSelect.mockResolvedValue([{ id: "item-1", name: "Drill", barcode: "BC-1", status: "checked_out" }] as never);

    const result = await fetchCheckedOutItem("b-1");
    expect(result).toHaveLength(1);
    expect(mockedMarkConfirmed).toHaveBeenCalled();
  });

  it("defaults to an empty array when the online lookup returns null", async () => {
    setOnline(true);
    mockedSelect.mockResolvedValue(null as never);
    expect(await fetchCheckedOutItem("b-1")).toEqual([]);
  });

  it("falls back to the offline pack on a connectivity failure", async () => {
    setOnline(true);
    mockedSelect.mockRejectedValue(new TypeError("Failed to fetch"));
    mockedGetOfflineCheckedOutItems.mockResolvedValue([]);

    const result = await fetchCheckedOutItem("b-1");
    expect(result).toEqual([]);
    expect(mockedMarkUnreachable).toHaveBeenCalled();
  });

  it("rethrows a non-connectivity error", async () => {
    setOnline(true);
    mockedSelect.mockRejectedValue(new Error("Unexpected server error"));
    await expect(fetchCheckedOutItem("b-1")).rejects.toThrow("Unexpected server error");
  });

  it("rethrows the connectivity error when the offline fallback yields no data", async () => {
    setOnline(true);
    mockedSelect.mockRejectedValue(new TypeError("Failed to fetch"));
    mockedGetOfflineCheckedOutItems.mockResolvedValue(undefined as never);

    await expect(fetchCheckedOutItem("b-1")).rejects.toThrow("Failed to fetch");
  });
});

describe("getCheckoutOfflineSummary", () => {
  it("delegates to getOfflineWorkflowSummary", async () => {
    mockedGetOfflineWorkflowSummary.mockResolvedValue({
      pack: null,
      pendingCount: 0,
      syncingCount: 0,
      reviewCount: 0,
      packExpired: false,
    } as never);

    const summary = await getCheckoutOfflineSummary();
    expect(summary.pendingCount).toBe(0);
  });
});
