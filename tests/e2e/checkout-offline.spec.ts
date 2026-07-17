import { expect, test, type Page } from "@playwright/test";
import { mockUnauthenticatedSession } from "./helpers/testHarness";

const OFFLINE_QUEUE_KEY = "itemtraxx:checkout-offline-buffer:v1";
const OFFLINE_QUEUE_KEY_VERSION = "itemtraxx:checkout-offline-buffer:key:v1";
const OFFLINE_QUEUE_LOCK_KEY = "itemtraxx:checkout-offline-buffer:lock:v1";
const OFFLINE_QUEUE_KEY_DATABASE = "itemtraxx-offline-queue";

type CheckoutReturnPayload = {
  student_id: string;
  gear_barcodes: string[];
  action_type: "checkout" | "return" | "auto" | "admin_return";
  operation_id?: string;
};

type BufferedCheckoutItem = {
  id: string;
  payload: CheckoutReturnPayload;
  created_at: string;
  attempts: number;
  last_error: string | null;
};

type OfflineQueueControl = {
  clear: () => Promise<void>;
  consumeWarning: () => Promise<string | null>;
  ensureOperationId: (payload: CheckoutReturnPayload) => Promise<CheckoutReturnPayload>;
  getCount: () => Promise<number>;
  queue: (payload: CheckoutReturnPayload, error?: string | null) => Promise<number>;
  read: () => Promise<BufferedCheckoutItem[]>;
  withLock: <T>(callback: () => Promise<T>) => Promise<T>;
  write: (items: BufferedCheckoutItem[]) => Promise<void>;
};

const payload = (operationId?: string): CheckoutReturnPayload => ({
  student_id: "student-e2e",
  gear_barcodes: ["GEAR-E2E-001"],
  action_type: "checkout",
  ...(operationId ? { operation_id: operationId } : {}),
});

const bufferedItem = (operationId = "op-existing-e2e"): BufferedCheckoutItem => ({
  id: "queue-item-e2e",
  payload: payload(operationId),
  created_at: "2026-07-11T10:00:00.000Z",
  attempts: 2,
  last_error: "Network request failed",
});

const openFixture = async (page: Page) => {
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window.__itemtraxxTest as
              | (typeof window.__itemtraxxTest & { offlineCheckoutQueue?: unknown })
              | undefined
          )?.offlineCheckoutQueue === "object"
      )
    )
    .toBe(true);
};

const clearQueueStorage = async (page: Page) => {
  await page.evaluate(
    ([queueKey, keyVersion, lockKey]) => {
      window.localStorage.removeItem(queueKey);
      window.localStorage.removeItem(lockKey);
      window.sessionStorage.removeItem(keyVersion);
    },
    [OFFLINE_QUEUE_KEY, OFFLINE_QUEUE_KEY_VERSION, OFFLINE_QUEUE_LOCK_KEY]
  );
  await page.evaluate(async (databaseName) => {
    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Offline queue key database is blocked."));
    });
  }, OFFLINE_QUEUE_KEY_DATABASE);
};

test.describe("encrypted checkout offline queue contract", () => {
  test.beforeEach(async ({ page }) => {
    await mockUnauthenticatedSession(page);
    await openFixture(page);
    await clearQueueStorage(page);
  });

  test("reports an empty queue count", async ({ page }) => {
    const count = await page.evaluate(async () => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      return control.getCount();
    });

    expect(count).toBe(0);
  });

  test("writes an encrypted envelope and reads it back", async ({ page }) => {
    const result = await page.evaluate(
      async ({ queueKey, item }) => {
        const control = (
          window.__itemtraxxTest as typeof window.__itemtraxxTest & {
            offlineCheckoutQueue: OfflineQueueControl;
          }
        ).offlineCheckoutQueue;
        await control.write([item]);
        const raw = window.localStorage.getItem(queueKey);
        const envelope = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
        return {
          rawContainsStudentId: raw?.includes(item.payload.student_id) ?? false,
          envelopeKeys: envelope ? Object.keys(envelope).sort() : [],
          envelopeVersion: envelope?.version,
          hasIv: typeof envelope?.iv === "string" && envelope.iv.length > 0,
          hasCipher: typeof envelope?.cipher === "string" && envelope.cipher.length > 0,
          items: await control.read(),
        };
      },
      { queueKey: OFFLINE_QUEUE_KEY, item: bufferedItem() }
    );

    expect(result).toEqual({
      rawContainsStudentId: false,
      envelopeKeys: ["cipher", "iv", "version"],
      envelopeVersion: 2,
      hasIv: true,
      hasCipher: true,
      items: [bufferedItem()],
    });
  });

  test("keeps encrypted queue bytes readable and unchanged across a same-tab reload", async ({
    page,
  }) => {
    const rawBeforeReload = await page.evaluate(
      async ({ queueKey, item }) => {
        const control = (
          window.__itemtraxxTest as typeof window.__itemtraxxTest & {
            offlineCheckoutQueue: OfflineQueueControl;
          }
        ).offlineCheckoutQueue;
        await control.write([item]);
        return window.localStorage.getItem(queueKey);
      },
      { queueKey: OFFLINE_QUEUE_KEY, item: bufferedItem() }
    );

    await page.reload();
    await openFixture(page);

    const afterReload = await page.evaluate(async (queueKey) => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      return {
        raw: window.localStorage.getItem(queueKey),
        items: await control.read(),
      };
    }, OFFLINE_QUEUE_KEY);

    expect(afterReload.raw).toBe(rawBeforeReload);
    expect(afterReload.items).toEqual([bufferedItem()]);
  });

  test("keeps the encrypted queue readable after the session key is gone", async ({ page }) => {
    const rawBeforeReload = await page.evaluate(
      async ({ queueKey, keyVersion, item }) => {
        const control = (
          window.__itemtraxxTest as typeof window.__itemtraxxTest & {
            offlineCheckoutQueue: OfflineQueueControl;
          }
        ).offlineCheckoutQueue;
        await control.write([item]);
        window.sessionStorage.removeItem(keyVersion);
        return window.localStorage.getItem(queueKey);
      },
      { queueKey: OFFLINE_QUEUE_KEY, keyVersion: OFFLINE_QUEUE_KEY_VERSION, item: bufferedItem() }
    );

    await page.reload();
    await openFixture(page);

    const result = await page.evaluate(async (queueKey) => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      return { raw: window.localStorage.getItem(queueKey), items: await control.read() };
    }, OFFLINE_QUEUE_KEY);

    expect(result.raw).toBe(rawBeforeReload);
    expect(result.items).toEqual([bufferedItem()]);
  });

  test("preserves an existing encrypted queue while migrating its session key", async ({ page }) => {
    const items = await page.evaluate(async ({ queueKey, keyVersion, item }) => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      const toBase64 = (bytes: Uint8Array) => {
        let binary = "";
        for (const value of bytes) binary += String.fromCharCode(value);
        return window.btoa(binary);
      };
      const key = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      const rawKey = await window.crypto.subtle.exportKey("raw", key);
      window.sessionStorage.setItem(keyVersion, toBase64(new Uint8Array(rawKey)));
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode(JSON.stringify([item]));
      const cipher = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
      window.localStorage.setItem(
        queueKey,
        JSON.stringify({ version: 1, iv: toBase64(iv), cipher: toBase64(new Uint8Array(cipher)) })
      );
      const migratedItems = await control.read();
      window.sessionStorage.removeItem(keyVersion);
      return migratedItems;
    }, { queueKey: OFFLINE_QUEUE_KEY, keyVersion: OFFLINE_QUEUE_KEY_VERSION, item: bufferedItem() });

    expect(items).toEqual([bufferedItem()]);
    await page.reload();
    await openFixture(page);
    const afterReload = await page.evaluate(async () => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      return control.read();
    });
    expect(afterReload).toEqual([bufferedItem()]);
  });

  test("stores a non-extractable queue key outside web storage", async ({ page }) => {
    const result = await page.evaluate(async ({ databaseName, storeName, keyVersion, item }) => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      await control.write([item]);
      const key = await new Promise<CryptoKey>((resolve, reject) => {
        const openRequest = window.indexedDB.open(databaseName);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const request = database.transaction(storeName, "readonly").objectStore(storeName).get("checkout-buffer");
          request.onsuccess = () => {
            database.close();
            resolve(request.result as CryptoKey);
          };
          request.onerror = () => reject(request.error);
        };
        openRequest.onerror = () => reject(openRequest.error);
      });
      let exportRejected = false;
      try {
        await window.crypto.subtle.exportKey("raw", key);
      } catch {
        exportRejected = true;
      }
      return {
        keyIsExtractable: key.extractable,
        exportRejected,
        sessionKey: window.sessionStorage.getItem(keyVersion),
      };
    }, {
      databaseName: OFFLINE_QUEUE_KEY_DATABASE,
      storeName: "keys",
      keyVersion: OFFLINE_QUEUE_KEY_VERSION,
      item: bufferedItem(),
    });

    expect(result).toEqual({ keyIsExtractable: false, exportRejected: true, sessionKey: null });
  });

  test("clears both the queue and its persistent key for logout", async ({ page }) => {
    const result = await page.evaluate(async ({ databaseName, storeName, queueKey, keyVersion, item }) => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      await control.write([item]);
      await control.clear();
      const persistentKey = await new Promise<unknown>((resolve, reject) => {
        const openRequest = window.indexedDB.open(databaseName);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const request = database.transaction(storeName, "readonly").objectStore(storeName).get("checkout-buffer");
          request.onsuccess = () => {
            database.close();
            resolve(request.result);
          };
          request.onerror = () => reject(request.error);
        };
        openRequest.onerror = () => reject(openRequest.error);
      });
      return {
        queue: window.localStorage.getItem(queueKey),
        sessionKey: window.sessionStorage.getItem(keyVersion),
        hasPersistentKey: persistentKey !== undefined,
      };
    }, {
      databaseName: OFFLINE_QUEUE_KEY_DATABASE,
      storeName: "keys",
      queueKey: OFFLINE_QUEUE_KEY,
      keyVersion: OFFLINE_QUEUE_KEY_VERSION,
      item: bufferedItem(),
    });

    expect(result).toEqual({ queue: null, sessionKey: null, hasPersistentKey: false });
  });

  test("migrates a legacy plaintext array to the encrypted envelope", async ({ page }) => {
    const result = await page.evaluate(
      async ({ queueKey, item }) => {
        const control = (
          window.__itemtraxxTest as typeof window.__itemtraxxTest & {
            offlineCheckoutQueue: OfflineQueueControl;
          }
        ).offlineCheckoutQueue;
        window.localStorage.setItem(queueKey, JSON.stringify([item]));
        const items = await control.read();
        const migratedRaw = window.localStorage.getItem(queueKey);
        const migrated = JSON.parse(migratedRaw ?? "null") as Record<string, unknown> | null;
        return {
          items,
          rawContainsStudentId: migratedRaw?.includes(item.payload.student_id) ?? false,
          version: migrated?.version,
          hasIv: typeof migrated?.iv === "string" && migrated.iv.length > 0,
          hasCipher: typeof migrated?.cipher === "string" && migrated.cipher.length > 0,
        };
      },
      { queueKey: OFFLINE_QUEUE_KEY, item: bufferedItem() }
    );

    expect(result).toEqual({
      items: [bufferedItem()],
      rawContainsStudentId: false,
      version: 2,
      hasIv: true,
      hasCipher: true,
    });
  });

  test("resets a corrupted envelope and exposes its warning once", async ({ page }) => {
    const result = await page.evaluate(async (queueKey) => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      window.localStorage.setItem(
        queueKey,
        JSON.stringify({ version: 2, iv: "not-valid-base64", cipher: "not-valid-base64" })
      );
      const items = await control.read();
      return {
        items,
        raw: window.localStorage.getItem(queueKey),
        firstWarning: await control.consumeWarning(),
        secondWarning: await control.consumeWarning(),
      };
    }, OFFLINE_QUEUE_KEY);

    expect(result.items).toEqual([]);
    expect(result.raw).toBeNull();
    expect(result.firstWarning).toContain("Buffered transaction cache was reset");
    expect(result.secondWarning).toBeNull();
  });

  test("serializes concurrent exclusive lock callbacks", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      const events: string[] = [];
      let active = 0;
      let maxActive = 0;
      const run = (label: string, delay: number) =>
        control.withLock(async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          events.push(`${label}:start`);
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          events.push(`${label}:end`);
          active -= 1;
        });

      await Promise.all([run("first", 40), run("second", 0)]);
      return { events, maxActive };
    });

    expect(result.maxActive).toBe(1);
    expect([
      ["first:start", "first:end", "second:start", "second:end"],
      ["second:start", "second:end", "first:start", "first:end"],
    ]).toContainEqual(result.events);
  });

  test("queues payloads, counts them, and preserves an existing operation ID", async ({ page }) => {
    const result = await page.evaluate(async (existingPayload) => {
      const control = (
        window.__itemtraxxTest as typeof window.__itemtraxxTest & {
          offlineCheckoutQueue: OfflineQueueControl;
        }
      ).offlineCheckoutQueue;
      const ensured = await control.ensureOperationId(existingPayload);
      const queuedCount = await control.queue(ensured, "Network request failed");
      const items = await control.read();
      return {
        ensuredOperationId: ensured.operation_id,
        queuedCount,
        count: await control.getCount(),
        queuedOperationId: items[0]?.payload.operation_id,
      };
    }, payload("op-preserved-e2e"));

    expect(result).toEqual({
      ensuredOperationId: "op-preserved-e2e",
      queuedCount: 1,
      count: 1,
      queuedOperationId: "op-preserved-e2e",
    });
  });
});
