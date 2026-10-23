import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthState, setAuthStateFromBackend } from "../store/authState";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("../utils/deviceSession", () => ({
  getOrCreateDeviceSession: vi.fn(() => ({ deviceId: "device-1" })),
}));
vi.mock("./accountSessionService", () => ({
  ensureAccountSessionReady: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import { ensureAccountSessionReady } from "./accountSessionService";
import { setOfflinePackDownloadPreference } from "./offlineCheckoutPreferences";
import {
  OFFLINE_PACK_LARGE_WARNING_EVENT,
  resolveLargeOfflinePackConfirmation,
} from "./offlinePackConfirmation";
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
  OfflinePackDownloadCancelledError,
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
const mockedEnsureAccountSessionReady = vi.mocked(ensureAccountSessionReady);

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

const edgeSuccess = (payload: unknown) => ({
  ok: true,
  status: 200,
  error: "",
  data: { data: payload },
});

const configureChunkedPackResponses = (
  pack: OfflineCheckoutPack,
  manifestOverrides: Partial<{ item_count: number; borrower_count: number }> = {},
) => {
  const actions: string[] = [];
  mockedInvoke.mockImplementation(async (_functionName, options) => {
    const body = (options as { body?: Record<string, unknown> } | undefined)?.body ?? {};
    const action = String(body.action ?? "");
    actions.push(action);
    if (action === "prepare_pack") {
      return edgeSuccess({
        pack_version: pack.pack_version,
        workspace_id: pack.workspace_id,
        prepared_at: pack.prepared_at,
        expires_at: pack.expires_at,
        item_count: manifestOverrides.item_count ?? pack.items.length,
        borrower_count: manifestOverrides.borrower_count ?? pack.borrowers.length,
        chunk_size: 100,
        max_records: 10_000,
        max_bytes: 25 * 1024 * 1024,
      }) as never;
    }
    if (action === "prepare_pack_chunk") {
      const firstChunk = !body.after_item_id && !body.after_borrower_id;
      return edgeSuccess({
        items: firstChunk ? pack.items : [],
        borrowers: firstChunk ? pack.borrowers : [],
        next_item_id: firstChunk ? pack.items.at(-1)?.id ?? null : null,
        next_borrower_id: firstChunk ? pack.borrowers.at(-1)?.id ?? null : null,
        item_count: manifestOverrides.item_count ?? pack.items.length,
        borrower_count: manifestOverrides.borrower_count ?? pack.borrowers.length,
      }) as never;
    }
    if (action === "cancel_pack") return edgeSuccess({ cancelled: true }) as never;
    if (action === "complete_pack") return edgeSuccess({ pack_version: pack.pack_version, download_complete: true }) as never;
    if (action === "activate_pack") return edgeSuccess({ pack_version: pack.pack_version, activated: true }) as never;
    return { ok: false, status: 400, error: `Unexpected action: ${action}`, data: null } as never;
  });
  return actions;
};

const allowAutomaticPackDownloads = () =>
  setOfflinePackDownloadPreference({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID }, "always");

beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockedInvoke.mockReset();
  mockedDeviceSession.mockReturnValue({ deviceId: DEVICE_ID } as ReturnType<typeof getOrCreateDeviceSession>);
  mockedEnsureAccountSessionReady.mockReset().mockResolvedValue({ ok: true });
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

  it("materializes every queued offline action into the cached item snapshot", async () => {
    const pack = makePack();
    await writeOfflinePack(pack);

    await queueOfflineOperation({
      operationId: "op-checkout",
      borrower: { id: "b-2", username: "new-borrower", borrower_id: "9999ZZ" },
      items: [{ item: pack.items[0]!, intent: "checkout" }],
    });
    let cached = await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID, deviceId: DEVICE_ID });
    expect(cached!.borrowers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "b-2", borrower_id: "9999ZZ" }),
    ]));
    expect(cached!.items[0]).toMatchObject({ status: "checked_out", checked_out_by: "b-2" });

    await queueOfflineOperation({
      operationId: "op-return",
      borrower: { id: "b-2", username: "new-borrower", borrower_id: "9999ZZ" },
      items: [{ item: cached!.items[0]!, intent: "return" }],
    });
    cached = await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID, deviceId: DEVICE_ID });
    expect(cached!.items[0]).toMatchObject({ status: "available", checked_out_by: null });
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
    expect(mockedEnsureAccountSessionReady).toHaveBeenCalledTimes(1);
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

  it("leaves pending entries retryable when session bootstrap fails", async () => {
    await writeOfflinePack(makePack());
    await writeOfflineLedger([makeLedgerEntry({ id: "e1" })]);
    mockedEnsureAccountSessionReady.mockRejectedValueOnce(new Error("Session revoked"));

    await expect(syncOfflineCheckoutLedger()).rejects.toThrow("Session revoked");
    const [entry] = await readOfflineLedger();
    expect(entry!.status).toBe("pending");
    expect(mockedInvoke).not.toHaveBeenCalled();
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

    expect(mockedEnsureAccountSessionReady).toHaveBeenCalledTimes(1);
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
    const actions = configureChunkedPackResponses(prepared);
    const progress: Array<{ stage: string; downloadedRecords: number; totalRecords: number }> = [];
    const captureProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ stage: string; downloadedRecords: number; totalRecords: number }>).detail;
      progress.push(detail);
    };
    window.addEventListener("itemtraxx:offline-pack-progress", captureProgress);

    const pack = await prepareOfflineCheckoutPack();
    window.removeEventListener("itemtraxx:offline-pack-progress", captureProgress);
    expect(pack.workspace_id).toBe(WORKSPACE_ID);
    expect(pack.device_id).toBe(DEVICE_ID);
    expect(pack.items).toEqual(prepared.items);
    expect(pack.borrowers).toEqual(prepared.borrowers);
    expect(actions).toEqual([
      "prepare_pack",
      "prepare_pack_chunk",
      "prepare_pack_chunk",
      "complete_pack",
      "activate_pack",
    ]);
    expect(progress.map((entry) => entry.stage)).toEqual(["starting", "starting", "downloading", "complete"]);
    expect(progress[2]).toMatchObject({ downloadedRecords: 3, totalRecords: 3 });
    expect(mockedEnsureAccountSessionReady).toHaveBeenCalledTimes(1);
    expect(await readOfflineLedger()).toEqual([]);
  });

  it("throws when the prepared pack's workspace does not match the current session", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    const prepared = makePack();
    mockedInvoke.mockImplementation(async (_functionName, options) => {
      const body = (options as { body?: Record<string, unknown> } | undefined)?.body ?? {};
      if (body.action === "prepare_pack") {
        return edgeSuccess({
          pack_version: prepared.pack_version,
          workspace_id: "wrong-workspace",
          prepared_at: prepared.prepared_at,
          expires_at: prepared.expires_at,
          item_count: prepared.items.length,
          borrower_count: prepared.borrowers.length,
          chunk_size: 100,
          max_records: 10_000,
          max_bytes: 25 * 1024 * 1024,
        }) as never;
      }
      return edgeSuccess({ cancelled: true }) as never;
    });

    await expect(prepareOfflineCheckoutPack()).rejects.toThrow(/does not match this session/i);
  });

  it("does not store one account's response after the active account changes", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    const prepared = makePack();
    mockedInvoke.mockImplementation(async (_functionName, options) => {
      const body = (options as { body?: Record<string, unknown> } | undefined)?.body ?? {};
      if (body.action === "prepare_pack") {
        setAuthStateFromBackend({ isAuthenticated: true, userId: "profile-2", workspaceContextId: WORKSPACE_ID });
        return edgeSuccess({
          pack_version: prepared.pack_version,
          workspace_id: prepared.workspace_id,
          prepared_at: prepared.prepared_at,
          expires_at: prepared.expires_at,
          item_count: prepared.items.length,
          borrower_count: prepared.borrowers.length,
          chunk_size: 100,
          max_records: 10_000,
          max_bytes: 25 * 1024 * 1024,
        }) as never;
      }
      return edgeSuccess({ cancelled: true }) as never;
    });

    await expect(prepareOfflineCheckoutPack()).rejects.toThrow(/account changed/i);
    expect(await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: "profile-2" })).toBeNull();
    expect(await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID })).toBeNull();
  });

  it("keeps the current pack when a chunk fails", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    const current = makePack({ pack_version: "existing" });
    await writeOfflinePack(current);
    mockedInvoke.mockImplementation(async (_functionName, options) => {
      const body = (options as { body?: Record<string, unknown> } | undefined)?.body ?? {};
      if (body.action === "prepare_pack") {
        return edgeSuccess({
          pack_version: "new-pack",
          workspace_id: WORKSPACE_ID,
          prepared_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          item_count: 2,
          borrower_count: 1,
          chunk_size: 100,
          max_records: 10_000,
          max_bytes: 25 * 1024 * 1024,
        }) as never;
      }
      if (body.action === "prepare_pack_chunk") return { ok: false, status: 503, error: "chunk failed", data: null } as never;
      return edgeSuccess({ cancelled: true }) as never;
    });

    await expect(prepareOfflineCheckoutPack()).rejects.toThrow("chunk failed");
    expect(await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID })).toEqual(current);
  });

  it("requires confirmation for large packs and cancels when no choice is made", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    const prepared = makePack({ pack_version: "large-pack" });
    const actions = configureChunkedPackResponses(prepared, { item_count: 2_001 });
    const rejectLargePack = () => resolveLargeOfflinePackConfirmation(false);
    window.addEventListener(OFFLINE_PACK_LARGE_WARNING_EVENT, rejectLargePack, { once: true });

    await expect(prepareOfflineCheckoutPack()).rejects.toBeInstanceOf(OfflinePackDownloadCancelledError);
    expect(actions).toEqual(["prepare_pack", "cancel_pack"]);
    expect(await readOfflinePack({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID })).toBeNull();
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
    allowAutomaticPackDownloads();
    await writeOfflineLedger([makeLedgerEntry({ id: "e1", status: "pending" })]);

    const result = await refreshOfflineCheckoutPackIfNeeded();
    expect(result.skippedReason).toBe("pending_transactions");
  });

  it("skips when an existing pack is already current and force is not set", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    allowAutomaticPackDownloads();
    await writeOfflinePack(makePack({ prepared_at: new Date().toISOString() }));

    const result = await refreshOfflineCheckoutPackIfNeeded();
    expect(result).toEqual({ refreshed: false, firstPreparation: false, skippedReason: "up_to_date" });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("prepares a new pack when forced even if the existing one is current", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    allowAutomaticPackDownloads();
    const existing = makePack({ prepared_at: new Date().toISOString() });
    await writeOfflinePack(existing);
    configureChunkedPackResponses(makePack({ ...existing, pack_version: "v2" }));

    const result = await refreshOfflineCheckoutPackIfNeeded({ force: true });
    expect(result).toEqual({ refreshed: true, firstPreparation: false });
  });

  it("does not automatically download when the account preference is manual or ask has no approval", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });

    const manual = await refreshOfflineCheckoutPackIfNeeded({ force: true });
    expect(manual).toEqual({ refreshed: false, firstPreparation: false, skippedReason: "download_preference" });
    setOfflinePackDownloadPreference({ workspaceId: WORKSPACE_ID, profileId: PROFILE_ID }, "ask");
    const askWithoutApproval = await refreshOfflineCheckoutPackIfNeeded({ force: true });
    expect(askWithoutApproval).toEqual({ refreshed: false, firstPreparation: false, skippedReason: "download_preference" });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("dedupes concurrent calls to a single in-flight preparation", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    allowAutomaticPackDownloads();
    const prepared = makePack();
    let resolveManifest: (value: unknown) => void = () => {};
    const actions: string[] = [];
    mockedInvoke.mockImplementation(async (_functionName, options) => {
      const body = (options as { body?: Record<string, unknown> } | undefined)?.body ?? {};
      const action = String(body.action ?? "");
      actions.push(action);
      if (action === "prepare_pack") {
        return await new Promise<unknown>((resolve) => { resolveManifest = resolve; }) as never;
      }
      if (action === "prepare_pack_chunk") {
        const firstChunk = !body.after_item_id && !body.after_borrower_id;
        return edgeSuccess({
          items: firstChunk ? prepared.items : [],
          borrowers: firstChunk ? prepared.borrowers : [],
          next_item_id: firstChunk ? prepared.items.at(-1)?.id ?? null : null,
          next_borrower_id: firstChunk ? prepared.borrowers.at(-1)?.id ?? null : null,
          item_count: prepared.items.length,
          borrower_count: prepared.borrowers.length,
        }) as never;
      }
      return edgeSuccess({ pack_version: prepared.pack_version, download_complete: true, activated: true }) as never;
    });

    const first = refreshOfflineCheckoutPackIfNeeded({ force: true });
    const second = refreshOfflineCheckoutPackIfNeeded({ force: true });
    expect(first).toBe(second);

    await vi.waitFor(() => expect(mockedInvoke).toHaveBeenCalled());
    resolveManifest(edgeSuccess({
      pack_version: prepared.pack_version,
      workspace_id: prepared.workspace_id,
      prepared_at: prepared.prepared_at,
      expires_at: prepared.expires_at,
      item_count: prepared.items.length,
      borrower_count: prepared.borrowers.length,
      chunk_size: 100,
      max_records: 10_000,
      max_bytes: 25 * 1024 * 1024,
    }));
    await first;
    expect(actions.filter((action) => action === "prepare_pack")).toHaveLength(1);
  });

  it("runs a forced refresh after an in-flight timer check reports the pack is current", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: PROFILE_ID, workspaceContextId: WORKSPACE_ID });
    allowAutomaticPackDownloads();
    const existing = makePack({ prepared_at: new Date().toISOString() });
    await writeOfflinePack(existing);
    configureChunkedPackResponses(makePack({ ...existing, pack_version: "v2" }));

    const timerRefresh = refreshOfflineCheckoutPackIfNeeded();
    const forcedRefresh = refreshOfflineCheckoutPackIfNeeded({ force: true });

    await expect(timerRefresh).resolves.toEqual({ refreshed: false, firstPreparation: false, skippedReason: "up_to_date" });
    await expect(forcedRefresh).resolves.toEqual({ refreshed: true, firstPreparation: false });
    expect(mockedInvoke).toHaveBeenCalledTimes(5);
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
