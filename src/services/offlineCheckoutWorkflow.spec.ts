import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthState, setAuthStateFromBackend } from "../store/authState";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("../utils/deviceSession", () => ({
  getOrCreateDeviceSession: vi.fn(() => ({ deviceId: "device-1" })),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  applyConfirmedTransactionToOfflinePack,
  clearOfflineCheckoutWorkflow,
  findOfflineBorrower,
  findOfflineItem,
  getOfflineCheckedOutItems,
  getOfflineWorkflowSummary,
  isOfflineSessionInitializingError,
  keepOfflineServerStateLocally,
  listOfflineReviewEntries,
  markOfflineEntryNeedsReview,
  OFFLINE_SESSION_INITIALIZING_ERROR,
  prepareOfflineCheckoutPack,
  queueOfflineOperation,
  readOfflineLedger,
  readOfflinePack,
  refreshOfflineCheckoutPackIfNeeded,
  resolveOfflineCheckoutConflict,
  syncOfflineCheckoutLedger,
  writeOfflineLedger,
  writeOfflinePack,
  type OfflineCheckoutPack,
  type OfflineLedgerEntry,
} from "./offlineCheckoutWorkflow";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const mockedDeviceSession = vi.mocked(getOrCreateDeviceSession);

const WORKSPACE_ID = "ws-1";
const PROFILE_ID = "profile-1";
const DEVICE_ID = "device-1";

const makePack = (overrides: Partial<OfflineCheckoutPack> = {}): OfflineCheckoutPack => ({
  schema_version: 1,
  pack_version: "v1",
  workspace_id: WORKSPACE_ID,
  profile_id: PROFILE_ID,
  device_id: DEVICE_ID,
  prepared_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  borrowers: [{ id: "b-1", username: "jdoe", borrower_id: "1234AB" }],
  items: [
    { id: "item-1", name: "Widget", barcode: "ITEM-1", status: "available", checked_out_by: null },
    { id: "item-2", name: "Gadget", barcode: "ITEM-2", status: "checked_out", checked_out_by: "b-1" },
  ],
  ...overrides,
});

const makeLedgerEntry = (overrides: Partial<OfflineLedgerEntry> = {}): OfflineLedgerEntry => ({
  schema_version: 1,
  id: "entry-1",
  operation_id: "op-1",
  workspace_id: WORKSPACE_ID,
  profile_id: PROFILE_ID,
  device_id: DEVICE_ID,
  pack_version: "v1",
  created_at: new Date().toISOString(),
  status: "pending",
  attempts: 0,
  last_error: null,
  items: [
    {
      item_id: "item-1",
      barcode: "ITEM-1",
      name: "Widget",
      intent: "checkout",
      borrower_id: "b-1",
      borrower_display_id: "1234AB",
      borrower_username: "jdoe",
      expected_status: "available",
      expected_checked_out_by: null,
      status: "pending",
    },
  ],
  ...overrides,
});

beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockedInvoke.mockReset();
  mockedDeviceSession.mockReturnValue({ deviceId: DEVICE_ID } as ReturnType<typeof getOrCreateDeviceSession>);
  await clearOfflineCheckoutWorkflow();
  clearAuthState();
});

afterEach(async () => {
  await clearOfflineCheckoutWorkflow();
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearAuthState();
});

describe("isOfflineSessionInitializingError", () => {
  it("matches the exact initializing-error message", () => {
    expect(isOfflineSessionInitializingError(new Error(OFFLINE_SESSION_INITIALIZING_ERROR))).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isOfflineSessionInitializingError(new Error("something else"))).toBe(false);
    expect(isOfflineSessionInitializingError("not an error")).toBe(false);
  });
});

describe("pack + ledger round trip and scoping", () => {
  it("writes and reads back an offline pack for a matching scope", async () => {
    const pack = makePack();
    await writeOfflinePack(pack);

    const read = await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID, deviceId: DEVICE_ID });
    expect(read).toEqual(pack);
  });

  it("clears the workflow and returns null when the pack scope does not match the caller", async () => {
    await writeOfflinePack(makePack());

    const read = await readOfflinePack({ workspaceId: "other-workspace", profileId: PROFILE_ID, deviceId: DEVICE_ID });
    expect(read).toBeNull();

    // Scope mismatch wipes the workflow, so a same-scope read afterward is also empty.
    const readAgain = await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID, deviceId: DEVICE_ID });
    expect(readAgain).toBeNull();
  });

  it("returns null for an expired pack unless allowExpired is set", async () => {
    const expiredPack = makePack({ expires_at: new Date(Date.now() - 1000).toISOString() });
    await writeOfflinePack(expiredPack);

    const scope = { workspaceId: WORKSPACE_ID, profileId: PROFILE_ID, deviceId: DEVICE_ID };
    expect(await readOfflinePack(scope)).toBeNull();
    expect(await readOfflinePack(scope, { allowExpired: true })).toEqual(expiredPack);
  });

  it("round-trips the ledger", async () => {
    expect(await readOfflineLedger()).toEqual([]);
    const entry = makeLedgerEntry();
    await writeOfflineLedger([entry]);
    expect(await readOfflineLedger()).toEqual([entry]);
  });
});

describe("findOfflineBorrower / findOfflineItem / getOfflineCheckedOutItems", () => {
  const scope = { workspaceId: WORKSPACE_ID, profileId: PROFILE_ID, deviceId: DEVICE_ID };

  it("finds a borrower and an item from the pack when there is no ledger overlay", async () => {
    await writeOfflinePack(makePack());

    expect(await findOfflineBorrower(scope, "1234AB")).toMatchObject({ id: "b-1" });
    expect(await findOfflineBorrower(scope, "nope")).toBeNull();
    expect(await findOfflineItem(scope, "ITEM-1")).toMatchObject({ status: "available" });
    expect(await getOfflineCheckedOutItems(scope, "b-1")).toHaveLength(1);
  });

  it("applies a pending checkout ledger entry as an overlay on top of the pack", async () => {
    await writeOfflinePack(makePack());
    await writeOfflineLedger([makeLedgerEntry()]);

    const item = await findOfflineItem(scope, "ITEM-1");
    expect(item).toMatchObject({ status: "checked_out", checked_out_by: "b-1" });
  });

  it("applies a kept_server ledger entry's server_state instead of the intent", async () => {
    await writeOfflinePack(makePack());
    await writeOfflineLedger([
      makeLedgerEntry({
        items: [
          {
            item_id: "item-1",
            barcode: "ITEM-1",
            name: "Widget",
            intent: "checkout",
            borrower_id: "b-1",
            borrower_display_id: "1234AB",
            borrower_username: "jdoe",
            expected_status: "available",
            expected_checked_out_by: null,
            status: "kept_server",
            server_state: { status: "damaged", checked_out_by: null },
          },
        ],
      }),
    ]);

    const item = await findOfflineItem(scope, "ITEM-1");
    expect(item).toMatchObject({ status: "damaged", checked_out_by: null });
  });

  it("throws when no pack has been prepared for this device", async () => {
    await expect(findOfflineItem(scope, "ITEM-1")).rejects.toThrow(/offline checkout is unavailable/i);
  });
});

describe("queueOfflineOperation", () => {
  beforeEach(() => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
  });

  it("throws when no offline pack exists yet", async () => {
    await expect(
      queueOfflineOperation({ operationId: "op-1", borrower: null, items: [] })
    ).rejects.toThrow(/offline checkout is unavailable/i);
  });

  it("appends a pending ledger entry built from the pack and draft, and returns the active count", async () => {
    const pack = makePack();
    await writeOfflinePack(pack);

    const activeCount = await queueOfflineOperation({
      operationId: "op-new",
      borrower: { id: "b-1", username: "jdoe", borrower_id: "1234AB" },
      items: [{ item: pack.items[0]!, intent: "checkout" }],
    });

    expect(activeCount).toBe(1);
    const [entry] = await readOfflineLedger();
    expect(entry).toMatchObject({
      operation_id: "op-new",
      status: "pending",
      workspace_id: WORKSPACE_ID,
      device_id: DEVICE_ID,
    });
    expect(entry!.items[0]).toMatchObject({
      item_id: "item-1",
      intent: "checkout",
      borrower_id: "b-1",
      expected_status: "available",
    });
  });
});

describe("getOfflineWorkflowSummary", () => {
  it("returns zeroed counts when unauthenticated and nothing is queued", async () => {
    const summary = await getOfflineWorkflowSummary();
    expect(summary).toMatchObject({ pack: null, pendingCount: 0, syncingCount: 0, reviewCount: 0 });
  });

  it("counts pending/syncing/review ledger entries once a pack and ledger exist", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    await writeOfflinePack(makePack());
    await writeOfflineLedger([
      makeLedgerEntry({ id: "e1", status: "pending" }),
      makeLedgerEntry({ id: "e2", status: "syncing" }),
      makeLedgerEntry({ id: "e3", status: "needs_review" }),
      makeLedgerEntry({ id: "e4", status: "synced" }),
    ]);

    const summary = await getOfflineWorkflowSummary();
    expect(summary.pendingCount).toBe(2); // pending + syncing both count as pending
    expect(summary.syncingCount).toBe(1);
    expect(summary.reviewCount).toBe(1);
    expect(summary.packExpired).toBe(false);
  });
});

describe("listOfflineReviewEntries", () => {
  it("returns unscoped needs_review entries when unauthenticated", async () => {
    await writeOfflineLedger([
      makeLedgerEntry({ id: "e1", status: "needs_review" }),
      makeLedgerEntry({ id: "e2", status: "pending" }),
    ]);
    const entries = await listOfflineReviewEntries();
    expect(entries.map((e) => e.id)).toEqual(["e1"]);
  });

  it("scopes to the current auth/device and wipes the workflow if any entry is out of scope", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    await writeOfflineLedger([
      makeLedgerEntry({ id: "e1", status: "needs_review" }),
      makeLedgerEntry({ id: "e2", status: "needs_review", workspace_id: "someone-elses-workspace" }),
    ]);

    const entries = await listOfflineReviewEntries();
    expect(entries).toEqual([]);
    expect(await readOfflineLedger()).toEqual([]);
  });
});

describe("markOfflineEntryNeedsReview / keepOfflineServerStateLocally", () => {
  it("marks a matching entry and its items as needs_review with a reason and server_state", async () => {
    await writeOfflineLedger([makeLedgerEntry({ id: "e1" })]);

    await markOfflineEntryNeedsReview("e1", "Server state changed.", { status: "damaged" });

    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("needs_review");
    expect(entry!.review_origin).toBe("server_conflict");
    expect(entry!.items[0]!.status).toBe("needs_review");
    expect(entry!.items[0]!.server_state).toEqual({ status: "damaged" });
  });

  it("marks the entry kept_server and clears the error via keepOfflineServerStateLocally", async () => {
    await writeOfflineLedger([makeLedgerEntry({ id: "e1", status: "needs_review", last_error: "conflict" })]);

    await keepOfflineServerStateLocally("e1");

    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("kept_server");
    expect(entry!.resolution).toBe("keep_server");
    expect(entry!.last_error).toBeNull();
    expect(entry!.items.every((item) => item.status === "kept_server")).toBe(true);
  });
});

describe("syncOfflineCheckoutLedger", () => {
  beforeEach(() => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
  });

  it("returns all-zero when there is no offline pack", async () => {
    expect(await syncOfflineCheckoutLedger()).toEqual({ processed: 0, failed: 0, remaining: 0, review: 0 });
  });

  it("returns the review count when there is nothing pending to sync", async () => {
    await writeOfflinePack(makePack());
    await writeOfflineLedger([makeLedgerEntry({ id: "e1", status: "needs_review" })]);

    expect(await syncOfflineCheckoutLedger()).toEqual({ processed: 0, failed: 0, remaining: 0, review: 1 });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("marks a successfully synced entry as synced", async () => {
    await writeOfflinePack(makePack());
    await writeOfflineLedger([makeLedgerEntry({ id: "e1" })]);
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: {
        data: {
          operations: [
            {
              operation_id: "op-1",
              status: "synced",
              item_results: [{ item_id: "item-1", barcode: "ITEM-1", status: "synced" }],
            },
          ],
        },
      },
    });

    const result = await syncOfflineCheckoutLedger();
    expect(result).toEqual({ processed: 1, failed: 0, remaining: 0, review: 0 });
    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("synced");
  });

  it("marks entries needs_review when the server flags a conflict", async () => {
    await writeOfflinePack(makePack());
    await writeOfflineLedger([makeLedgerEntry({ id: "e1" })]);
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: {
        data: {
          operations: [
            {
              operation_id: "op-1",
              status: "needs_review",
              item_results: [{ item_id: "item-1", barcode: "ITEM-1", status: "needs_review", reason: "Item already checked out" }],
            },
          ],
        },
      },
    });

    const result = await syncOfflineCheckoutLedger();
    expect(result).toEqual({ processed: 0, failed: 1, remaining: 0, review: 1 });
    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("needs_review");
    expect(entry!.last_error).toBe("Item already checked out");
  });

  it("requeues as pending (not needs_review) on a retryable server failure", async () => {
    await writeOfflinePack(makePack());
    await writeOfflineLedger([makeLedgerEntry({ id: "e1" })]);
    mockedInvoke.mockResolvedValue({ ok: false, status: 503, error: "upstream unavailable", data: null });

    const result = await syncOfflineCheckoutLedger();
    expect(result).toEqual({ processed: 0, failed: 1, remaining: 1, review: 0 });
    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("pending");
    expect(entry!.attempts).toBe(1);
  });

  it("moves entries to needs_review on a non-retryable server failure", async () => {
    await writeOfflinePack(makePack());
    await writeOfflineLedger([makeLedgerEntry({ id: "e1" })]);
    mockedInvoke.mockResolvedValue({ ok: false, status: 422, error: "rejected by server", data: null });

    const result = await syncOfflineCheckoutLedger();
    expect(result).toEqual({ processed: 0, failed: 1, remaining: 0, review: 1 });
    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("needs_review");
    expect(entry!.review_origin).toBe("request_rejection");
  });
});

describe("resolveOfflineCheckoutConflict", () => {
  it("throws when the entry does not exist or is not in needs_review", async () => {
    await expect(resolveOfflineCheckoutConflict("missing", "keep_server")).rejects.toThrow(/no longer needs review/i);

    await writeOfflineLedger([makeLedgerEntry({ id: "e1", status: "pending" })]);
    await expect(resolveOfflineCheckoutConflict("e1", "keep_server")).rejects.toThrow(/no longer needs review/i);
  });

  it("resolves keep_server locally without a network call when there was no server-created conflict", async () => {
    await writeOfflineLedger([makeLedgerEntry({ id: "e1", status: "needs_review" })]);

    await resolveOfflineCheckoutConflict("e1", "keep_server");

    expect(mockedInvoke).not.toHaveBeenCalled();
    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("kept_server");
  });

  it("calls the edge function to resolve a server-originated conflict and applies the result", async () => {
    await writeOfflineLedger([
      makeLedgerEntry({ id: "e1", status: "needs_review", review_origin: "server_conflict" }),
    ]);
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { operation_id: "op-1", status: "resolved", resolution: "apply_offline", item_results: [] } },
    });

    await resolveOfflineCheckoutConflict("e1", "apply_offline");

    expect(mockedInvoke).toHaveBeenCalledWith(
      "offline-checkout",
      expect.objectContaining({ method: "POST", body: expect.objectContaining({ action: "resolve", resolution: "apply_offline" }) })
    );
    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("synced");
    expect(entry!.resolution).toBe("apply_offline");
  });

  it("throws when the resolve request fails", async () => {
    await writeOfflineLedger([
      makeLedgerEntry({ id: "e1", status: "needs_review", review_origin: "server_conflict" }),
    ]);
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "boom", data: null });

    await expect(resolveOfflineCheckoutConflict("e1", "apply_offline")).rejects.toThrow("boom");
  });
});

describe("prepareOfflineCheckoutPack", () => {
  it("throws when there is no authenticated workspace session", async () => {
    await expect(prepareOfflineCheckoutPack()).rejects.toThrow(/workspace session is required/i);
  });

  it("throws when there are active (pending/syncing/needs_review) ledger entries blocking a refresh", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    await writeOfflinePack(makePack());
    await writeOfflineLedger([makeLedgerEntry({ id: "e1", status: "pending" })]);

    await expect(prepareOfflineCheckoutPack()).rejects.toThrow(/sync or resolve pending offline transactions/i);
  });

  it("prepares and persists a fresh pack, clearing out resolved ledger entries", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    await writeOfflineLedger([makeLedgerEntry({ id: "e1", status: "synced" })]);
    const prepared = makePack();
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: {
        data: {
          pack_version: prepared.pack_version,
          workspace_id: WORKSPACE_ID,
          prepared_at: prepared.prepared_at,
          expires_at: prepared.expires_at,
          borrowers: prepared.borrowers,
          items: prepared.items,
        },
      },
    });

    const pack = await prepareOfflineCheckoutPack();
    expect(pack.workspace_id).toBe(WORKSPACE_ID);
    expect(pack.device_id).toBe(DEVICE_ID);
    expect(await readOfflineLedger()).toEqual([]);
  });

  it("throws when the prepared pack's workspace does not match the current session", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { ...makePack(), workspace_id: "wrong-workspace" } },
    });

    await expect(prepareOfflineCheckoutPack()).rejects.toThrow(/does not match this session/i);
  });
});

describe("refreshOfflineCheckoutPackIfNeeded", () => {
  it("skips when the browser reports offline", async () => {
    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const result = await refreshOfflineCheckoutPackIfNeeded();
    expect(result).toEqual({ refreshed: false, firstPreparation: false, skippedReason: "offline" });
    expect(mockedInvoke).not.toHaveBeenCalled();
    onlineSpy.mockRestore();
  });

  it("skips when unauthenticated", async () => {
    const result = await refreshOfflineCheckoutPackIfNeeded();
    expect(result).toEqual({ refreshed: false, firstPreparation: false, skippedReason: "unauthenticated" });
  });

  it("skips when there are pending transactions blocking a refresh", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    await writeOfflineLedger([makeLedgerEntry({ id: "e1", status: "pending" })]);

    const result = await refreshOfflineCheckoutPackIfNeeded();
    expect(result.skippedReason).toBe("pending_transactions");
  });

  it("skips when an existing pack is already current and force is not set", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    await writeOfflinePack(makePack({ prepared_at: new Date().toISOString() }));

    const result = await refreshOfflineCheckoutPackIfNeeded();
    expect(result).toEqual({ refreshed: false, firstPreparation: false, skippedReason: "up_to_date" });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("prepares a new pack when forced even if the existing one is current", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    const existing = makePack({ prepared_at: new Date().toISOString() });
    await writeOfflinePack(existing);
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { ...existing, pack_version: "v2" } },
    });

    const result = await refreshOfflineCheckoutPackIfNeeded({ force: true });
    expect(result).toEqual({ refreshed: true, firstPreparation: false });
  });

  it("dedupes concurrent calls to a single in-flight preparation", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    const prepared = makePack();
    let resolveInvoke: (value: unknown) => void = () => {};
    mockedInvoke.mockReturnValue(
      new Promise<unknown>((resolve) => {
        resolveInvoke = resolve;
      }) as ReturnType<typeof invokeEdgeFunction>
    );

    const first = refreshOfflineCheckoutPackIfNeeded({ force: true });
    const second = refreshOfflineCheckoutPackIfNeeded({ force: true });
    expect(first).toBe(second);

    resolveInvoke({ ok: true, status: 200, error: "", data: { data: prepared } });
    await first;
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });
});

describe("applyConfirmedTransactionToOfflinePack", () => {
  it("returns false when there is no pack or the pack scope does not match", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    const applied = await applyConfirmedTransactionToOfflinePack({ borrower: null, items: [] });
    expect(applied).toBe(false);
  });

  it("applies a confirmed checkout to the local pack immediately", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    const pack = makePack();
    await writeOfflinePack(pack);

    const applied = await applyConfirmedTransactionToOfflinePack({
      borrower: { id: "b-2", username: "new-borrower", borrower_id: "9999ZZ" },
      items: [{ item: pack.items[0]!, intent: "checkout" }],
    });

    expect(applied).toBe(true);
    const updated = await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID, deviceId: DEVICE_ID });
    expect(updated!.items[0]).toMatchObject({ status: "checked_out", checked_out_by: "b-2" });
  });
});
