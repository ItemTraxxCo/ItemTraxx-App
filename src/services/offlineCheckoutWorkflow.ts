import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import { getAuthState } from "../store/authState";
import { markItemTraxxServerConfirmed, markItemTraxxServerUnreachable } from "./offlineConnectionState";

export type OfflinePackBorrower = {
  id: string;
  username: string;
  borrower_id: string;
};

export type OfflinePackItem = {
  id: string;
  name: string;
  barcode: string;
  status: string;
  checked_out_by: string | null;
};

export type OfflineCheckoutPack = {
  schema_version: 1;
  pack_version: string;
  workspace_id: string;
  profile_id: string;
  device_id: string;
  prepared_at: string;
  expires_at: string;
  borrowers: OfflinePackBorrower[];
  items: OfflinePackItem[];
};

export type OfflineWorkflowScope = {
  workspaceId: string;
  profileId: string;
  deviceId?: string;
};

type OfflineItemIntent = {
  item_id: string;
  barcode: string;
  name: string;
  intent: "checkout" | "return" | "quick_return";
  borrower_id: string | null;
  borrower_display_id: string | null;
  borrower_username: string | null;
  expected_status: string;
  expected_checked_out_by: string | null;
  status: "pending" | "synced" | "idempotent" | "needs_review" | "kept_server";
  reason?: string;
  server_state?: unknown;
};

export type OfflineLedgerEntry = {
  schema_version: 1;
  id: string;
  operation_id: string;
  workspace_id: string;
  profile_id: string;
  device_id: string;
  pack_version: string;
  created_at: string;
  status: "pending" | "syncing" | "synced" | "needs_review" | "kept_server";
  attempts: number;
  last_error: string | null;
  items: OfflineItemIntent[];
  resolution?: "keep_server" | "apply_offline";
  review_origin?: "server_conflict" | "request_rejection";
};

type EncryptedRecord = { version: 1; iv: string; cipher: string };
type PreparedPackResponse = Omit<OfflineCheckoutPack, "schema_version" | "profile_id" | "device_id">;
type SyncItemResult = {
  item_id: string;
  barcode: string;
  status: "synced" | "idempotent" | "needs_review" | "kept_server";
  reason?: string;
  server_state?: unknown;
};
type SyncOperationResult = {
  operation_id: string;
  status: "synced" | "needs_review" | "resolved";
  resolution?: "keep_server" | "apply_offline";
  item_results: SyncItemResult[];
};

const DATABASE_NAME = "itemtraxx-offline-workflow";
const DATABASE_VERSION = 1;
const KEY_STORE = "keys";
const RECORD_STORE = "records";
const KEY_ID = "workflow-encryption";
const PACK_ID = "pack";
const LEDGER_ID = "ledger";
const LOCK_NAME = "itemtraxx-offline-workflow";
const LOCK_STORAGE_KEY = "itemtraxx:offline-workflow:lock:v1";
const LOCK_TTL_MS = 30_000;
export const OFFLINE_PACK_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
export const OFFLINE_SESSION_INITIALIZING_ERROR = "Offline session is still initializing. Please retry.";

export const isOfflineSessionInitializingError = (error: unknown) =>
  error instanceof Error && error.message.trim() === OFFLINE_SESSION_INITIALIZING_ERROR;

const ACTIVE_LEDGER_STATES = new Set<OfflineLedgerEntry["status"]>([
  "pending",
  "syncing",
  "needs_review",
]);
let automaticPackRefresh: Promise<{
  refreshed: boolean;
  firstPreparation: boolean;
  skippedReason?: "offline" | "unauthenticated" | "pending_transactions" | "up_to_date";
}> | null = null;

const isRetryableWorkflowStatus = (status: number) => status === 0 || status === 429 || status >= 500;

const recordWorkflowResponse = (ok: boolean, status: number) => {
  if (ok) markItemTraxxServerConfirmed();
  else if (isRetryableWorkflowStatus(status)) markItemTraxxServerUnreachable();
};

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return window.btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) request.result.createObjectStore(KEY_STORE);
      if (!request.result.objectStoreNames.contains(RECORD_STORE)) request.result.createObjectStore(RECORD_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline workflow storage."));
  });

const accessStore = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = callback(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to access offline workflow storage."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to access offline workflow storage."));
    });
  } finally {
    database.close();
  }
};

const getOrCreateKey = async () => {
  const existing = await accessStore<CryptoKey | undefined>(KEY_STORE, "readonly", (store) => store.get(KEY_ID));
  if (existing instanceof CryptoKey) return existing;
  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  await accessStore<IDBValidKey>(KEY_STORE, "readwrite", (store) => store.put(key, KEY_ID));
  return key;
};

const encryptRecord = async (recordId: string, value: unknown): Promise<EncryptedRecord> => {
  const key = await getOrCreateKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(`${DATABASE_NAME}:${recordId}:v1`);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    plaintext,
  );
  return { version: 1, iv: bytesToBase64(iv), cipher: bytesToBase64(new Uint8Array(cipher)) };
};

const decryptRecord = async <T>(recordId: string, record: EncryptedRecord): Promise<T> => {
  if (record?.version !== 1 || !record.iv || !record.cipher) throw new Error("invalid-offline-workflow-record");
  const key = await getOrCreateKey();
  const additionalData = new TextEncoder().encode(`${DATABASE_NAME}:${recordId}:v1`);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(record.iv), additionalData },
    key,
    base64ToBytes(record.cipher),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
};

const readRecord = async <T>(recordId: string, fallback: T) => {
  const encrypted = await accessStore<EncryptedRecord | undefined>(RECORD_STORE, "readonly", (store) => store.get(recordId));
  if (!encrypted) return fallback;
  try {
    return await decryptRecord<T>(recordId, encrypted);
  } catch {
    await accessStore<undefined>(RECORD_STORE, "readwrite", (store) => store.delete(recordId));
    return fallback;
  }
};

const writeRecord = async (recordId: string, value: unknown) => {
  const encrypted = await encryptRecord(recordId, value);
  await accessStore<IDBValidKey>(RECORD_STORE, "readwrite", (store) => store.put(encrypted, recordId));
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const fallbackLock = async <T>(callback: () => Promise<T>) => {
  const owner = createId();
  const startedAt = Date.now();
  while (true) {
    const now = Date.now();
    let current: { owner?: string; expires_at?: number } = {};
    try { current = JSON.parse(window.localStorage.getItem(LOCK_STORAGE_KEY) ?? "{}"); } catch { /* retry */ }
    if (!current.owner || Number(current.expires_at) <= now) {
      window.localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify({ owner, expires_at: now + LOCK_TTL_MS }));
      try {
        const confirmed = JSON.parse(window.localStorage.getItem(LOCK_STORAGE_KEY) ?? "{}") as { owner?: string };
        if (confirmed.owner === owner) break;
      } catch { /* retry */ }
    }
    if (Date.now() - startedAt > LOCK_TTL_MS * 2) throw new Error("Offline workflow storage is busy. Please try again.");
    await sleep(50);
  }
  const heartbeat = window.setInterval(() => {
    window.localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify({ owner, expires_at: Date.now() + LOCK_TTL_MS }));
  }, 1_000);
  try {
    return await callback();
  } finally {
    window.clearInterval(heartbeat);
    try {
      const current = JSON.parse(window.localStorage.getItem(LOCK_STORAGE_KEY) ?? "{}") as { owner?: string };
      if (current.owner === owner) window.localStorage.removeItem(LOCK_STORAGE_KEY);
    } catch { window.localStorage.removeItem(LOCK_STORAGE_KEY); }
  }
};

const withOfflineWorkflowLock = <T>(callback: () => Promise<T>) => {
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, callback);
  }
  return fallbackLock(callback);
};

const scopeMatches = (pack: OfflineCheckoutPack, scope: OfflineWorkflowScope) => {
  const deviceId = scope.deviceId ?? getOrCreateDeviceSession().deviceId;
  return pack.workspace_id === scope.workspaceId && pack.profile_id === scope.profileId && pack.device_id === deviceId;
};

export const writeOfflinePack = (pack: OfflineCheckoutPack) =>
  withOfflineWorkflowLock(() => writeRecord(PACK_ID, pack));

export const readOfflinePack = async (
  scope: OfflineWorkflowScope,
  options: { allowExpired?: boolean } = {},
) => {
  const pack = await readRecord<OfflineCheckoutPack | null>(PACK_ID, null);
  if (!pack) return null;
  if (!scopeMatches(pack, scope)) {
    await clearOfflineCheckoutWorkflow();
    return null;
  }
  if (!options.allowExpired && Date.parse(pack.expires_at) <= Date.now()) return null;
  return pack;
};

export const readOfflineLedger = () => readRecord<OfflineLedgerEntry[]>(LEDGER_ID, []);

export const writeOfflineLedger = (entries: OfflineLedgerEntry[]) =>
  withOfflineWorkflowLock(() => writeRecord(LEDGER_ID, entries));

const updateLedger = (update: (entries: OfflineLedgerEntry[]) => OfflineLedgerEntry[]) =>
  withOfflineWorkflowLock(async () => {
    const entries = await readOfflineLedger();
    const next = update(entries);
    await writeRecord(LEDGER_ID, next);
    window.dispatchEvent(new CustomEvent("itemtraxx:offline-workflow-changed"));
    return next;
  });

export const clearOfflineCheckoutWorkflow = async () => {
  window.localStorage.removeItem(LOCK_STORAGE_KEY);
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([KEY_STORE, RECORD_STORE], "readwrite");
      transaction.objectStore(KEY_STORE).clear();
      transaction.objectStore(RECORD_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // Logout must continue even when browser storage cleanup is unavailable.
  }
};

const currentScope = (): OfflineWorkflowScope => {
  const auth = getAuthState();
  if (!auth.workspaceContextId || !auth.userId) throw new Error("A workspace session is required.");
  return { workspaceId: auth.workspaceContextId, profileId: auth.userId };
};

export const prepareOfflineCheckoutPack = async () => {
  const auth = getAuthState();
  if (!auth.workspaceContextId || !auth.userId || !auth.isAuthenticated) {
    throw new Error("A workspace session is required to prepare offline checkout.");
  }
  const existingPack = await readOfflinePack({ workspaceId: auth.workspaceContextId, profileId: auth.userId }, { allowExpired: true });
  if (!existingPack && (await readOfflineLedger()).length > 0) await clearOfflineCheckoutWorkflow();
  const activeEntries = (await readOfflineLedger()).filter((entry) => ACTIVE_LEDGER_STATES.has(entry.status));
  if (activeEntries.length > 0) {
    throw new Error("Sync or resolve pending offline transactions before refreshing this device's offline pack.");
  }
  const { deviceId } = getOrCreateDeviceSession();
  const response = await invokeEdgeFunction<{ data: PreparedPackResponse }, { action: "prepare_pack"; device_id: string }>(
    "offline-checkout",
    { method: "POST", body: { action: "prepare_pack", device_id: deviceId } },
  );
  recordWorkflowResponse(response.ok, response.status);
  if (!response.ok || !response.data?.data) throw new Error(response.error || "Unable to prepare offline checkout.");
  const pack: OfflineCheckoutPack = {
    ...response.data.data,
    schema_version: 1,
    profile_id: auth.userId,
    device_id: deviceId,
  };
  if (pack.workspace_id !== auth.workspaceContextId) throw new Error("Offline pack workspace does not match this session.");
  await writeOfflinePack(pack);
  await updateLedger((entries) => entries.filter((entry) => ACTIVE_LEDGER_STATES.has(entry.status)));
  return pack;
};

/**
 * Keeps the encrypted local snapshot recent without replacing a working offline ledger.
 * Callers may fire-and-forget this after a confirmed server mutation.
 */
export const refreshOfflineCheckoutPackIfNeeded = (
  options: { force?: boolean } = {},
) => {
  if (automaticPackRefresh) return automaticPackRefresh;

  automaticPackRefresh = (async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { refreshed: false, firstPreparation: false, skippedReason: "offline" as const };
    }
    const auth = getAuthState();
    if (!auth.isAuthenticated || !auth.workspaceContextId || !auth.userId) {
      return { refreshed: false, firstPreparation: false, skippedReason: "unauthenticated" as const };
    }

    const scope = { workspaceId: auth.workspaceContextId, profileId: auth.userId };
    const existingPack = await readOfflinePack(scope, { allowExpired: true });
    const activeEntries = (await readOfflineLedger()).filter((entry) => ACTIVE_LEDGER_STATES.has(entry.status));
    if (activeEntries.length > 0) {
      return { refreshed: false, firstPreparation: false, skippedReason: "pending_transactions" as const };
    }

    const preparedAt = existingPack ? Date.parse(existingPack.prepared_at) : Number.NaN;
    const isCurrent = !!existingPack &&
      Number.isFinite(preparedAt) &&
      Date.now() - preparedAt < OFFLINE_PACK_REFRESH_INTERVAL_MS &&
      Date.parse(existingPack.expires_at) > Date.now();
    if (!options.force && isCurrent) {
      return { refreshed: false, firstPreparation: false, skippedReason: "up_to_date" as const };
    }

    await prepareOfflineCheckoutPack();
    return { refreshed: true, firstPreparation: !existingPack };
  })().finally(() => {
    automaticPackRefresh = null;
  });

  return automaticPackRefresh;
};

const applyLedgerOverlay = (pack: OfflineCheckoutPack, entries: OfflineLedgerEntry[]) => {
  const items = new Map(pack.items.map((item) => [item.barcode, { ...item }]));
  for (const entry of entries) {
    if (entry.workspace_id !== pack.workspace_id || entry.profile_id !== pack.profile_id || entry.device_id !== pack.device_id) continue;
    for (const intent of entry.items) {
      const item = items.get(intent.barcode);
      if (!item) continue;
      if (intent.status === "kept_server") {
        const serverState = intent.server_state && typeof intent.server_state === "object"
          ? intent.server_state as { status?: unknown; checked_out_by?: unknown }
          : null;
        if (typeof serverState?.status === "string") item.status = serverState.status;
        if (serverState && (typeof serverState.checked_out_by === "string" || serverState.checked_out_by === null)) {
          item.checked_out_by = serverState.checked_out_by;
        }
        continue;
      }
      if (intent.intent === "checkout") {
        item.status = "checked_out";
        item.checked_out_by = intent.borrower_id;
      } else {
        item.status = "available";
        item.checked_out_by = null;
      }
    }
  }
  return [...items.values()];
};

const getOverlay = async (scope: OfflineWorkflowScope) => {
  const pack = await readOfflinePack(scope);
  if (!pack) throw new Error("Offline checkout is unavailable. Reconnect and prepare this device for offline use.");
  const ledger = await readOfflineLedger();
  return { pack, items: applyLedgerOverlay(pack, ledger) };
};

export const findOfflineBorrower = async (scope: OfflineWorkflowScope, borrowerId: string) => {
  const { pack } = await getOverlay(scope);
  return pack.borrowers.find((borrower) => borrower.borrower_id === borrowerId) ?? null;
};

export const findOfflineItem = async (scope: OfflineWorkflowScope, barcode: string) => {
  const { items } = await getOverlay(scope);
  return items.find((item) => item.barcode === barcode) ?? null;
};

export const getOfflineCheckedOutItems = async (scope: OfflineWorkflowScope, borrowerUuid: string) => {
  const { items } = await getOverlay(scope);
  return items.filter((item) => item.status.toLowerCase() === "checked_out" && item.checked_out_by === borrowerUuid);
};

/**
 * Applies a server-confirmed checkout or return to this device's encrypted pack
 * before the next background refresh completes. This keeps an immediate outage
 * from reverting the user to the stale pre-transaction snapshot.
 */
export const applyConfirmedTransactionToOfflinePack = async (draft: {
  borrower: OfflinePackBorrower | null;
  items: Array<{ item: OfflinePackItem; intent: "checkout" | "return" | "quick_return" }>;
}) => {
  const scope = currentScope();
  return withOfflineWorkflowLock(async () => {
    const pack = await readRecord<OfflineCheckoutPack | null>(PACK_ID, null);
    if (!pack || !scopeMatches(pack, scope)) return false;
    const updates = new Map(draft.items.map(({ item, intent }) => [item.id, {
      status: intent === "checkout" ? "checked_out" : "available",
      checked_out_by: intent === "checkout" ? draft.borrower?.id ?? null : null,
    }]));
    const next: OfflineCheckoutPack = {
      ...pack,
      items: pack.items.map((item) => {
        const update = updates.get(item.id);
        return update ? { ...item, ...update } : item;
      }),
    };
    await writeRecord(PACK_ID, next);
    window.dispatchEvent(new CustomEvent("itemtraxx:offline-workflow-changed"));
    return true;
  });
};

export const queueOfflineOperation = async (draft: {
  operationId: string;
  borrower: OfflinePackBorrower | null;
  items: Array<{ item: OfflinePackItem; intent: "checkout" | "return" | "quick_return" }>;
}) => {
  const scope = currentScope();
  const pack = await readOfflinePack(scope);
  if (!pack) throw new Error("Offline checkout is unavailable. Reconnect and prepare this device for offline use.");
  const entry: OfflineLedgerEntry = {
    schema_version: 1,
    id: createId(),
    operation_id: draft.operationId,
    workspace_id: pack.workspace_id,
    profile_id: pack.profile_id,
    device_id: pack.device_id,
    pack_version: pack.pack_version,
    created_at: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    last_error: null,
    items: draft.items.map(({ item, intent }) => ({
      item_id: item.id,
      barcode: item.barcode,
      name: item.name,
      intent,
      borrower_id: intent === "checkout" ? draft.borrower?.id ?? null : item.checked_out_by,
      borrower_display_id: draft.borrower?.borrower_id ?? null,
      borrower_username: draft.borrower?.username ?? null,
      expected_status: item.status,
      expected_checked_out_by: item.checked_out_by,
      status: "pending",
    })),
  };
  const next = await updateLedger((entries) => [...entries, entry]);
  return next.filter((item) => ACTIVE_LEDGER_STATES.has(item.status)).length;
};

export const getOfflineWorkflowSummary = async () => {
  const auth = getAuthState();
  const { deviceId } = getOrCreateDeviceSession();
  const scope = auth.workspaceContextId && auth.userId
    ? { workspaceId: auth.workspaceContextId, profileId: auth.userId, deviceId }
    : null;
  const pack = scope ? await readOfflinePack(scope, { allowExpired: true }) : null;
  const ledger = await readOfflineLedger();
  return {
    pack,
    packExpired: !!pack && Date.parse(pack.expires_at) <= Date.now(),
    pendingCount: ledger.filter((entry) => entry.status === "pending" || entry.status === "syncing").length,
    syncingCount: ledger.filter((entry) => entry.status === "syncing").length,
    reviewCount: ledger.filter((entry) => entry.status === "needs_review").length,
  };
};

export const listOfflineReviewEntries = async () => {
  const entries = await readOfflineLedger();
  const auth = getAuthState();
  if (!auth.isAuthenticated || !auth.workspaceContextId || !auth.userId) {
    return entries.filter((entry) => entry.status === "needs_review");
  }
  const { deviceId } = getOrCreateDeviceSession();
  const scoped = entries.filter((entry) =>
    entry.workspace_id === auth.workspaceContextId &&
    entry.profile_id === auth.userId &&
    entry.device_id === deviceId
  );
  if (scoped.length !== entries.length) {
    await clearOfflineCheckoutWorkflow();
    return [];
  }
  return scoped.filter((entry) => entry.status === "needs_review");
};

export const markOfflineEntryNeedsReview = (
  id: string,
  reason: string,
  serverState: unknown,
) => updateLedger((entries) => entries.map((entry) => entry.id === id ? {
  ...entry,
  status: "needs_review",
  review_origin: "server_conflict",
  last_error: reason,
  items: entry.items.length > 0
    ? entry.items.map((item) => ({ ...item, status: "needs_review", reason, server_state: serverState }))
    : [{
        item_id: "legacy",
        barcode: "Unknown item",
        name: "Legacy offline transaction",
        intent: "checkout",
        borrower_id: null,
        borrower_display_id: null,
        borrower_username: null,
        expected_status: "unknown",
        expected_checked_out_by: null,
        status: "needs_review",
        reason,
        server_state: serverState,
      }],
} : entry));

const applyOperationResult = (entry: OfflineLedgerEntry, result: SyncOperationResult): OfflineLedgerEntry => {
  const byItem = new Map(result.item_results.map((item) => [item.item_id, item]));
  const items = entry.items.map((item) => {
    const next = byItem.get(item.item_id);
    return next ? { ...item, ...next } : item;
  });
  const needsReview = result.status === "needs_review" || items.some((item) => item.status === "needs_review");
  return {
    ...entry,
    status: needsReview ? "needs_review" : result.resolution === "keep_server" ? "kept_server" : "synced",
    review_origin: needsReview ? "server_conflict" : entry.review_origin,
    resolution: result.resolution ?? entry.resolution,
    last_error: needsReview ? items.find((item) => item.status === "needs_review")?.reason ?? "Server state changed." : null,
    items,
  };
};

export const syncOfflineCheckoutLedger = async () => {
  const scope = currentScope();
  const pack = await readOfflinePack(scope, { allowExpired: true });
  if (!pack) return { processed: 0, failed: 0, remaining: 0, review: 0 };
  const pending = (await readOfflineLedger()).filter((entry) => entry.status === "pending");
  if (pending.length === 0) {
    const review = (await listOfflineReviewEntries()).length;
    return { processed: 0, failed: 0, remaining: 0, review };
  }
  await updateLedger((entries) => entries.map((entry) => pending.some((item) => item.id === entry.id) ? { ...entry, status: "syncing" } : entry));
  const response = await invokeEdgeFunction<{ data: { operations: SyncOperationResult[] } }>("offline-checkout", {
    method: "POST",
    body: {
      action: "sync",
      device_id: pack.device_id,
      pack_version: pack.pack_version,
      operations: pending.map((entry) => ({
        operation_id: entry.operation_id,
        created_at: entry.created_at,
        items: entry.items.map((item) => ({
          item_id: item.item_id,
          barcode: item.barcode,
          intent: item.intent,
          borrower_id: item.borrower_id,
          expected_status: item.expected_status,
          expected_checked_out_by: item.expected_checked_out_by,
        })),
      })),
    },
  });
  recordWorkflowResponse(response.ok, response.status);
  if (!response.ok || !response.data?.data) {
    const retryable = isRetryableWorkflowStatus(response.status);
    const reason = response.error || "Unable to sync offline transactions.";
    const updated = await updateLedger((entries) => entries.map((entry) => pending.some((item) => item.id === entry.id) ? {
      ...entry,
      status: retryable ? "pending" : "needs_review",
      review_origin: retryable ? entry.review_origin : "request_rejection",
      attempts: entry.attempts + 1,
      last_error: reason,
      items: retryable
        ? entry.items
        : entry.items.map((item) => ({ ...item, status: "needs_review" as const, reason })),
    } : entry));
    return {
      processed: 0,
      failed: pending.length,
      remaining: updated.filter((entry) => entry.status === "pending" || entry.status === "syncing").length,
      review: updated.filter((entry) => entry.status === "needs_review").length,
    };
  }
  const byOperation = new Map(response.data.data.operations.map((result) => [result.operation_id, result]));
  const updated = await updateLedger((entries) => entries.map((entry) => {
    const result = byOperation.get(entry.operation_id);
    if (result) return applyOperationResult(entry, result);
    if (entry.status !== "syncing") return entry;
    return { ...entry, status: "pending", attempts: entry.attempts + 1, last_error: "Server did not return a result for this transaction." };
  }));
  return {
    processed: updated.filter((entry) => pending.some((item) => item.id === entry.id) && entry.status === "synced").length,
    failed: updated.filter((entry) => pending.some((item) => item.id === entry.id) && entry.status !== "synced").length,
    remaining: updated.filter((entry) => entry.status === "pending" || entry.status === "syncing").length,
    review: updated.filter((entry) => entry.status === "needs_review").length,
  };
};

export const resolveOfflineCheckoutConflict = async (
  entryId: string,
  resolution: "keep_server" | "apply_offline",
) => {
  const entry = (await readOfflineLedger()).find((item) => item.id === entryId);
  if (!entry || entry.status !== "needs_review") throw new Error("This offline transaction no longer needs review.");
  const hasServerCreatedConflict = entry.review_origin === "server_conflict" ||
    entry.items.some((item) => Object.prototype.hasOwnProperty.call(item, "server_state"));
  if (resolution === "keep_server" && !hasServerCreatedConflict) {
    await keepOfflineServerStateLocally(entryId);
    return;
  }
  const response = await invokeEdgeFunction<{ data: SyncOperationResult }>("offline-checkout", {
    method: "POST",
    body: {
      action: "resolve",
      device_id: entry.device_id,
      operation_id: entry.operation_id,
      resolution,
    },
    preserveErrorData: true,
  });
  recordWorkflowResponse(response.ok, response.status);
  if (response.data?.data) {
    await updateLedger((entries) => entries.map((item) => item.id === entryId
      ? applyOperationResult({ ...item, resolution }, response.data!.data)
      : item));
  }
  if (!response.ok) throw new Error(response.error || "Unable to resolve this offline transaction.");
  if (!response.data?.data) throw new Error("Unable to resolve this offline transaction.");
};

export const keepOfflineServerStateLocally = (entryId: string) =>
  updateLedger((entries) => entries.map((entry) => entry.id === entryId
    ? {
        ...entry,
        status: "kept_server",
        resolution: "keep_server",
        last_error: null,
        items: entry.items.map((item) => ({ ...item, status: "kept_server" })),
      }
    : entry));
