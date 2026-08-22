import { expect, test, type Page } from "@playwright/test";
import {
  mockAdminOps,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

const OFFLINE_QUEUE_KEY = "itemtraxx:checkout-offline-buffer:v1";
const OFFLINE_QUEUE_KEY_VERSION = "itemtraxx:checkout-offline-buffer:key:v1";
const OFFLINE_QUEUE_LOCK_KEY = "itemtraxx:checkout-offline-buffer:lock:v1";
const OFFLINE_QUEUE_KEY_DATABASE = "itemtraxx-offline-queue";
const OFFLINE_WORKFLOW_DATABASE = "itemtraxx-offline-workflow";
const OFFLINE_WORKFLOW_RECORD_STORE = "records";

type CheckoutReturnPayload = {
  borrower_id: string;
  item_barcodes: string[];
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
  borrower_id: "borrower-e2e",
  item_barcodes: ["ITEM-E2E-001"],
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
          rawContainsBorrowerId: raw?.includes(item.payload.borrower_id) ?? false,
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
      rawContainsBorrowerId: false,
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
          rawContainsBorrowerId: migratedRaw?.includes(item.payload.borrower_id) ?? false,
          version: migrated?.version,
          hasIv: typeof migrated?.iv === "string" && migrated.iv.length > 0,
          hasCipher: typeof migrated?.cipher === "string" && migrated.cipher.length > 0,
        };
      },
      { queueKey: OFFLINE_QUEUE_KEY, item: bufferedItem() }
    );

    expect(result).toEqual({
      items: [bufferedItem()],
      rawContainsBorrowerId: false,
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

test.describe("prepared offline checkout workflow contract", () => {
  test.beforeEach(async ({ page }) => {
    await mockUnauthenticatedSession(page);
    await openFixture(page);
    await clearQueueStorage(page);
    await page.evaluate(async (databaseName) => {
      await new Promise<void>((resolve, reject) => {
        const request = window.indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Offline workflow database is blocked."));
      });
    }, OFFLINE_WORKFLOW_DATABASE);
  });

  test("encrypts a prepared pack and isolates it to the active workspace and account", async ({ page }) => {
    const result = await page.evaluate(async ({ databaseName, storeName }) => {
      const control = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          readPack: (scope: { workspaceId: string; profileId: string; deviceId: string }) => Promise<unknown>;
        };
      }).offlineCheckoutWorkflow;
      const pack = {
        schema_version: 1,
        pack_version: "pack-e2e",
        workspace_id: "workspace-e2e",
        profile_id: "profile-e2e",
        device_id: "device-e2e",
        prepared_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        borrowers: [{ id: "borrower-1", username: "Maya Chen", borrower_id: "STU-100" }],
        items: [{ id: "item-1", name: "Camera", barcode: "CAM-014", status: "available", checked_out_by: null }],
      };
      await control.writePack(pack);
      const encryptedRecord = await new Promise<unknown>((resolve, reject) => {
        const openRequest = window.indexedDB.open(databaseName);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const request = database.transaction(storeName, "readonly").objectStore(storeName).get("pack");
          request.onsuccess = () => {
            database.close();
            resolve(request.result);
          };
          request.onerror = () => reject(request.error);
        };
        openRequest.onerror = () => reject(openRequest.error);
      });
      const raw = JSON.stringify(encryptedRecord);
      return {
        rawContainsBorrower: raw?.includes("Maya Chen") ?? false,
        envelopeVersion: (encryptedRecord as { version?: number } | null)?.version,
        matching: await control.readPack({ workspaceId: "workspace-e2e", profileId: "profile-e2e", deviceId: "device-e2e" }),
        wrongWorkspace: await control.readPack({ workspaceId: "workspace-other", profileId: "profile-e2e", deviceId: "device-e2e" }),
      };
    }, { databaseName: OFFLINE_WORKFLOW_DATABASE, storeName: OFFLINE_WORKFLOW_RECORD_STORE });

    expect(result.rawContainsBorrower).toBe(false);
    expect(result.envelopeVersion).toBe(1);
    expect(result.matching).toMatchObject({ workspace_id: "workspace-e2e", profile_id: "profile-e2e" });
    expect(result.wrongWorkspace).toBeNull();
  });

  test("applies pending checkout and return transactions over the downloaded pack", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const control = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
          findBorrower: (scope: unknown, borrowerId: string) => Promise<unknown>;
          findItem: (scope: unknown, barcode: string) => Promise<unknown>;
          checkedOutItems: (scope: unknown, borrowerUuid: string) => Promise<unknown[]>;
        };
        offlineCheckoutQueue: OfflineQueueControl;
      });
      const scope = { workspaceId: "workspace-e2e", profileId: "profile-e2e", deviceId: "device-e2e" };
      await control.offlineCheckoutWorkflow.writePack({
        schema_version: 1,
        pack_version: "pack-e2e",
        workspace_id: "workspace-e2e",
        profile_id: "profile-e2e",
        device_id: "device-e2e",
        prepared_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        borrowers: [
          { id: "borrower-1", username: "Maya Chen", borrower_id: "STU-100" },
          { id: "borrower-2", username: "Jon Bell", borrower_id: "STU-200" },
        ],
        items: [
          { id: "item-1", name: "Camera", barcode: "CAM-014", status: "available", checked_out_by: null },
          { id: "item-2", name: "Tripod", barcode: "TRIPOD-009", status: "checked_out", checked_out_by: "borrower-2" },
        ],
      });
      await control.offlineCheckoutWorkflow.writeLedger([
        {
          schema_version: 1,
          id: "queued-checkout",
          operation_id: "op-checkout",
          workspace_id: "workspace-e2e",
          profile_id: "profile-e2e",
          device_id: "device-e2e",
          pack_version: "pack-e2e",
          created_at: new Date().toISOString(),
          attempts: 0,
          last_error: null,
          status: "pending",
          items: [{ item_id: "item-1", barcode: "CAM-014", name: "Camera", intent: "checkout", borrower_id: "borrower-1", borrower_display_id: "STU-100", borrower_username: "Maya Chen", expected_status: "available", expected_checked_out_by: null, status: "pending" }],
        },
        {
          schema_version: 1,
          id: "queued-return",
          operation_id: "op-return",
          workspace_id: "workspace-e2e",
          profile_id: "profile-e2e",
          device_id: "device-e2e",
          pack_version: "pack-e2e",
          created_at: new Date().toISOString(),
          attempts: 0,
          last_error: null,
          status: "needs_review",
          items: [{ item_id: "item-2", barcode: "TRIPOD-009", name: "Tripod", intent: "return", borrower_id: "borrower-2", borrower_display_id: "STU-200", borrower_username: "Jon Bell", expected_status: "checked_out", expected_checked_out_by: "borrower-2", status: "needs_review" }],
        },
      ]);
      return {
        borrower: await control.offlineCheckoutWorkflow.findBorrower(scope, "STU-100"),
        checkedOutForMaya: await control.offlineCheckoutWorkflow.checkedOutItems(scope, "borrower-1"),
        camera: await control.offlineCheckoutWorkflow.findItem(scope, "CAM-014"),
        tripod: await control.offlineCheckoutWorkflow.findItem(scope, "TRIPOD-009"),
      };
    });

    expect(result.borrower).toMatchObject({ username: "Maya Chen" });
    expect(result.checkedOutForMaya).toEqual([
      expect.objectContaining({ barcode: "CAM-014", status: "checked_out", checked_out_by: "borrower-1" }),
    ]);
    expect(result.camera).toMatchObject({ status: "checked_out", checked_out_by: "borrower-1" });
    expect(result.tripod).toMatchObject({ status: "available", checked_out_by: null });
  });

  test("updates the offline pack immediately after a server-confirmed checkout or return", async ({ page }) => {
    const result = await page.evaluate(async (pack) => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.__itemtraxxTest?.setWorkspaceAdminSession("workspace-e2e");
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          findItem: (scope: unknown, barcode: string) => Promise<unknown>;
          applyConfirmed: (draft: unknown) => Promise<boolean>;
        };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
      const borrower = pack.borrowers[0];
      const item = pack.items[0];
      const checkedOut = await workflow.applyConfirmed({ borrower, items: [{ item, intent: "checkout" }] });
      const afterCheckout = await workflow.findItem({ workspaceId: "workspace-e2e", profileId: "user-e2e-admin", deviceId: "device-e2e" }, item.barcode);
      const returned = await workflow.applyConfirmed({ borrower, items: [{ item, intent: "return" }] });
      const afterReturn = await workflow.findItem({ workspaceId: "workspace-e2e", profileId: "user-e2e-admin", deviceId: "device-e2e" }, item.barcode);
      return { checkedOut, afterCheckout, returned, afterReturn };
    }, workflowPack());

    expect(result).toMatchObject({
      checkedOut: true,
      afterCheckout: { status: "checked_out", checked_out_by: "borrower-1" },
      returned: true,
      afterReturn: { status: "available", checked_out_by: null },
    });
  });

  test("retains a rejected replay for manual review and resolves it explicitly", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const control = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          markNeedsReview: (id: string, reason: string, serverState: unknown) => Promise<void>;
          listReviewItems: () => Promise<Array<{ id: string; status: string; conflict?: unknown }>>;
          keepServerState: (id: string) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
          readLedger: () => Promise<unknown[]>;
        };
      });
      await control.offlineCheckoutWorkflow.writeLedger([{
        schema_version: 1,
        id: "queue-item-e2e",
        operation_id: "op-conflict",
        workspace_id: "workspace-e2e",
        profile_id: "profile-e2e",
        device_id: "device-e2e",
        pack_version: "pack-e2e",
        created_at: "2026-07-28T10:00:00.000Z",
        status: "pending",
        attempts: 0,
        last_error: null,
        items: [{ item_id: "item-1", barcode: "ITEM-E2E-001", name: "Camera", intent: "checkout", borrower_id: "borrower-1", borrower_display_id: "STU-100", borrower_username: "Maya Chen", expected_status: "available", expected_checked_out_by: null, status: "pending" }],
      }]);
      await control.offlineCheckoutWorkflow.markNeedsReview(
        "queue-item-e2e",
        "Item is checked out to another borrower.",
        { barcode: "ITEM-E2E-001", status: "checked_out", borrower_id: "STU-OTHER" },
      );
      const before = await control.offlineCheckoutWorkflow.listReviewItems();
      await control.offlineCheckoutWorkflow.keepServerState("queue-item-e2e");
      const after = await control.offlineCheckoutWorkflow.listReviewItems();
      const ledger = await control.offlineCheckoutWorkflow.readLedger();
      return { before, after, ledger };
    });

    expect(result.before).toEqual([
      expect.objectContaining({
        id: "queue-item-e2e",
        status: "needs_review",
        last_error: "Item is checked out to another borrower.",
      }),
    ]);
    expect(result.after).toEqual([]);
    expect(result.ledger).toEqual([
      expect.objectContaining({ id: "queue-item-e2e", status: "kept_server" }),
    ]);
  });

  test("moves a permanent sync rejection to review without clearing the outage timer", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Workspace access changed." }) });
    });
    const result = await page.evaluate(async ({ pack, entry }) => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.localStorage.setItem("itemtraxx:offline-connection:v1", JSON.stringify({
        last_confirmed_at: "2026-07-28T08:00:00.000Z",
        unreachable_since: "2026-07-28T09:00:00.000Z",
        acknowledged_hours: 0,
      }));
      window.__itemtraxxTest?.setWorkspaceAdminSession("workspace-e2e");
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
          readLedger: () => Promise<Array<{ status: string; last_error: string | null }>>;
          sync: () => Promise<unknown>;
        };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
      await workflow.writeLedger([entry]);
      await workflow.sync();
      return {
        ledger: await workflow.readLedger(),
        connection: JSON.parse(window.localStorage.getItem("itemtraxx:offline-connection:v1") ?? "null"),
      };
    }, { pack: workflowPack(), entry: workflowEntry() });

    expect(result.ledger[0]).toMatchObject({ status: "needs_review", last_error: "Workspace access changed." });
    expect(result.connection.unreachable_since).toBe("2026-07-28T09:00:00.000Z");
  });

  test("discards a request-level rejection locally when keeping server state", async ({ page }) => {
    const actions: string[] = [];
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      actions.push((route.request().postDataJSON() as { action: string }).action);
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Workspace access changed." }) });
    });
    const result = await page.evaluate(async ({ pack, entry }) => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.__itemtraxxTest?.setWorkspaceAdminSession("workspace-e2e");
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
          readLedger: () => Promise<Array<{ status: string; items: Array<{ status: string }> }>>;
          sync: () => Promise<unknown>;
          resolve: (id: string, resolution: "keep_server" | "apply_offline") => Promise<void>;
        };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
      await workflow.writeLedger([entry]);
      await workflow.sync();
      let message = "";
      try { await workflow.resolve(entry.id, "keep_server"); } catch (error) { message = error instanceof Error ? error.message : "failed"; }
      return { message, ledger: await workflow.readLedger() };
    }, { pack: workflowPack(), entry: workflowEntry() });

    expect(actions).toEqual(["sync"]);
    expect(result.message).toBe("");
    expect(result.ledger[0]).toMatchObject({
      status: "kept_server",
      items: [expect.objectContaining({ status: "kept_server" })],
    });
  });

  test("keeps retryable server failures pending and preserves the outage timer", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Service unavailable." }) });
    });
    const result = await page.evaluate(async ({ pack, entry }) => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.localStorage.setItem("itemtraxx:offline-connection:v1", JSON.stringify({
        last_confirmed_at: "2026-07-28T08:00:00.000Z",
        unreachable_since: "2026-07-28T09:00:00.000Z",
        acknowledged_hours: 0,
      }));
      window.__itemtraxxTest?.setWorkspaceAdminSession("workspace-e2e");
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
          readLedger: () => Promise<Array<{ status: string }>>;
          sync: () => Promise<unknown>;
        };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
      await workflow.writeLedger([entry]);
      await workflow.sync();
      return {
        ledger: await workflow.readLedger(),
        connection: JSON.parse(window.localStorage.getItem("itemtraxx:offline-connection:v1") ?? "null"),
      };
    }, { pack: workflowPack(), entry: workflowEntry() });

    expect(result.ledger[0]).toMatchObject({ status: "pending" });
    expect(result.connection.unreachable_since).toBe("2026-07-28T09:00:00.000Z");
  });

  test("keeps synced item overlays when only the conflicting item keeps server state", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {
          operation_id: "op-workflow-e2e",
          status: "resolved",
          resolution: "keep_server",
          item_results: [{ item_id: "item-2", barcode: "ITEM-2", status: "kept_server", server_state: { status: "available", checked_out_by: null } }],
        } }),
      });
    });
    const result = await page.evaluate(async ({ pack, baseEntry }) => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.__itemtraxxTest?.setWorkspaceAdminSession("workspace-e2e");
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
          resolve: (id: string, resolution: "keep_server" | "apply_offline") => Promise<void>;
          findItem: (scope: unknown, barcode: string) => Promise<unknown>;
        };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
      const entry = { ...baseEntry, status: "needs_review", review_origin: "server_conflict" };
      entry.items = [
        { ...entry.items[0], status: "synced" },
        { ...entry.items[0], item_id: "item-2", barcode: "ITEM-2", name: "Tripod", status: "needs_review", reason: "server_state_changed" },
      ];
      await workflow.writeLedger([entry]);
      await workflow.resolve("entry-workflow-e2e", "keep_server");
      const scope = { workspaceId: "workspace-e2e", profileId: "user-e2e-admin", deviceId: "device-e2e" };
      return {
        syncedItem: await workflow.findItem(scope, "ITEM-1"),
        keptServerItem: await workflow.findItem(scope, "ITEM-2"),
      };
    }, { pack: workflowPack(), baseEntry: workflowEntry() });

    expect(result.syncedItem).toMatchObject({ status: "checked_out", checked_out_by: "borrower-1" });
    expect(result.keptServerItem).toMatchObject({ status: "available", checked_out_by: null });
  });

  test("persists a failed apply-offline result before reporting its 409", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Offline transaction still conflicts.",
          data: {
            operation_id: "op-workflow-e2e",
            status: "needs_review",
            resolution: "apply_offline",
            item_results: [{
              item_id: "item-1",
              barcode: "ITEM-1",
              status: "needs_review",
              reason: "resolution_failed",
              server_state: { status: "checked_out", checked_out_by: "borrower-other" },
            }],
          },
        }),
      });
    });
    const result = await page.evaluate(async ({ pack, baseEntry }) => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.__itemtraxxTest?.setWorkspaceAdminSession("workspace-e2e");
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
          readLedger: () => Promise<Array<{ items: Array<{ reason?: string; server_state?: unknown }> }>>;
          resolve: (id: string, resolution: "keep_server" | "apply_offline") => Promise<void>;
        };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
      const entry = baseEntry;
      entry.status = "needs_review";
      entry.items[0].status = "needs_review";
      await workflow.writeLedger([entry]);
      let message = "";
      try { await workflow.resolve("entry-workflow-e2e", "apply_offline"); } catch (error) { message = error instanceof Error ? error.message : "failed"; }
      return { message, ledger: await workflow.readLedger() };
    }, { pack: workflowPack(), baseEntry: workflowEntry() });

    expect(result.message).toBe("Offline transaction still conflicts.");
    expect(result.ledger[0].items[0]).toMatchObject({
      reason: "resolution_failed",
      server_state: { status: "checked_out", checked_out_by: "borrower-other" },
    });
  });

  test("automatically prepares an offline pack and gives immediate tab-safety guidance during an outage", async ({ page, context }) => {
    await mockSystemStatus(page);
    await page.evaluate(() => window.localStorage.setItem("itemtraxx-device-id", "device-e2e"));
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      expect(body.action).toBe("prepare_pack");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            pack_version: "automatic-pack-e2e",
            workspace_id: "workspace-e2e",
            prepared_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            borrowers: [{ id: "borrower-1", username: "Maya Chen", borrower_id: "STU-100" }],
            items: [{ id: "item-1", name: "Camera", barcode: "ITEM-1", status: "available", checked_out_by: null }],
          },
        }),
      });
    });
    await setWorkspaceAdminSession(page, "workspace-e2e");
    await navigateApp(page, "/checkout");

    await expect(page.getByText("Ready for offline use in the case of an outage.")).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => {
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          readPack: (scope: { workspaceId: string; profileId: string; deviceId: string }) => Promise<unknown>;
        };
      }).offlineCheckoutWorkflow;
      return workflow.readPack({ workspaceId: "workspace-e2e", profileId: "user-e2e-admin", deviceId: "device-e2e" });
    })).toMatchObject({ pack_version: "automatic-pack-e2e", workspace_id: "workspace-e2e" });
    await expect(page.getByRole("button", { name: /prepare|refresh offline/i })).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByText("You're offline. Keep this tab open—do not refresh, close it, log out, or clear browser data until you reconnect.")).toBeVisible();
  });

  test("uses only the Offline Queue toast when buffering an offline checkout", async ({ page, context }) => {
    await mockSystemStatus(page);
    await page.evaluate(() => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", new Date().toISOString());
    });
    await setWorkspaceAdminSession(page, "workspace-e2e");
    await page.evaluate(async (pack) => {
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: { writePack: (pack: unknown) => Promise<void> };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
    }, workflowPack());
    await navigateApp(page, "/checkout");
    const consentButton = page.getByRole("button", { name: "Essential only" });
    if (await consentButton.isVisible()) await consentButton.click();
    await context.setOffline(true);

    await page.getByPlaceholder("Enter borrower ID").fill("STU-100");
    await page.getByRole("button", { name: "Load borrower" }).click();
    await expect(page.getByText("Maya Chen")).toBeVisible();
    await page.getByPlaceholder("Scan or enter barcode").fill("ITEM-1");
    await page.getByRole("button", { name: "Add barcode" }).click();
    await page.getByRole("button", { name: "Complete transaction" }).click();

    await expect(page.getByText("Offline Queue")).toBeVisible();
    await expect(page.getByText("Transaction processing...")).toHaveCount(0);
  });

  test("waits for a new account session without showing a disabled-account error or re-preparing a restored pack", async ({ page }) => {
    await mockSystemStatus(page);
    await mockAdminOps(page);
    await page.evaluate(() => window.localStorage.setItem("itemtraxx-device-id", "device-e2e"));
    let prepareAttempts = 0;
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      prepareAttempts += 1;
      if (prepareAttempts === 1) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "Offline session is still initializing. Please retry." }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            pack_version: "session-retry-pack-e2e",
            workspace_id: "workspace-e2e",
            prepared_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            borrowers: [{ id: "borrower-1", username: "Maya Chen", borrower_id: "STU-100" }],
            items: [{ id: "item-1", name: "Camera", barcode: "ITEM-1", status: "available", checked_out_by: null }],
          },
        }),
      });
    });
    await setWorkspaceAdminSession(page, "workspace-e2e");
    await navigateApp(page, "/checkout");

    await expect(page.getByText("Ready for offline use in the case of an outage.")).toBeVisible();
    expect(prepareAttempts).toBe(2);
    await expect(page.getByText("Offline setup needs attention")).toHaveCount(0);

    await navigateApp(page, "/admin/return");
    await expect(page.getByText("Preparing this device for offline use in the case of an outage.")).toHaveCount(0);
    expect(prepareAttempts).toBe(2);
  });

  test("uses the Offline Queue toast for sync progress and completion", async ({ page }) => {
    await mockSystemStatus(page);
    await page.evaluate(async ({ pack, entry }) => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.__itemtraxxTest?.setWorkspaceAdminSession("workspace-e2e");
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
        };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
      await workflow.writeLedger([entry]);
    }, {
      pack: {
        ...workflowPack(),
        prepared_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      entry: workflowEntry(),
    });
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "prepare_pack") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { ...workflowPack(), prepared_at: new Date().toISOString() } }),
        });
        return;
      }
      expect(body.action).toBe("sync");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            operations: [{
              operation_id: "op-workflow-e2e",
              status: "synced",
              item_results: [{ item_id: "item-1", barcode: "ITEM-1", status: "synced" }],
            }],
          },
        }),
      });
    });
    await navigateApp(page, "/checkout");

    await expect(page.getByText("Syncing offline queue")).toBeVisible();
    await expect(page.getByText("Syncing 1 transaction to ItemTraxx Servers.")).toBeVisible();
    await expect(page.getByText("Offline queue synced")).toBeVisible();
    await expect(page.getByText("1 transaction synced to ItemTraxx Servers.")).toBeVisible();
  });

  test("lets an operator manually retry a pending sync from the checkout status bar", async ({ page }) => {
    await mockSystemStatus(page);
    await setWorkspaceAdminSession(page, "workspace-e2e");
    await page.evaluate(async ({ pack, entry }) => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", new Date().toISOString());
      window.localStorage.setItem("itemtraxx:offline-connection:v1", JSON.stringify({
        last_confirmed_at: new Date(Date.now() - 60_000).toISOString(),
        unreachable_since: new Date(Date.now() - 30_000).toISOString(),
        acknowledged_hours: 0,
      }));
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          writePack: (pack: unknown) => Promise<void>;
          writeLedger: (entries: unknown[]) => Promise<void>;
          readPack: (scope: { workspaceId: string; profileId: string; deviceId: string }) => Promise<unknown>;
        };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
      await workflow.writeLedger([entry]);
    }, {
      pack: {
        ...workflowPack(),
        prepared_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      entry: workflowEntry(),
    });

    let syncAttempts = 0;
    let preparePackAttempts = 0;
    await page.route(/\/functions(?:\/v1)?\/offline-checkout(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "prepare_pack") {
        preparePackAttempts += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              pack_version: "refreshed-pack-workflow-e2e",
              workspace_id: "workspace-e2e",
              prepared_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 86_400_000).toISOString(),
              borrowers: [
                { id: "borrower-1", username: "Maya Chen (updated)", borrower_id: "STU-100" },
                { id: "borrower-2", username: "Jon Bell", borrower_id: "STU-200" },
              ],
              items: [
                { id: "item-1", name: "Camera", barcode: "ITEM-1", status: "checked_out", checked_out_by: "borrower-1" },
                { id: "item-2", name: "Tripod", barcode: "ITEM-2", status: "available", checked_out_by: null },
              ],
            },
          }),
        });
        return;
      }
      expect(body.action).toBe("sync");
      syncAttempts += 1;
      if (syncAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary sync outage." }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            operations: [{
              operation_id: "op-workflow-e2e",
              status: "synced",
              item_results: [{ item_id: "item-1", barcode: "ITEM-1", status: "synced" }],
            }],
          },
        }),
      });
    });
    await navigateApp(page, "/checkout");

    const syncButton = page.getByRole("button", { name: "Sync now" });
    await expect(syncButton).toBeVisible();
    await expect(syncButton).toBeEnabled();
    await syncButton.click();

    await expect(page.getByText("Connected to ItemTraxx servers. Offline queue is synced.")).toBeVisible();
    await expect.poll(() => syncAttempts).toBeGreaterThanOrEqual(2);
    await expect.poll(() => preparePackAttempts).toBe(1);
    await expect.poll(async () => page.evaluate(async () => {
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: {
          readPack: (scope: { workspaceId: string; profileId: string; deviceId: string }) => Promise<unknown>;
        };
      }).offlineCheckoutWorkflow;
      return workflow.readPack({ workspaceId: "workspace-e2e", profileId: "user-e2e-admin", deviceId: "device-e2e" });
    })).toMatchObject({
      pack_version: "refreshed-pack-workflow-e2e",
      borrowers: expect.arrayContaining([expect.objectContaining({ borrower_id: "STU-200" })]),
      items: expect.arrayContaining([expect.objectContaining({ barcode: "ITEM-1", status: "checked_out", checked_out_by: "borrower-1" })]),
    });
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => {
      const raw = window.localStorage.getItem("itemtraxx:offline-connection:v1");
      return (JSON.parse(raw ?? "null") as { unreachable_since?: string | null } | null)?.unreachable_since ?? null;
    })).toBeNull();
  });

  test("queues Quick Return with an explicit quick_return intent and current borrower", async ({ page, context }) => {
    await mockSystemStatus(page);
    await mockAdminOps(page);
    await page.evaluate(() => {
      window.localStorage.setItem("itemtraxx-device-id", "device-e2e");
      window.localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", new Date().toISOString());
      window.localStorage.setItem("itemtraxx-cookie-consent", JSON.stringify({
        version: 2,
        preferences: { analytics: false, diagnostics: false },
        updatedAt: new Date().toISOString(),
      }));
    });
    await setWorkspaceAdminSession(page, "workspace-e2e");
    await page.evaluate(async (pack) => {
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: { writePack: (pack: unknown) => Promise<void> };
      }).offlineCheckoutWorkflow;
      await workflow.writePack(pack);
    }, workflowPack({ itemStatus: "checked_out", checkedOutBy: "borrower-1" }));
    await navigateApp(page, "/admin/return");
    const consentButton = page.getByRole("button", { name: "Essential only" });
    if (await consentButton.isVisible()) await consentButton.click();
    await context.setOffline(true);
    await page.getByPlaceholder("Scan or enter barcode").fill("ITEM-1");
    await page.getByRole("button", { name: "Add item" }).click();
    await page.getByRole("button", { name: "Complete Quick Return" }).click();
    await expect(page.getByText(/Return request buffered for auto-sync/)).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => {
      const workflow = (window.__itemtraxxTest as typeof window.__itemtraxxTest & {
        offlineCheckoutWorkflow: { readLedger: () => Promise<unknown[]> };
      }).offlineCheckoutWorkflow;
      return workflow.readLedger();
    })).toEqual([
      expect.objectContaining({
        items: [expect.objectContaining({
          intent: "quick_return",
          borrower_id: "borrower-1",
          expected_checked_out_by: "borrower-1",
        })],
      }),
    ]);
  });
});

function workflowPack(options: { itemStatus?: string; checkedOutBy?: string | null } = {}) {
  return {
    schema_version: 1,
    pack_version: "pack-workflow-e2e",
    workspace_id: "workspace-e2e",
    profile_id: "user-e2e-admin",
    device_id: "device-e2e",
    prepared_at: "2026-07-28T08:00:00.000Z",
    expires_at: "2099-07-29T08:00:00.000Z",
    borrowers: [{ id: "borrower-1", username: "Maya Chen", borrower_id: "STU-100" }],
    items: [
      { id: "item-1", name: "Camera", barcode: "ITEM-1", status: options.itemStatus ?? "available", checked_out_by: options.checkedOutBy ?? null },
      { id: "item-2", name: "Tripod", barcode: "ITEM-2", status: "available", checked_out_by: null },
    ],
  };
}

function workflowEntry() {
  return {
    schema_version: 1,
    id: "entry-workflow-e2e",
    operation_id: "op-workflow-e2e",
    workspace_id: "workspace-e2e",
    profile_id: "user-e2e-admin",
    device_id: "device-e2e",
    pack_version: "pack-workflow-e2e",
    created_at: "2026-07-28T10:00:00.000Z",
    status: "pending",
    attempts: 0,
    last_error: null,
    items: [{
      item_id: "item-1",
      barcode: "ITEM-1",
      name: "Camera",
      intent: "checkout",
      borrower_id: "borrower-1",
      borrower_display_id: "STU-100",
      borrower_username: "Maya Chen",
      expected_status: "available",
      expected_checked_out_by: null,
      status: "pending",
    }],
  };
}
