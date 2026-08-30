import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOfflineCheckoutQueue,
  consumeCheckoutOfflineWarning,
  ensureCheckoutOperationId,
  getOfflineQueueScope,
  getOfflineQueueSummary,
  getBufferedCheckoutCount,
  isOfflineQueueItemScopedTo,
  listOfflineQueueReviewItems,
  discardOfflineQueueReviewItem,
  queueCheckoutPayload,
  quarantineOfflineCheckoutQueueForCurrentSession,
  readOfflineQueue,
  writeOfflineQueue,
  type CheckoutReturnPayload,
} from "./offlineCheckoutQueue";
import { clearAuthState, setAuthStateFromBackend } from "../store/authState";

const QUEUE_KEY = "itemtraxx:checkout-offline-buffer:v1";
const LOCK_KEY = "itemtraxx:checkout-offline-buffer:lock:v1";

const payload = (barcode: string): CheckoutReturnPayload => ({
  borrower_id: "1234AB",
  item_barcodes: [barcode],
  action_type: "checkout",
});

beforeEach(async () => {
  clearAuthState(true);
  window.localStorage.clear();
  window.sessionStorage.clear();
  await clearOfflineCheckoutQueue();
});

afterEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  await clearOfflineCheckoutQueue();
  clearAuthState(true);
});

describe("ensureCheckoutOperationId", () => {
  it("assigns a fresh operation id when none is present", () => {
    const result = ensureCheckoutOperationId(payload("ITEM-1"));
    expect(typeof result.operation_id).toBe("string");
    expect(result.operation_id!.length).toBeGreaterThan(0);
  });

  it("preserves an existing operation id", () => {
    const withId = { ...payload("ITEM-1"), operation_id: "op-existing" };
    expect(ensureCheckoutOperationId(withId).operation_id).toBe("op-existing");
  });
});

describe("encrypted queue round trip", () => {
  it("queues, encrypts, persists, and decrypts a checkout payload", async () => {
    const count = await queueCheckoutPayload(payload("ITEM-1"));
    expect(count).toBe(1);

    const raw = window.localStorage.getItem(QUEUE_KEY);
    expect(raw).toBeTruthy();
    const envelope = JSON.parse(raw!);
    expect(envelope).toHaveProperty("cipher");
    expect(envelope).toHaveProperty("iv");
    // The plaintext barcode must never appear in the persisted ciphertext envelope.
    expect(raw).not.toContain("ITEM-1");

    const queue = await readOfflineQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.payload.item_barcodes).toEqual(["ITEM-1"]);
    expect(queue[0]!.attempts).toBe(0);
    expect(queue[0]!.last_error).toBeNull();
    expect(typeof queue[0]!.payload.operation_id).toBe("string");
  });

  it("binds newly queued legacy entries to the current workspace, profile, and device", async () => {
    window.localStorage.setItem("itemtraxx-device-id", "device-1");
    setAuthStateFromBackend({
      isAuthenticated: true,
      userId: "profile-1",
      workspaceContextId: "workspace-1",
    });

    await queueCheckoutPayload(payload("ITEM-1"));

    await expect(readOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        workspace_id: "workspace-1",
        profile_id: "profile-1",
        device_id: "device-1",
      }),
    ]);
  });

  it("appends multiple queued items and reflects the growing count", async () => {
    await queueCheckoutPayload(payload("ITEM-1"));
    const secondCount = await queueCheckoutPayload(payload("ITEM-2"), "network error");

    expect(secondCount).toBe(2);
    expect(await getBufferedCheckoutCount()).toBe(2);

    const queue = await readOfflineQueue();
    expect(queue.map((item) => item.payload.item_barcodes[0])).toEqual(["ITEM-1", "ITEM-2"]);
    expect(queue[1]!.last_error).toBe("network error");
  });

  it("returns 0 for a fresh queue with nothing persisted", async () => {
    expect(await getBufferedCheckoutCount()).toBe(0);
    expect(await readOfflineQueue()).toEqual([]);
  });
});

describe("legacy plaintext migration", () => {
  it("reads a legacy plaintext array and migrates it to the encrypted envelope", async () => {
    const legacyItem = {
      id: "legacy-1",
      payload: payload("LEGACY-1"),
      created_at: new Date().toISOString(),
      attempts: 0,
      last_error: null,
    };
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify([legacyItem]));

    const queue = await readOfflineQueue();
    expect(queue).toEqual([legacyItem]);

    const rawAfterMigration = window.localStorage.getItem(QUEUE_KEY);
    const envelope = JSON.parse(rawAfterMigration!);
    expect(envelope).toHaveProperty("cipher");
    expect(rawAfterMigration).not.toContain("LEGACY-1");

    // A second read must decrypt correctly rather than re-treating it as legacy.
    expect(await readOfflineQueue()).toEqual([legacyItem]);
  });
});

describe("legacy queue identity quarantine", () => {
  it("marks unbound and mismatched entries for review while preserving exact-scope entries", async () => {
    window.localStorage.setItem("itemtraxx-device-id", "device-1");
    setAuthStateFromBackend({
      isAuthenticated: true,
      userId: "profile-1",
      workspaceContextId: "workspace-1",
    });
    const current = {
      id: "current",
      payload: payload("CURRENT"),
      created_at: "2026-01-01T00:00:00Z",
      attempts: 0,
      last_error: null,
      workspace_id: "workspace-1",
      profile_id: "profile-1",
      device_id: "device-1",
    };
    const unbound = {
      id: "unbound",
      payload: payload("UNBOUND"),
      created_at: "2026-01-01T00:00:00Z",
      attempts: 0,
      last_error: null,
    };
    const otherUser = {
      id: "other-user",
      payload: payload("OTHER"),
      created_at: "2026-01-01T00:00:00Z",
      attempts: 0,
      last_error: null,
      workspace_id: "workspace-1",
      profile_id: "profile-2",
      device_id: "device-1",
    };
    await writeOfflineQueue([current, unbound, otherUser]);

    await expect(quarantineOfflineCheckoutQueueForCurrentSession()).resolves.toBe(2);
    const queue = await readOfflineQueue();
    expect(queue[0]).toEqual(current);
    expect(queue.slice(1)).toEqual([
      expect.objectContaining({ id: "unbound", review_required: true, last_error: expect.stringMatching(/manual review/i) }),
      expect.objectContaining({ id: "other-user", review_required: true, last_error: expect.stringMatching(/manual review/i) }),
    ]);
    expect(isOfflineQueueItemScopedTo(queue[0]!, getOfflineQueueScope()!)).toBe(true);
    expect(isOfflineQueueItemScopedTo(queue[1]!, getOfflineQueueScope()!)).toBe(false);
  });

  it("lists only safe generic metadata and discards exactly one review-required item", async () => {
    window.localStorage.setItem("itemtraxx-device-id", "device-1");
    setAuthStateFromBackend({
      isAuthenticated: true,
      userId: "profile-1",
      workspaceContextId: "workspace-1",
    });
    const pending = {
      id: "pending",
      payload: payload("PENDING"),
      created_at: "2026-01-01T00:00:00Z",
      attempts: 0,
      last_error: null,
    };
    const review = {
      id: "legacy-review",
      payload: {
        ...payload("PRIVATE-ITEM"),
        borrower_id: "PRIVATE-BORROWER",
        action_type: "checkout" as const,
      },
      created_at: "2026-01-01T00:00:00Z",
      attempts: 2,
      last_error: "PRIVATE ERROR DETAILS",
      review_required: true,
    };
    const malformedReview = {
      id: "legacy-invalid-date",
      payload: { action_type: "unknown-action", item_barcodes: ["SAFE-COUNT"] },
      created_at: "not-a-date",
      attempts: 0,
      last_error: "PRIVATE ERROR DETAILS",
      review_required: true,
    };
    await writeOfflineQueue([null, pending, review, malformedReview] as never);

    await expect(getOfflineQueueSummary()).resolves.toEqual({ totalCount: 4, pendingCount: 2, reviewCount: 2 });
    const reviewItems = await listOfflineQueueReviewItems();
    expect(reviewItems).toEqual([
      { id: "legacy-review", created_at: "2026-01-01T00:00:00Z", action_type: "checkout", item_count: 1 },
      { id: "legacy-invalid-date", created_at: null, action_type: "legacy", item_count: 1 },
    ]);
    expect(JSON.stringify(reviewItems)).not.toContain("PRIVATE");

    await expect(discardOfflineQueueReviewItem("legacy-review")).resolves.toBe(1);
    await expect(readOfflineQueue()).resolves.toEqual([
      null,
      pending,
      malformedReview,
    ]);
    await expect(discardOfflineQueueReviewItem("pending")).rejects.toThrow(/no longer available/i);

    clearAuthState(true);
    await expect(listOfflineQueueReviewItems()).resolves.toEqual([]);
    await expect(discardOfflineQueueReviewItem("legacy-invalid-date")).rejects.toThrow(/workspace session/i);
  });
});

describe("corrupted queue recovery", () => {
  it("resets the queue and surfaces a one-time warning when the persisted value is garbage", async () => {
    window.localStorage.setItem(QUEUE_KEY, "{not valid json at all");

    const queue = await readOfflineQueue();
    expect(queue).toEqual([]);
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();

    const warning = consumeCheckoutOfflineWarning();
    expect(warning).toMatch(/reset because local data could not be verified/i);
    expect(consumeCheckoutOfflineWarning()).toBeNull();
  });

  it("treats an envelope-shaped object with an unsupported version as corrupted and resets rather than throwing", async () => {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify({ cipher: "not-real-ciphertext", version: 999 }));

    // decryptOfflineQueue throws "invalid-offline-queue" for unsupported versions,
    // but that throw happens inside readOfflineQueue's own try/catch, so it's
    // treated the same as malformed JSON: reset + one-time warning, not a rejection.
    const queue = await readOfflineQueue();
    expect(queue).toEqual([]);
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(consumeCheckoutOfflineWarning()).toMatch(/reset because local data could not be verified/i);
  });
});

describe("clearOfflineCheckoutQueue", () => {
  it("removes the queue, the lock, and the legacy session key version marker", async () => {
    await queueCheckoutPayload(payload("ITEM-1"));
    window.localStorage.setItem(LOCK_KEY, JSON.stringify({ owner: "x", expires_at: Date.now() + 1000 }));
    window.sessionStorage.setItem("itemtraxx:checkout-offline-buffer:key:v1", "stale-key-material");

    await clearOfflineCheckoutQueue();

    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LOCK_KEY)).toBeNull();
    expect(window.sessionStorage.getItem("itemtraxx:checkout-offline-buffer:key:v1")).toBeNull();
    expect(await readOfflineQueue()).toEqual([]);
  });
});

describe("lock acquire/release across sequential operations", () => {
  it("releases the lease after each call so a second call does not deadlock", async () => {
    await queueCheckoutPayload(payload("ITEM-1"));
    expect(window.localStorage.getItem(LOCK_KEY)).toBeNull();

    const count = await queueCheckoutPayload(payload("ITEM-2"));
    expect(count).toBe(2);
    expect(window.localStorage.getItem(LOCK_KEY)).toBeNull();
  });
});

describe("writeOfflineQueue", () => {
  it("persists an empty queue as a valid encrypted envelope", async () => {
    await writeOfflineQueue([]);
    expect(await readOfflineQueue()).toEqual([]);
  });
});
