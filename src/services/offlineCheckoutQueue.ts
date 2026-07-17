export type CheckoutReturnPayload = {
  student_id: string;
  gear_barcodes: string[];
  action_type: "checkout" | "return" | "auto" | "admin_return";
  device_id?: string;
  device_label?: string;
  operation_id?: string;
};

export type BufferedCheckoutItem = {
  id: string;
  payload: CheckoutReturnPayload;
  created_at: string;
  attempts: number;
  last_error: string | null;
};

const OFFLINE_QUEUE_KEY = "itemtraxx:checkout-offline-buffer:v1";
const OFFLINE_QUEUE_KEY_VERSION = "itemtraxx:checkout-offline-buffer:key:v1";
const OFFLINE_QUEUE_LOCK_KEY = "itemtraxx:checkout-offline-buffer:lock:v1";
const OFFLINE_QUEUE_ALGO = "AES-GCM";
const OFFLINE_QUEUE_ENVELOPE_VERSION = 2;
const OFFLINE_QUEUE_KEY_DATABASE = "itemtraxx-offline-queue";
const OFFLINE_QUEUE_KEY_STORE = "keys";
const OFFLINE_QUEUE_KEY_ID = "checkout-buffer";
const OFFLINE_QUEUE_LOCK_TTL_MS = 30_000;
const OFFLINE_QUEUE_LOCK_REFRESH_MS = 1_000;
let offlineQueueWarning: string | null = null;

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return window.btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const createOperationId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const ensureCheckoutOperationId = (
  payload: CheckoutReturnPayload
): CheckoutReturnPayload => ({
  ...payload,
  operation_id: payload.operation_id ?? createOperationId(),
});

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const runWithStorageLease = async <T>(callback: () => Promise<T>) => {
  const owner = createOperationId();
  const acquireStartedAt = Date.now();
  let heartbeatId: number | null = null;

  const renewLease = () => {
    window.localStorage.setItem(
      OFFLINE_QUEUE_LOCK_KEY,
      JSON.stringify({
        owner,
        expires_at: Date.now() + OFFLINE_QUEUE_LOCK_TTL_MS,
      })
    );
  };

  while (true) {
    const now = Date.now();
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_LOCK_KEY);
    let currentOwner = "";
    let expiresAt = 0;

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { owner?: string; expires_at?: number };
        currentOwner = typeof parsed.owner === "string" ? parsed.owner : "";
        expiresAt = typeof parsed.expires_at === "number" ? parsed.expires_at : 0;
      } catch {
        window.localStorage.removeItem(OFFLINE_QUEUE_LOCK_KEY);
      }
    }

    if (!currentOwner || expiresAt <= now || currentOwner === owner) {
      renewLease();
      try {
        const confirmed = JSON.parse(
          window.localStorage.getItem(OFFLINE_QUEUE_LOCK_KEY) ?? "{}"
        ) as { owner?: string };
        if (confirmed.owner === owner) {
          heartbeatId = window.setInterval(renewLease, OFFLINE_QUEUE_LOCK_REFRESH_MS);
          break;
        }
      } catch {
        window.localStorage.removeItem(OFFLINE_QUEUE_LOCK_KEY);
      }
    }

    if (Date.now() - acquireStartedAt > OFFLINE_QUEUE_LOCK_TTL_MS * 2) {
      throw new Error("Offline queue is busy. Please try again in a bit.");
    }

    await sleep(50);
  }

  try {
    return await callback();
  } finally {
    if (heartbeatId !== null) {
      window.clearInterval(heartbeatId);
    }
    try {
      const current = JSON.parse(
        window.localStorage.getItem(OFFLINE_QUEUE_LOCK_KEY) ?? "{}"
      ) as { owner?: string };
      if (current.owner === owner) {
        window.localStorage.removeItem(OFFLINE_QUEUE_LOCK_KEY);
      }
    } catch {
      window.localStorage.removeItem(OFFLINE_QUEUE_LOCK_KEY);
    }
  }
};

export const withOfflineQueueLock = async <T>(callback: () => Promise<T>) => {
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    return navigator.locks.request(
      "itemtraxx-checkout-offline-buffer",
      { mode: "exclusive" },
      callback
    );
  }
  // Fallback only for browsers without Web Locks support. This localStorage lease is
  // best-effort and may still allow rare split-brain acquisition under tight interleaving.
  return runWithStorageLease(callback);
};

const openOfflineQueueKeyDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(OFFLINE_QUEUE_KEY_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OFFLINE_QUEUE_KEY_STORE)) {
        request.result.createObjectStore(OFFLINE_QUEUE_KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open secure offline storage."));
  });

const withOfflineQueueKeyStore = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const database = await openOfflineQueueKeyDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(OFFLINE_QUEUE_KEY_STORE, mode);
      const request = callback(transaction.objectStore(OFFLINE_QUEUE_KEY_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to access secure offline storage."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to access secure offline storage."));
    });
  } finally {
    database.close();
  }
};

const importLegacyOfflineQueueKey = async () => {
  const serialized = window.sessionStorage.getItem(OFFLINE_QUEUE_KEY_VERSION);
  if (!serialized) return null;
  return window.crypto.subtle.importKey(
    "raw",
    base64ToBytes(serialized),
    OFFLINE_QUEUE_ALGO,
    false,
    ["encrypt", "decrypt"]
  );
};

const getOrCreateOfflineQueueKey = async () => {
  const existing = await withOfflineQueueKeyStore<CryptoKey | undefined>("readonly", (store) =>
    store.get(OFFLINE_QUEUE_KEY_ID)
  );
  if (existing instanceof CryptoKey) return existing;

  const legacyKey = await importLegacyOfflineQueueKey();
  const key =
    legacyKey ??
    (await window.crypto.subtle.generateKey(
      { name: OFFLINE_QUEUE_ALGO, length: 256 },
      false,
      ["encrypt", "decrypt"]
    ));
  await withOfflineQueueKeyStore<IDBValidKey>("readwrite", (store) =>
    store.put(key, OFFLINE_QUEUE_KEY_ID)
  );
  window.sessionStorage.removeItem(OFFLINE_QUEUE_KEY_VERSION);
  return key;
};

const encryptOfflineQueue = async (items: BufferedCheckoutItem[]) => {
  const key = await getOrCreateOfflineQueueKey();
  const encoder = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const payload = encoder.encode(JSON.stringify(items));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: OFFLINE_QUEUE_ALGO, iv },
    key,
    payload
  );
  return JSON.stringify({
    version: OFFLINE_QUEUE_ENVELOPE_VERSION,
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(encrypted)),
  });
};

const decryptOfflineQueue = async (raw: string) => {
  const parsed = JSON.parse(raw) as { iv?: string; cipher?: string; version?: number };
  if (
    (parsed.version !== 1 && parsed.version !== OFFLINE_QUEUE_ENVELOPE_VERSION) ||
    !parsed.iv ||
    !parsed.cipher
  ) {
    throw new Error("invalid-offline-queue");
  }
  const key = await getOrCreateOfflineQueueKey();
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: OFFLINE_QUEUE_ALGO,
      iv: base64ToBytes(parsed.iv),
    },
    key,
    base64ToBytes(parsed.cipher)
  );
  const decoder = new TextDecoder();
  const payload = decoder.decode(decrypted);
  const queue = JSON.parse(payload) as unknown;
  if (!Array.isArray(queue)) {
    throw new Error("invalid-offline-queue");
  }
  return queue as BufferedCheckoutItem[];
};

const markOfflineQueueCorrupted = () => {
  window.localStorage.removeItem(OFFLINE_QUEUE_KEY);
  offlineQueueWarning =
    "Buffered transaction cache was reset because local data could not be verified. Please retry the failed requests.";
};

export const clearOfflineCheckoutQueue = async () => {
  window.localStorage.removeItem(OFFLINE_QUEUE_KEY);
  window.localStorage.removeItem(OFFLINE_QUEUE_LOCK_KEY);
  window.sessionStorage.removeItem(OFFLINE_QUEUE_KEY_VERSION);
  try {
    await withOfflineQueueKeyStore<undefined>("readwrite", (store) => store.delete(OFFLINE_QUEUE_KEY_ID));
  } catch {
    // Local queue data is already removed; never block logout on browser storage cleanup.
  }
};

export const consumeCheckoutOfflineWarning = () => {
  const warning = offlineQueueWarning;
  offlineQueueWarning = null;
  return warning;
};

const readLegacyOfflineQueue = (): BufferedCheckoutItem[] => {
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as BufferedCheckoutItem[];
    }
    if (parsed && typeof parsed === "object" && "cipher" in parsed) {
      return [];
    }
    return [];
  } catch {
    return [];
  }
};

export const readOfflineQueue = async () => {
  const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [] as BufferedCheckoutItem[];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const migrated = parsed as BufferedCheckoutItem[];
      await writeOfflineQueue(migrated);
      return migrated;
    }
    if (parsed && typeof parsed === "object" && "cipher" in parsed) {
      return await decryptOfflineQueue(raw);
    }
  } catch {
    markOfflineQueueCorrupted();
  }

  return readLegacyOfflineQueue();
};

export const writeOfflineQueue = async (items: BufferedCheckoutItem[]) => {
  try {
    const encrypted = await encryptOfflineQueue(items);
    window.localStorage.setItem(OFFLINE_QUEUE_KEY, encrypted);
  } catch {
    throw new Error("Unable to securely save this offline transaction. Please reconnect and try again.");
  }
};

export const queueCheckoutPayload = async (
  payload: CheckoutReturnPayload,
  error: string | null = null
) =>
  withOfflineQueueLock(async () => {
    const queue = await readOfflineQueue();
    const item: BufferedCheckoutItem = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `queued-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      payload: ensureCheckoutOperationId(payload),
      created_at: new Date().toISOString(),
      attempts: 0,
      last_error: error,
    };
    queue.push(item);
    await writeOfflineQueue(queue);
    return queue.length;
  });

export const getBufferedCheckoutCount = async () =>
  withOfflineQueueLock(async () => (await readOfflineQueue()).length);
