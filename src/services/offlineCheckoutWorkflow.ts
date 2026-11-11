import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import { getAuthState } from "../store/authState";
import { ensureAccountSessionReady } from "./accountSessionService";
import { isOfflinePackAutomaticDownloadAllowed } from "./offlineCheckoutPreferences";
import { requestLargeOfflinePackConfirmation } from "./offlinePackConfirmation";
import {
  markItemTraxxServerConfirmed,
  markItemTraxxServerUnreachable,
} from "./offlineConnectionState";
import {
  clearCheckoutRetryStatus,
  createCheckoutRetryStatusId,
  getCheckoutRetryDelayMs,
  MAX_CHECKOUT_ATTEMPTS,
  MAX_RATE_LIMIT_RETRIES,
  setCheckoutRetryStatus,
  waitForCheckoutRetry,
  type CheckoutRetryReason,
} from "./checkoutRetryStatus";
import {
  MAX_OFFLINE_SYNC_ITEMS,
  MAX_OFFLINE_SYNC_OPERATIONS,
} from "../types/offlineCheckoutLimits";

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
  next_retry_at?: string | null;
  items: OfflineItemIntent[];
  resolution?: "keep_server" | "apply_offline";
  review_origin?: "server_conflict" | "request_rejection";
};

type EncryptedRecord = { version: 1; iv: string; cipher: string };
type PreparedPackManifest = {
  pack_version: string;
  workspace_id: string;
  prepared_at: string;
  expires_at: string;
  item_count: number;
  borrower_count: number;
  chunk_size: number;
  max_records: number;
  max_bytes: number;
};
type OfflinePackChunkResponse = {
  items: OfflinePackItem[];
  borrowers: OfflinePackBorrower[];
  next_item_id: string | null;
  next_borrower_id: string | null;
  item_count: number;
  borrower_count: number;
};
export type OfflinePackPreparationProgress = {
  stage: "starting" | "downloading" | "complete";
  downloadedRecords: number;
  totalRecords: number;
  itemCount: number;
  borrowerCount: number;
  chunkNumber: number;
};
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
type OfflineSyncResponse = {
  ok: boolean;
  status: number;
  data: {
    data?: { operations: SyncOperationResult[] };
    retry_after_seconds?: number | null;
  } | null;
  error: string;
};
type OfflineLedgerSyncResult = {
  processed: number;
  failed: number;
  remaining: number;
  review: number;
};
type OfflinePackRefreshResult = {
  refreshed: boolean;
  firstPreparation: boolean;
  skippedReason?: "offline" | "unauthenticated" | "download_preference" | "pending_transactions" | "up_to_date";
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
export const OFFLINE_PACK_LARGE_WARNING_RECORDS = 2_000;
export const OFFLINE_PACK_MAX_RECORDS = 10_000;
export const OFFLINE_PACK_MAX_BYTES = 25 * 1024 * 1024;
export const OFFLINE_SESSION_INITIALIZING_ERROR = "Offline session is still initializing. Please retry.";

export const isOfflineSessionInitializingError = (error: unknown) =>
  error instanceof Error && error.message.trim() === OFFLINE_SESSION_INITIALIZING_ERROR;

const ACTIVE_LEDGER_STATES = new Set<OfflineLedgerEntry["status"]>([
  "pending",
  "syncing",
  "needs_review",
]);
let automaticPackRefresh: Promise<OfflinePackRefreshResult> | null = null;
let automaticPackRefreshWasForced = false;
let automaticPackRefreshReportsProgress = true;
let packPreparation: Promise<OfflineCheckoutPack> | null = null;
let packPreparationReportsProgress = true;

const isRetryableWorkflowStatus = (status: number) => status === 0 || status === 429 || status >= 500;

const recordWorkflowResponse = (status: number) => {
  if (status > 0) markItemTraxxServerConfirmed();
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

class OfflineWorkflowStorageError extends Error {
  constructor(operation: string, storeName: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? "unknown IndexedDB error");
    super(`Offline workflow IndexedDB ${operation} failed for store "${storeName}": ${detail}`, { cause });
    this.name = "OfflineWorkflowStorageError";
  }
}

const accessStore = async <T>(
  storeName: string,
  operation: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      let result: T | undefined;
      let hasResult = false;
      const fail = (cause: unknown) => {
        if (settled) return;
        settled = true;
        reject(new OfflineWorkflowStorageError(operation, storeName, cause));
      };

      try {
        const transaction = database.transaction(storeName, mode);
        const request = callback(transaction.objectStore(storeName));
        request.onsuccess = () => {
          result = request.result;
          hasResult = true;
        };
        request.onerror = () => fail(request.error ?? new Error("IndexedDB request failed."));
        transaction.onerror = () => fail(transaction.error ?? request.error ?? new Error("IndexedDB transaction failed."));
        transaction.onabort = () => fail(transaction.error ?? request.error ?? new Error("IndexedDB transaction aborted."));
        transaction.oncomplete = () => {
          if (!hasResult) {
            fail(new Error("IndexedDB transaction completed without a request result."));
            return;
          }
          if (settled) return;
          settled = true;
          resolve(result as T);
        };
      } catch (cause) {
        fail(cause);
      }
    });
  } finally {
    database.close();
  }
};

const getOrCreateKey = async () => {
  const existing = await accessStore<CryptoKey | undefined>(
    KEY_STORE,
    "read encryption key",
    "readonly",
    (store) => store.get(KEY_ID),
  );
  if (existing instanceof CryptoKey) return existing;
  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  await accessStore<IDBValidKey>(
    KEY_STORE,
    "store encryption key",
    "readwrite",
    (store) => store.put(key, KEY_ID),
  );
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
  const encrypted = await accessStore<EncryptedRecord | undefined>(
    RECORD_STORE,
    "read encrypted record",
    "readonly",
    (store) => store.get(recordId),
  );
  if (!encrypted) return fallback;
  try {
    return await decryptRecord<T>(recordId, encrypted);
  } catch (cause) {
    if (cause instanceof OfflineWorkflowStorageError) throw cause;
    await accessStore<undefined>(
      RECORD_STORE,
      "delete invalid encrypted record",
      "readwrite",
      (store) => store.delete(recordId),
    );
    return fallback;
  }
};

const writeRecord = async (recordId: string, value: unknown) => {
  const encrypted = await encryptRecord(recordId, value);
  await accessStore<IDBValidKey>(
    RECORD_STORE,
    "write encrypted record",
    "readwrite",
    (store) => store.put(encrypted, recordId),
  );
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

const preparePendingLedgerForSync = (
  scope: OfflineWorkflowScope,
  pack: OfflineCheckoutPack,
) => updateLedger((entries) => {
  const normalized: OfflineLedgerEntry[] = [];
  for (const entry of entries) {
    const belongsToPack = entry.workspace_id === scope.workspaceId &&
      entry.profile_id === scope.profileId &&
      entry.device_id === pack.device_id &&
      entry.pack_version === pack.pack_version;
    if (!belongsToPack) {
      normalized.push(entry);
      continue;
    }

    // A page can close after persisting "syncing" but before it saves the
    // response. The server uses operation IDs idempotently, so retry that work
    // on the next sync attempt.
    const retryable = entry.status === "syncing"
      ? {
        ...entry,
        status: "pending" as const,
        last_error: entry.last_error ?? "Previous offline sync was interrupted; retrying.",
      }
      : entry;

    // Older clients could queue one transaction larger than the endpoint's
    // per-request item cap. Persist separate operation IDs before sending any
    // part so each piece can be replayed and reviewed independently.
    if (
      retryable.status === "pending" &&
      retryable.items.length > MAX_OFFLINE_SYNC_ITEMS
    ) {
      for (
        let offset = 0, part = 0;
        offset < retryable.items.length;
        offset += MAX_OFFLINE_SYNC_ITEMS, part += 1
      ) {
        normalized.push({
          ...retryable,
          id: part === 0 ? retryable.id : createId(),
          operation_id: part === 0 ? retryable.operation_id : createId(),
          items: retryable.items.slice(offset, offset + MAX_OFFLINE_SYNC_ITEMS),
        });
      }
      continue;
    }

    normalized.push(retryable);
  }
  return normalized;
});

const createOfflineSyncBatches = (entries: OfflineLedgerEntry[]) => {
  const batches: OfflineLedgerEntry[][] = [];
  let batch: OfflineLedgerEntry[] = [];
  let batchItemCount = 0;

  for (const entry of entries) {
    if (entry.items.length > MAX_OFFLINE_SYNC_ITEMS) {
      throw new Error("Offline transaction exceeds the server sync limit.");
    }
    if (
      batch.length > 0 &&
      (batch.length >= MAX_OFFLINE_SYNC_OPERATIONS ||
        batchItemCount + entry.items.length > MAX_OFFLINE_SYNC_ITEMS)
    ) {
      batches.push(batch);
      batch = [];
      batchItemCount = 0;
    }
    batch.push(entry);
    batchItemCount += entry.items.length;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
};

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

const reportOfflinePackPreparationProgress = (progress: OfflinePackPreparationProgress) => {
  if (typeof window === "undefined" || !packPreparationReportsProgress) return;
  window.dispatchEvent(new CustomEvent<OfflinePackPreparationProgress>(
    "itemtraxx:offline-pack-progress",
    { detail: progress },
  ));
};

const invokePackControl = async <T>(
  body: Record<string, unknown> & { action: string; device_id: string },
) => {
  const response = await invokeEdgeFunction<{ data: T }, Record<string, unknown>>(
    "offline-checkout",
    { method: "POST", body },
  );
  recordWorkflowResponse(response.status);
  if (!response.ok || !response.data?.data) {
    throw new Error(response.error || "Unable to prepare offline checkout.");
  }
  return response.data.data;
};

const assertOfflinePackOwnerIsCurrent = (owner: OfflineWorkflowScope) => {
  const auth = getAuthState();
  if (
    !auth.isAuthenticated || auth.userId !== owner.profileId ||
    auth.workspaceContextId !== owner.workspaceId
  ) {
    throw new Error("The account changed while preparing offline checkout. Please try again.");
  }
};

const prepareOfflineCheckoutPackOnce = async () => {
  const auth = getAuthState();
  if (!auth.workspaceContextId || !auth.userId || !auth.isAuthenticated) {
    throw new Error("A workspace session is required to prepare offline checkout.");
  }
  const owner = { workspaceId: auth.workspaceContextId, profileId: auth.userId };
  const existingPack = await readOfflinePack(owner, { allowExpired: true });
  if (!existingPack && (await readOfflineLedger()).length > 0) await clearOfflineCheckoutWorkflow();
  const activeEntries = (await readOfflineLedger()).filter((entry) => ACTIVE_LEDGER_STATES.has(entry.status));
  if (activeEntries.length > 0) {
    throw new Error("Sync or resolve pending offline transactions before refreshing this device's offline pack.");
  }
  await ensureAccountSessionReady();
  const { deviceId } = getOrCreateDeviceSession();
  let packVersion: string | null = null;
  let downloadComplete = false;
  try {
    reportOfflinePackPreparationProgress({
      stage: "starting",
      downloadedRecords: 0,
      totalRecords: 0,
      itemCount: 0,
      borrowerCount: 0,
      chunkNumber: 0,
    });
    const manifest = await invokePackControl<PreparedPackManifest>({
      action: "prepare_pack",
      device_id: deviceId,
    });
    packVersion = manifest.pack_version;
    assertOfflinePackOwnerIsCurrent(owner);
    if (manifest.workspace_id !== owner.workspaceId) {
      throw new Error("Offline pack workspace does not match this session.");
    }
    if (
      !Number.isInteger(manifest.item_count) || manifest.item_count < 0 ||
      !Number.isInteger(manifest.borrower_count) || manifest.borrower_count < 0 ||
      !Number.isInteger(manifest.max_records) || manifest.max_records < 1 ||
      !Number.isInteger(manifest.max_bytes) || manifest.max_bytes < 1 ||
      !Number.isInteger(manifest.chunk_size) || manifest.chunk_size !== 100 ||
      manifest.item_count + manifest.borrower_count > Math.min(manifest.max_records, OFFLINE_PACK_MAX_RECORDS) ||
      manifest.max_bytes > OFFLINE_PACK_MAX_BYTES
    ) {
      throw new Error("The server returned an invalid offline pack size.");
    }
    const totalRecords = manifest.item_count + manifest.borrower_count;
    reportOfflinePackPreparationProgress({
      stage: "starting",
      downloadedRecords: 0,
      totalRecords,
      itemCount: manifest.item_count,
      borrowerCount: manifest.borrower_count,
      chunkNumber: 0,
    });

    if (totalRecords > OFFLINE_PACK_LARGE_WARNING_RECORDS) {
      const confirmed = await requestLargeOfflinePackConfirmation({
        itemCount: manifest.item_count,
        borrowerCount: manifest.borrower_count,
        totalRecords,
        maxRecords: Math.min(manifest.max_records, OFFLINE_PACK_MAX_RECORDS),
        maxBytes: Math.min(manifest.max_bytes, OFFLINE_PACK_MAX_BYTES),
      });
      if (!confirmed) throw new OfflinePackDownloadCancelledError();
      assertOfflinePackOwnerIsCurrent(owner);
    }

    const items: OfflinePackItem[] = [];
    const borrowers: OfflinePackBorrower[] = [];
    let afterItemId: string | null = null;
    let afterBorrowerId: string | null = null;
    let chunkNumber = 0;
    while (true) {
      assertOfflinePackOwnerIsCurrent(owner);
      const chunk: OfflinePackChunkResponse = await invokePackControl<OfflinePackChunkResponse>({
        action: "prepare_pack_chunk",
        device_id: deviceId,
        pack_version: manifest.pack_version,
        after_item_id: afterItemId,
        after_borrower_id: afterBorrowerId,
      });
      if (
        chunk.item_count !== manifest.item_count ||
        chunk.borrower_count !== manifest.borrower_count ||
        chunk.items.length > 100 || chunk.borrowers.length > 100
      ) {
        throw new Error("Offline pack chunk did not match its size manifest.");
      }
      if (
        (chunk.items.length && (!chunk.next_item_id || chunk.next_item_id === afterItemId)) ||
        (chunk.borrowers.length && (!chunk.next_borrower_id || chunk.next_borrower_id === afterBorrowerId))
      ) {
        throw new Error("Offline pack chunk cursor did not advance.");
      }
      if (!chunk.items.length && !chunk.borrowers.length) break;

      items.push(...chunk.items);
      borrowers.push(...chunk.borrowers);
      if (items.length > manifest.item_count || borrowers.length > manifest.borrower_count) {
        throw new Error("Offline pack changed size during download. Please try again.");
      }
      afterItemId = chunk.next_item_id ?? afterItemId;
      afterBorrowerId = chunk.next_borrower_id ?? afterBorrowerId;
      chunkNumber += 1;
      reportOfflinePackPreparationProgress({
        stage: "downloading",
        downloadedRecords: items.length + borrowers.length,
        totalRecords,
        itemCount: manifest.item_count,
        borrowerCount: manifest.borrower_count,
        chunkNumber,
      });
    }

    if (items.length !== manifest.item_count || borrowers.length !== manifest.borrower_count) {
      throw new Error("Offline pack changed size during download. Please try again.");
    }
    assertOfflinePackOwnerIsCurrent(owner);
    await invokePackControl<{ pack_version: string; download_complete: boolean }>({
      action: "complete_pack",
      device_id: deviceId,
      pack_version: manifest.pack_version,
    });
    downloadComplete = true;

    const pack: OfflineCheckoutPack = {
      schema_version: 1,
      pack_version: manifest.pack_version,
      workspace_id: manifest.workspace_id,
      profile_id: owner.profileId,
      device_id: deviceId,
      prepared_at: manifest.prepared_at,
      expires_at: manifest.expires_at,
      borrowers,
      items,
    };
    assertOfflinePackOwnerIsCurrent(owner);
    await withOfflineWorkflowLock(async () => {
      const latestLedger = await readOfflineLedger();
      if (latestLedger.some((entry) => ACTIVE_LEDGER_STATES.has(entry.status))) {
        throw new Error("Sync or resolve pending offline transactions before refreshing this device's offline pack.");
      }
      await writeRecord(PACK_ID, pack);
      await writeRecord(LEDGER_ID, latestLedger.filter((entry) => ACTIVE_LEDGER_STATES.has(entry.status)));
      window.dispatchEvent(new CustomEvent("itemtraxx:offline-workflow-changed"));
    });
    try {
      await invokePackControl<{ pack_version: string; activated: boolean }>({
        action: "activate_pack",
        device_id: deviceId,
        pack_version: manifest.pack_version,
      });
    } catch {
      // The completed pack and its predecessor remain valid if activation cannot
      // retire the previous server snapshot. The local pack is already usable.
    }
    reportOfflinePackPreparationProgress({
      stage: "complete",
      downloadedRecords: totalRecords,
      totalRecords,
      itemCount: manifest.item_count,
      borrowerCount: manifest.borrower_count,
      chunkNumber,
    });
    return pack;
  } catch (error) {
    if (packVersion && !downloadComplete) {
      void invokePackControl<{ cancelled: boolean }>({
        action: "cancel_pack",
        device_id: deviceId,
        pack_version: packVersion,
      }).catch(() => undefined);
    }
    throw error;
  }
};

export const prepareOfflineCheckoutPack = (
  options: { reportProgress?: boolean } = {},
) => {
  if (options.reportProgress !== false) {
    // If an explicit download joins a quiet background refresh, make the
    // in-flight preparation visible to the user who requested it.
    automaticPackRefreshReportsProgress = true;
    packPreparationReportsProgress = true;
  }
  if (packPreparation) return packPreparation;
  packPreparationReportsProgress = automaticPackRefresh
    ? automaticPackRefreshReportsProgress
    : options.reportProgress !== false;
  packPreparation = prepareOfflineCheckoutPackOnce().finally(() => {
    packPreparation = null;
    packPreparationReportsProgress = true;
  });
  return packPreparation;
};

export class OfflinePackDownloadCancelledError extends Error {
  constructor() {
    super("Offline pack download was cancelled.");
    this.name = "OfflinePackDownloadCancelledError";
  }
}

/**
 * Keeps the encrypted local snapshot recent without replacing a working offline ledger.
 * Callers may fire-and-forget this after a confirmed server mutation.
 */
export const refreshOfflineCheckoutPackIfNeeded = (
  options: { force?: boolean; reportProgress?: boolean } = {},
): Promise<OfflinePackRefreshResult> => {
  if (automaticPackRefresh) {
    if (!options.force || automaticPackRefreshWasForced) return automaticPackRefresh;
    // A forced refresh requested while a non-forced timer refresh is in
    // flight must run again after that stale check completes. Returning the
    // in-flight promise would otherwise turn the forced refresh into a no-op.
    return automaticPackRefresh.catch(() => undefined).then(() => refreshOfflineCheckoutPackIfNeeded(options));
  }

  automaticPackRefreshWasForced = !!options.force;
  automaticPackRefreshReportsProgress = options.reportProgress !== false;

  automaticPackRefresh = (async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { refreshed: false, firstPreparation: false, skippedReason: "offline" as const };
    }
    const auth = getAuthState();
    if (!auth.isAuthenticated || !auth.workspaceContextId || !auth.userId) {
      return { refreshed: false, firstPreparation: false, skippedReason: "unauthenticated" as const };
    }
    if (!isOfflinePackAutomaticDownloadAllowed(auth)) {
      return { refreshed: false, firstPreparation: false, skippedReason: "download_preference" as const };
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

    await prepareOfflineCheckoutPack({ reportProgress: automaticPackRefreshReportsProgress });
    return { refreshed: true, firstPreparation: !existingPack };
  })().finally(() => {
    automaticPackRefresh = null;
    automaticPackRefreshWasForced = false;
    automaticPackRefreshReportsProgress = true;
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

/**
 * Materializes the current ledger overlay and the action's borrower into the
 * encrypted pack immediately after an offline action. The ledger remains the
 * source of truth for replay, while the pack itself stays useful to any code
 * that reads the snapshot without applying the overlay first.
 */
export const refreshOfflineCheckoutCacheFromLedger = async (borrower: OfflinePackBorrower | null = null) => {
  const auth = getAuthState();
  if (!auth.workspaceContextId || !auth.userId) return false;
  const { deviceId } = getOrCreateDeviceSession();
  const scope = { workspaceId: auth.workspaceContextId, profileId: auth.userId, deviceId };

  return withOfflineWorkflowLock(async () => {
    const pack = await readRecord<OfflineCheckoutPack | null>(PACK_ID, null);
    if (!pack || !scopeMatches(pack, scope) || Date.parse(pack.expires_at) <= Date.now()) return false;
    const nextItems = applyLedgerOverlay(pack, await readOfflineLedger());
    const nextBorrowers = borrower
      ? [
          ...pack.borrowers.filter((item) => item.id !== borrower.id && item.borrower_id !== borrower.borrower_id),
          borrower,
        ]
      : pack.borrowers;
    await writeRecord(PACK_ID, { ...pack, borrowers: nextBorrowers, items: nextItems });
    window.dispatchEvent(new CustomEvent("itemtraxx:offline-workflow-changed"));
    return true;
  });
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
  const { next } = await withOfflineWorkflowLock(async () => {
    const pack = await readRecord<OfflineCheckoutPack | null>(PACK_ID, null);
    if (!pack || !scopeMatches(pack, scope) || Date.parse(pack.expires_at) <= Date.now()) {
      throw new Error("Offline checkout is unavailable. Reconnect and prepare this device for offline use.");
    }
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
    const entries = await readOfflineLedger();
    const next = [...entries, entry];
    await writeRecord(LEDGER_ID, next);
    window.dispatchEvent(new CustomEvent("itemtraxx:offline-workflow-changed"));
    return { entry, next };
  });
  try {
    await refreshOfflineCheckoutCacheFromLedger(draft.borrower);
  } catch {
    // The encrypted ledger is already durable; a snapshot write failure must
    // not turn a successfully queued offline action into a failed transaction.
  }
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
    next_retry_at: null,
    items,
  };
};

const syncOfflineCheckoutLedgerOnce = async (): Promise<OfflineLedgerSyncResult> => {
  const scope = currentScope();
  const pack = await readOfflinePack(scope, { allowExpired: true });
  if (!pack) return { processed: 0, failed: 0, remaining: 0, review: 0 };
  const ledger = await preparePendingLedgerForSync(scope, pack);
  const belongsToPack = (entry: OfflineLedgerEntry) =>
    entry.workspace_id === scope.workspaceId &&
    entry.profile_id === scope.profileId &&
    entry.device_id === pack.device_id &&
    entry.pack_version === pack.pack_version;
  const now = Date.now();
  const pending = ledger.filter((entry) =>
    belongsToPack(entry) && entry.status === "pending" &&
    (!entry.next_retry_at || !Number.isFinite(Date.parse(entry.next_retry_at)) || Date.parse(entry.next_retry_at) <= now)
  );
  const pendingIds = new Set(pending.map((entry) => entry.id));
  if (pending.length === 0) {
    return {
      processed: 0,
      failed: 0,
      remaining: ledger.filter((entry) => belongsToPack(entry) && (entry.status === "pending" || entry.status === "syncing")).length,
      review: ledger.filter((entry) => belongsToPack(entry) && entry.status === "needs_review").length,
    };
  }
  // The offline endpoint validates the Better Auth session against this
  // device-bound application session. Bootstrap it before marking entries as
  // syncing so a failed bootstrap leaves durable work retryable as pending.
  await ensureAccountSessionReady();
  for (const batch of createOfflineSyncBatches(pending)) {
    const batchIds = new Set(batch.map((entry) => entry.id));
    const marked = await updateLedger((entries) => entries.map((entry) =>
      batchIds.has(entry.id) && entry.status === "pending"
        ? { ...entry, status: "syncing", next_retry_at: null }
        : entry
    ));
    const sending = marked.filter((entry) => batchIds.has(entry.id) && entry.status === "syncing");
    if (sending.length === 0) continue;

    const retryStatusId = createCheckoutRetryStatusId();
    let response: OfflineSyncResponse;
    let attempt = 1;
    let rateLimitRetries = 0;
    let previousReason: CheckoutRetryReason = "network";
    let stoppedBecauseOffline = false;
    try {
      while (true) {
        if (attempt > 1) {
          setCheckoutRetryStatus({
            id: retryStatusId,
            phase: "retrying",
            action: "offline_sync",
            reason: previousReason,
            attempt,
            maxAttempts: previousReason === "rate_limit" ? attempt : MAX_CHECKOUT_ATTEMPTS,
            secondsRemaining: 0,
          });
        }
        response = await invokeEdgeFunction<OfflineSyncResponse["data"]>("offline-checkout", {
          method: "POST",
          preserveErrorData: true,
          body: {
            action: "sync",
            device_id: pack.device_id,
            pack_version: pack.pack_version,
            operations: sending.map((entry) => ({
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
        recordWorkflowResponse(response.status);
        if (response.ok && response.data?.data) break;

        const retryable = isRetryableWorkflowStatus(response.status);
        const reason: CheckoutRetryReason = response.status === 429
          ? "rate_limit"
          : response.status >= 500
          ? "server"
          : "network";
        if (!retryable) break;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          markItemTraxxServerUnreachable();
          stoppedBecauseOffline = true;
          break;
        }
        if (
          attempt >= MAX_CHECKOUT_ATTEMPTS ||
          (reason === "rate_limit" && rateLimitRetries >= MAX_RATE_LIMIT_RETRIES)
        ) break;

        if (reason === "rate_limit") rateLimitRetries += 1;
        previousReason = reason;
        const nextAttempt = attempt + 1;
        const delayMs = getCheckoutRetryDelayMs(
          nextAttempt,
          reason,
          response.data?.retry_after_seconds,
        );
        setCheckoutRetryStatus({
          id: retryStatusId,
          phase: "waiting",
          action: "offline_sync",
          reason,
          attempt: nextAttempt,
          maxAttempts: reason === "rate_limit" ? nextAttempt : MAX_CHECKOUT_ATTEMPTS,
          secondsRemaining: Math.ceil(delayMs / 1_000),
        });
        const stayedOnline = await waitForCheckoutRetry(delayMs, (secondsRemaining) => {
          setCheckoutRetryStatus({
            id: retryStatusId,
            phase: "waiting",
            action: "offline_sync",
            reason,
            attempt: nextAttempt,
            maxAttempts: reason === "rate_limit" ? nextAttempt : MAX_CHECKOUT_ATTEMPTS,
            secondsRemaining,
          });
        });
        if (!stayedOnline) {
          markItemTraxxServerUnreachable();
          stoppedBecauseOffline = true;
          break;
        }
        attempt = nextAttempt;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unable to sync offline transactions.";
      const browserOffline = typeof navigator !== "undefined" && !navigator.onLine;
      if (browserOffline) markItemTraxxServerUnreachable();
      await updateLedger((entries) => entries.map((entry) =>
        batchIds.has(entry.id) && entry.status === "syncing"
          ? {
            ...entry,
            status: "pending",
            attempts: entry.attempts + 1,
            last_error: reason,
            next_retry_at: browserOffline
              ? null
              : new Date(Date.now() + getCheckoutRetryDelayMs(MAX_CHECKOUT_ATTEMPTS + 1, "network")).toISOString(),
          }
          : entry
      )).catch(() => undefined);
      throw error;
    } finally {
      clearCheckoutRetryStatus(retryStatusId);
    }

    if (!response.ok || !response.data?.data) {
      const retryable = isRetryableWorkflowStatus(response.status);
      const reason = response.error || "Unable to sync offline transactions.";
      await updateLedger((entries) => entries.map((entry) => {
        if (!batchIds.has(entry.id) || entry.status !== "syncing") return entry;
        return {
          ...entry,
          status: retryable ? "pending" : "needs_review",
          review_origin: retryable ? entry.review_origin : "request_rejection",
          attempts: entry.attempts + 1,
          last_error: reason,
          next_retry_at: retryable && !stoppedBecauseOffline
            ? new Date(Date.now() + getCheckoutRetryDelayMs(
              MAX_CHECKOUT_ATTEMPTS + 1,
              response.status === 429 ? "rate_limit" : response.status >= 500 ? "server" : "network",
              response.data?.retry_after_seconds,
            )).toISOString()
            : null,
          items: retryable
            ? entry.items
            : entry.items.map((item) => ({ ...item, status: "needs_review" as const, reason })),
        };
      }));
      if (!retryable) {
        for (const entry of sending) clearCheckoutRetryStatus(entry.operation_id, "saved");
      }
      // A network or server failure makes later batches unlikely to succeed.
      // Leave them pending for the next retry instead of sending them blindly.
      if (retryable) break;
      continue;
    }

    const byOperation = new Map(response.data.data.operations.map((result) => [result.operation_id, result]));
    await updateLedger((entries) => entries.map((entry) => {
      if (!batchIds.has(entry.id) || entry.status !== "syncing") return entry;
      const result = byOperation.get(entry.operation_id);
      if (result) return applyOperationResult(entry, result);
      return {
        ...entry,
        status: "pending",
        attempts: entry.attempts + 1,
        last_error: "Server did not return a result for this transaction.",
        next_retry_at: new Date(Date.now() + getCheckoutRetryDelayMs(MAX_CHECKOUT_ATTEMPTS + 1, "server")).toISOString(),
      };
    }));
    for (const entry of sending) {
      if (byOperation.has(entry.operation_id)) {
        clearCheckoutRetryStatus(entry.operation_id, "saved");
      }
    }
  }

  const updated = await readOfflineLedger();
  const scoped = updated.filter(belongsToPack);
  return {
    processed: scoped.filter((entry) => pendingIds.has(entry.id) && entry.status === "synced").length,
    failed: scoped.filter((entry) => pendingIds.has(entry.id) && entry.status !== "synced").length,
    remaining: scoped.filter((entry) => entry.status === "pending" || entry.status === "syncing").length,
    review: scoped.filter((entry) => entry.status === "needs_review").length,
  };
};

let offlineLedgerSyncInFlight: Promise<OfflineLedgerSyncResult> | null = null;

export const syncOfflineCheckoutLedger = (): Promise<OfflineLedgerSyncResult> => {
  if (!offlineLedgerSyncInFlight) {
    offlineLedgerSyncInFlight = syncOfflineCheckoutLedgerOnce().finally(() => {
      offlineLedgerSyncInFlight = null;
    });
  }
  return offlineLedgerSyncInFlight;
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
  await ensureAccountSessionReady();
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
  recordWorkflowResponse(response.status);
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
