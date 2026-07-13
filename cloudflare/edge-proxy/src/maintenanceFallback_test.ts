import {
  applyMaintenanceFallbackToStatusPayload,
  clearMaintenanceFallbackIfPresent,
  extractMaintenanceFromStatusPayload,
  readMaintenanceFallback,
  writeMaintenanceFallback,
} from "./maintenanceFallback.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

type StoredValue = string | null;

const createKv = (initial: StoredValue = null) => {
  let stored = initial;
  const puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = [];
  const deletes: string[] = [];
  const kv = {
    get: (key: string, type?: string) => {
      if (type === "json") return Promise.resolve(stored === null ? null : JSON.parse(stored));
      return Promise.resolve(stored);
    },
    put: (key: string, value: string, options?: { expirationTtl?: number }) => {
      puts.push({ key, value, options });
      stored = value;
      return Promise.resolve();
    },
    delete: (key: string) => {
      deletes.push(key);
      stored = null;
      return Promise.resolve();
    },
  };
  return { kv, puts, deletes, readStored: () => stored };
};

Deno.test("maintenance fallback KV read validates and normalizes cached payloads", async () => {
  const valid = createKv(JSON.stringify({ enabled: true, message: "  Scheduled work  ", updated_at: "2026-07-13T00:00:00Z" }));
  assertEquals(
    await readMaintenanceFallback({ MAINTENANCE_FALLBACK_KV: valid.kv } as Env),
    { enabled: true, message: "Scheduled work", updated_at: "2026-07-13T00:00:00Z" },
    "valid fallback",
  );

  const blank = createKv(JSON.stringify({ enabled: true, message: " ", updated_at: "2026-07-13T00:00:00Z" }));
  assertEquals(
    (await readMaintenanceFallback({ MAINTENANCE_FALLBACK_KV: blank.kv } as Env))?.message,
    "Maintenance currently in progress.",
    "blank message fallback",
  );

  for (const value of [null, "{}", JSON.stringify({ enabled: false, message: "x", updated_at: "now" })]) {
    const invalid = createKv(value);
    assertEquals(await readMaintenanceFallback({ MAINTENANCE_FALLBACK_KV: invalid.kv } as Env), null, "invalid fallback");
  }
  assertEquals(await readMaintenanceFallback({} as Env), null, "missing KV binding");
});

Deno.test("maintenance fallback KV writes and clears use the exact key and TTL", async () => {
  const state = createKv();
  const env = { MAINTENANCE_FALLBACK_KV: state.kv } as Env;
  const payload = { enabled: true, message: "Scheduled work", updated_at: "2026-07-13T00:00:00Z" };
  await writeMaintenanceFallback(env, payload);
  assertEquals(state.puts, [{
    key: "itemtraxx:maintenance_fallback:v1",
    value: JSON.stringify(payload),
    options: { expirationTtl: 60 * 60 * 24 * 14 },
  }], "KV put");

  await clearMaintenanceFallbackIfPresent(env);
  assertEquals(state.deletes, ["itemtraxx:maintenance_fallback:v1"], "conditional clear");
  await clearMaintenanceFallbackIfPresent(env);
  assertEquals(state.deletes.length, 1, "already-empty KV should not delete again");

  await writeMaintenanceFallback(env, payload);
  await writeMaintenanceFallback(env, null);
  assertEquals(state.deletes.length, 2, "explicit null write should delete");
  assertEquals(state.readStored(), null, "cleared stored value");
});

Deno.test("maintenance extraction preserves enabled, disabled, and default-message semantics", () => {
  assertEquals(extractMaintenanceFromStatusPayload({}), null, "missing maintenance");
  assertEquals(
    extractMaintenanceFromStatusPayload({ maintenance: { enabled: true, message: " active ", updated_at: "stamp" } }),
    { enabled: true, message: "active", updated_at: "stamp" },
    "enabled maintenance",
  );
  const defaulted = extractMaintenanceFromStatusPayload({ maintenance: { enabled: true, message: "", updated_at: "" } });
  assertEquals(defaulted?.enabled, true, "defaulted enabled flag");
  assertEquals(defaulted?.message, "Maintenance currently in progress.", "defaulted message");
  assert(typeof defaulted?.updated_at === "string" && defaulted.updated_at.length > 0, "defaulted timestamp");

  const disabled = extractMaintenanceFromStatusPayload({ maintenance: { enabled: false } });
  assertEquals(disabled?.enabled, false, "disabled flag");
  assertEquals(disabled?.message, "", "disabled message");
});

Deno.test("status fallback caches active maintenance and applies it only to unhealthy responses", async () => {
  const cached = { enabled: true, message: "Known maintenance", updated_at: "2026-07-13T00:00:00Z" };
  const state = createKv(JSON.stringify(cached));
  const env = { MAINTENANCE_FALLBACK_KV: state.kv } as Env;

  const healthy = { status: "ok", checks: { db: "ok" } };
  assertEquals(await applyMaintenanceFallbackToStatusPayload(env, 200, healthy), healthy, "healthy payload");

  for (const [statusCode, payload] of [
    [503, { status: "degraded", checks: { db: "ok" } }],
    [200, { status: "down", checks: { db: "ok" } }],
    [200, { status: "degraded", checks: { db: "failed" } }],
  ] as const) {
    assertEquals(
      await applyMaintenanceFallbackToStatusPayload(env, statusCode, payload),
      { ...payload, maintenance: cached, maintenance_fallback: true },
      `unhealthy fallback for ${statusCode}`,
    );
  }

  const active = { status: "ok", maintenance: { enabled: true, message: " Fresh ", updated_at: "new-stamp" } };
  assertEquals(await applyMaintenanceFallbackToStatusPayload(env, 200, active), active, "active upstream payload");
  assertEquals(JSON.parse(state.readStored() ?? "null"), {
    enabled: true,
    message: "Fresh",
    updated_at: "new-stamp",
  }, "fresh maintenance cache");

  const disabled = { status: "ok", maintenance: { enabled: false } };
  assertEquals(await applyMaintenanceFallbackToStatusPayload(env, 200, disabled), disabled, "disabled upstream payload");
  assertEquals(state.readStored(), null, "disabled maintenance clears cache");
});
