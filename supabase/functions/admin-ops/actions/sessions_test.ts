import {
  findActiveSession,
  handleSessionAction,
  resolveDeviceSessionContext,
  type SessionSecurityContext,
  touchCurrentSession,
} from "./sessions.ts";
import type { AdminOpsContext, JsonResponse, SupabaseClient } from "../context.ts";

// --- hand-rolled assertion helpers (matches repo convention: no std/assert import) ---
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message?: string) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(message ?? `Expected ${b} but got ${a}`);
  }
};

const assertThrowsAsync = async (
  fn: () => Promise<unknown>,
  messageIncludes: string,
) => {
  try {
    await fn();
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(messageIncludes),
      `Expected error message to include "${messageIncludes}" but got "${
        (error as Error)?.message
      }"`,
    );
    return;
  }
  throw new Error(`Expected function to throw an error including "${messageIncludes}"`);
};

// --- mock Supabase client ---
type QueryCall = { table: string; operations: Array<{ method: string; args: unknown[] }> };
type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};

const makeClient = (
  respond: (call: QueryCall) => QueryResult | Promise<QueryResult>,
  options: { claims?: Record<string, unknown> | null; claimsError?: unknown } = {},
) => {
  const calls: QueryCall[] = [];

  const from = (table: string) => {
    const operations: QueryCall["operations"] = [];
    const query: Record<string, unknown> = {};
    const record = (method: string, args: unknown[]) => {
      operations.push({ method, args });
      return query;
    };
    for (
      const method of [
        "select",
        "insert",
        "update",
        "upsert",
        "delete",
        "eq",
        "neq",
        "is",
        "not",
        "in",
        "gte",
        "gt",
        "lte",
        "order",
        "limit",
      ]
    ) {
      query[method] = (...args: unknown[]) => record(method, args);
    }
    const resolve = () => {
      const call = { table, operations: [...operations] };
      calls.push(call);
      return Promise.resolve(respond(call));
    };
    query.single = () => {
      operations.push({ method: "single", args: [] });
      return resolve();
    };
    query.maybeSingle = () => {
      operations.push({ method: "maybeSingle", args: [] });
      return resolve();
    };
    query.then = (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => resolve().then(onFulfilled, onRejected);
    return query;
  };

  return {
    client: {
      from,
      auth: {
        getClaims: () =>
          Promise.resolve({
            data: options.claims === null ? null : {
              claims: options.claims ?? { session_id: "auth-session-1" },
            },
            error: options.claimsError ?? null,
          }),
      },
    } as unknown as SupabaseClient,
    calls,
  };
};

// Every function under test issues its account_sessions queries strictly in
// series (no Promise.all), so a call-index based sequence of canned
// responses is enough to steer each branch precisely.
const sequence = (results: QueryResult[]) => {
  let index = 0;
  return (_call: QueryCall): QueryResult => {
    const result = results[index] ?? { data: null, error: null };
    index += 1;
    return result;
  };
};

const RELATION_MISSING_ERROR = {
  code: "42P01",
  message: 'relation "account_sessions" does not exist',
};
const AUTH_BINDING_COLUMN_MISSING_ERROR = {
  code: "42703",
  message: 'column "auth_session_id" does not exist',
};
const METADATA_COLUMN_MISSING_ERROR = {
  code: "42703",
  message: 'column "login_method" does not exist',
};
const OTHER_ERROR = { code: "53300", message: "too many connections" };

const baseDeviceSession = (
  overrides: Partial<SessionSecurityContext["deviceSession"]> = {},
) => ({
  deviceId: "device-1",
  deviceLabel: "Test laptop",
  userAgent: "ItemTraxx test",
  loginMethod: "password" as const,
  loginLocation: "admin_login" as const,
  generalLocation: "Seattle, WA, US",
  ...overrides,
});

const securityContextFor = (
  adminClient: SupabaseClient,
  overrides: Partial<SessionSecurityContext> = {},
): SessionSecurityContext => ({
  requestId: "request-1",
  adminClient,
  workspaceId: "00000000-0000-4000-8000-000000000002",
  user: { id: "00000000-0000-4000-8000-000000000001" },
  authToken: "test-auth-token",
  authSessionBinding: {
    sessionId: "auth-session-1",
    issuedAt: "2023-11-14T22:13:20.000Z",
  },
  authTokenBindingKey: "session:auth-session-1",
  deviceSession: baseDeviceSession(),
  ...overrides,
});

const jsonResponse: JsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const adminOpsContextFor = (
  action: string,
  adminClient: SupabaseClient,
  payload: Record<string, unknown> = {},
  overrides: Partial<AdminOpsContext> = {},
): AdminOpsContext => ({
  requestId: "request-1",
  action,
  payload,
  adminClient,
  user: { id: "00000000-0000-4000-8000-000000000001" },
  workspaceId: "00000000-0000-4000-8000-000000000002",
  authToken: "test-auth-token",
  authSessionBinding: {
    sessionId: "auth-session-1",
    issuedAt: "2023-11-14T22:13:20.000Z",
  },
  authTokenBindingKey: "session:auth-session-1",
  deviceSession: baseDeviceSession(),
  workspacePolicy: null,
  checkoutDueHours: 72,
  featureFlags: {
    enable_notifications: true,
    enable_bulk_item_import: true,
    enable_bulk_borrower_tools: true,
    enable_status_tracking: true,
    enable_barcode_generator: true,
  },
  maintenance: { enabled: false, message: "" },
  workspaceUpdates: [],
  jsonResponse,
  ...overrides,
});

const responseBody = (response: Response) =>
  response.json() as Promise<Record<string, unknown>>;

// =====================================================================
// resolveDeviceSessionContext
// =====================================================================

Deno.test("resolveDeviceSessionContext sanitizes and resolves valid metadata", () => {
  const req = new Request("https://example.test/admin-ops", {
    method: "POST",
    headers: {
      "user-agent": "ItemTraxx test agent",
      "x-itx-geo-city": "seattle",
      "x-itx-geo-region": "washington",
      "x-itx-geo-country": "us",
    },
  });
  const result = resolveDeviceSessionContext(
    {
      device_id: "device-abc",
      device_label: "Front Desk iPad",
      login_method: "magic_link",
      login_location: "regular_login",
    },
    req,
  );

  assertEquals(result, {
    deviceId: "device-abc",
    deviceLabel: "Front Desk iPad",
    userAgent: "ItemTraxx test agent",
    loginMethod: "magic_link",
    loginLocation: "regular_login",
    generalLocation: "Seattle, Washington",
  });
});

Deno.test("resolveDeviceSessionContext rejects invalid enum values and missing data", () => {
  const req = new Request("https://example.test/admin-ops", { method: "POST" });
  const result = resolveDeviceSessionContext(
    {
      login_method: "sso",
      login_location: "back_door",
    },
    req,
  );

  assertEquals(result, {
    deviceId: null,
    deviceLabel: null,
    userAgent: null,
    loginMethod: null,
    loginLocation: null,
    generalLocation: null,
  });
});

// =====================================================================
// findActiveSession
// =====================================================================

Deno.test("findActiveSession short-circuits when no device id is present", async () => {
  const { client, calls } = makeClient(sequence([]));
  const result = await findActiveSession(
    securityContextFor(client, { deviceSession: baseDeviceSession({ deviceId: null }) }),
  );

  assertEquals(result, { exists: false, relationMissing: false, revoked: false });
  assertEquals(calls.length, 0);
});

Deno.test("findActiveSession reports relationMissing when token-block lookup finds no table", async () => {
  const { client } = makeClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: false, relationMissing: true, revoked: false });
});

Deno.test("findActiveSession reports revoked when the auth token is already blocked", async () => {
  const { client } = makeClient(sequence([{ data: { id: "revoked-row" }, error: null }]));
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: false, relationMissing: false, revoked: true });
});

Deno.test("findActiveSession reports relationMissing when primary lookup table is missing", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null }, // token-block pass
      { data: null, error: RELATION_MISSING_ERROR }, // primary select
    ]),
  );
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: false, relationMissing: true, revoked: false });
});

Deno.test("findActiveSession reports relationMissing when auth-binding column is missing", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: AUTH_BINDING_COLUMN_MISSING_ERROR },
    ]),
  );
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: false, relationMissing: true, revoked: false });
});

Deno.test("findActiveSession throws on unexpected primary lookup errors", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: OTHER_ERROR },
    ]),
  );
  await assertThrowsAsync(
    () => findActiveSession(securityContextFor(client)),
    "Unable to validate admin session.",
  );
});

Deno.test("findActiveSession confirms exists via matching auth_session_id", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      {
        data: { id: "session-1", auth_session_id: "auth-session-1", auth_token_hash: null },
        error: null,
      },
    ]),
  );
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: true, relationMissing: false, revoked: false });
});

Deno.test("findActiveSession confirms exists via legacy auth_token_hash fallback", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      {
        data: {
          id: "session-1",
          auth_session_id: null,
          auth_token_hash: "session:auth-session-1",
        },
        error: null,
      },
    ]),
  );
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: true, relationMissing: false, revoked: false });
});

Deno.test("findActiveSession falls back to revoked lookup when binding does not match", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      {
        data: { id: "session-1", auth_session_id: "other-session", auth_token_hash: "other" },
        error: null,
      },
      { data: { id: "revoked-1" }, error: null },
    ]),
  );
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: false, relationMissing: false, revoked: true });
});

Deno.test("findActiveSession reports no session when revoked lookup finds nothing", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      {
        data: { id: "session-1", auth_session_id: "other-session", auth_token_hash: "other" },
        error: null,
      },
      { data: null, error: null },
    ]),
  );
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: false, relationMissing: false, revoked: false });
});

Deno.test("findActiveSession reports relationMissing when revoked lookup table is missing", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      {
        data: { id: "session-1", auth_session_id: "other-session", auth_token_hash: "other" },
        error: null,
      },
      { data: null, error: RELATION_MISSING_ERROR },
    ]),
  );
  const result = await findActiveSession(securityContextFor(client));

  assertEquals(result, { exists: false, relationMissing: true, revoked: false });
});

Deno.test("findActiveSession throws on unexpected revoked-lookup errors", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      {
        data: { id: "session-1", auth_session_id: "other-session", auth_token_hash: "other" },
        error: null,
      },
      { data: null, error: OTHER_ERROR },
    ]),
  );
  await assertThrowsAsync(
    () => findActiveSession(securityContextFor(client)),
    "Unable to validate admin session.",
  );
});

// =====================================================================
// touchCurrentSession
// =====================================================================

Deno.test("touchCurrentSession short-circuits when no device id is present", async () => {
  const { client, calls } = makeClient(sequence([]));
  const result = await touchCurrentSession(
    securityContextFor(client, { deviceSession: baseDeviceSession({ deviceId: null }) }),
  );

  assertEquals(result, { ok: false, relationMissing: false, reason: "missing_device" });
  assertEquals(calls.length, 0);
});

Deno.test("touchCurrentSession reports relationMissing when the existing-session lookup table is missing", async () => {
  const { client } = makeClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: false, relationMissing: true, reason: "missing_table" });
});

Deno.test("touchCurrentSession throws on unexpected existing-session lookup errors", async () => {
  const { client } = makeClient(sequence([{ data: null, error: OTHER_ERROR }]));
  await assertThrowsAsync(
    () => touchCurrentSession(securityContextFor(client)),
    "Unable to register admin session:",
  );
});

Deno.test("touchCurrentSession reports relationMissing when the auth token block check finds no table", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null }, // existing lookup: none found
      { data: null, error: RELATION_MISSING_ERROR }, // token-block query
    ]),
  );
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: false, relationMissing: true, reason: "missing_table" });
});

Deno.test("touchCurrentSession refuses to touch a session whose token is already revoked", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: { id: "revoked-row" }, error: null },
    ]),
  );
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: false, relationMissing: false, reason: "revoked" });
});

Deno.test("touchCurrentSession inserts a new session row and succeeds", async () => {
  const { client, calls } = makeClient(
    sequence([
      { data: null, error: null }, // no existing row
      { data: null, error: null }, // token-block pass
      { data: [{ id: "new-session" }], error: null }, // insert succeeds
    ]),
  );
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: true, relationMissing: false, reason: "ok" });
  const insertCall = calls.find((call) =>
    call.operations.some((operation) => operation.method === "insert")
  );
  assert(!!insertCall, "expected an insert call");
});

Deno.test("touchCurrentSession reports relationMissing when insert hits a missing table", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: RELATION_MISSING_ERROR },
    ]),
  );
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: false, relationMissing: true, reason: "missing_table" });
});

Deno.test("touchCurrentSession reports relationMissing when insert hits a missing auth-binding column", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: AUTH_BINDING_COLUMN_MISSING_ERROR },
    ]),
  );
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: false, relationMissing: true, reason: "missing_table" });
});

Deno.test("touchCurrentSession retries insert without optional metadata columns", async () => {
  const { client, calls } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: METADATA_COLUMN_MISSING_ERROR }, // first insert fails
      { data: [{ id: "new-session" }], error: null }, // fallback insert succeeds
    ]),
  );
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: true, relationMissing: false, reason: "ok" });
  const insertCalls = calls.filter((call) =>
    call.operations.some((operation) => operation.method === "insert")
  );
  assertEquals(insertCalls.length, 2);
});

Deno.test("touchCurrentSession throws when the fallback insert also fails", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: METADATA_COLUMN_MISSING_ERROR },
      { data: null, error: OTHER_ERROR },
    ]),
  );
  await assertThrowsAsync(
    () => touchCurrentSession(securityContextFor(client)),
    "Unable to register admin session:",
  );
});

Deno.test("touchCurrentSession throws on an unexpected insert error", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: OTHER_ERROR },
    ]),
  );
  await assertThrowsAsync(
    () => touchCurrentSession(securityContextFor(client)),
    "Unable to register admin session:",
  );
});

Deno.test("touchCurrentSession updates an existing session row without metadata columns when unset", async () => {
  const { client, calls } = makeClient(
    sequence([
      { data: { id: "existing-1" }, error: null }, // existing row found
      { data: null, error: null }, // token-block pass
      { data: [{ id: "existing-1" }], error: null }, // update succeeds
    ]),
    { claims: { session_id: "auth-session-1" } },
  );
  const result = await touchCurrentSession(
    securityContextFor(client, {
      deviceSession: baseDeviceSession({
        loginMethod: null,
        loginLocation: null,
        generalLocation: null,
      }),
    }),
  );

  assertEquals(result, { ok: true, relationMissing: false, reason: "ok" });
  const updateCalls = calls.filter((call) =>
    call.operations.some((operation) => operation.method === "update")
  );
  assertEquals(updateCalls.length, 1);
});

Deno.test("touchCurrentSession reports relationMissing when update hits a missing auth-binding column", async () => {
  const { client } = makeClient(
    sequence([
      { data: { id: "existing-1" }, error: null },
      { data: null, error: null },
      { data: null, error: AUTH_BINDING_COLUMN_MISSING_ERROR },
    ]),
  );
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: false, relationMissing: true, reason: "missing_table" });
});

Deno.test("touchCurrentSession retries update without optional metadata columns", async () => {
  const { client, calls } = makeClient(
    sequence([
      { data: { id: "existing-1" }, error: null },
      { data: null, error: null },
      { data: null, error: METADATA_COLUMN_MISSING_ERROR }, // first update fails
      { data: [{ id: "existing-1" }], error: null }, // fallback update succeeds
    ]),
  );
  const result = await touchCurrentSession(securityContextFor(client));

  assertEquals(result, { ok: true, relationMissing: false, reason: "ok" });
  const updateCalls = calls.filter((call) =>
    call.operations.some((operation) => operation.method === "update")
  );
  assertEquals(updateCalls.length, 2);
});

Deno.test("touchCurrentSession throws when the fallback update also fails", async () => {
  const { client } = makeClient(
    sequence([
      { data: { id: "existing-1" }, error: null },
      { data: null, error: null },
      { data: null, error: METADATA_COLUMN_MISSING_ERROR },
      { data: null, error: OTHER_ERROR },
    ]),
  );
  await assertThrowsAsync(
    () => touchCurrentSession(securityContextFor(client)),
    "Unable to update admin session:",
  );
});

Deno.test("touchCurrentSession throws on an unexpected update error", async () => {
  const { client } = makeClient(
    sequence([
      { data: { id: "existing-1" }, error: null },
      { data: null, error: null },
      { data: null, error: OTHER_ERROR },
    ]),
  );
  await assertThrowsAsync(
    () => touchCurrentSession(securityContextFor(client)),
    "Unable to update admin session:",
  );
});

// =====================================================================
// handleSessionAction
// =====================================================================

Deno.test("handleSessionAction touch_session surfaces the missing-setup response", async () => {
  const { client } = makeClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSessionAction(adminOpsContextFor("touch_session", client));

  assertEquals(response.status, 503);
  assertEquals(await responseBody(response), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("handleSessionAction touch_session requires a device session", async () => {
  const { client } = makeClient(sequence([]));
  const response = await handleSessionAction(
    adminOpsContextFor("touch_session", client, {}, {
      deviceSession: baseDeviceSession({ deviceId: null }),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Device session is required." });
});

Deno.test("handleSessionAction touch_session rejects an already-revoked auth token", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: { id: "revoked-row" }, error: null },
    ]),
  );
  const response = await handleSessionAction(adminOpsContextFor("touch_session", client));

  assertEquals(response.status, 401);
  assertEquals(await responseBody(response), { error: "Session revoked" });
});

Deno.test("handleSessionAction touch_session succeeds", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: null },
      { data: [{ id: "new-session" }], error: null },
    ]),
  );
  const response = await handleSessionAction(adminOpsContextFor("touch_session", client));

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { ok: true } });
});

Deno.test("handleSessionAction validate_session requires a device session", async () => {
  const { client, calls } = makeClient(sequence([]));
  const response = await handleSessionAction(
    adminOpsContextFor("validate_session", client, {}, {
      deviceSession: baseDeviceSession({ deviceId: null }),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Device session is required." });
  assertEquals(calls.length, 0);
});

Deno.test("handleSessionAction validate_session surfaces the missing-setup response", async () => {
  const { client } = makeClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSessionAction(adminOpsContextFor("validate_session", client));

  assertEquals(response.status, 503);
  assertEquals(await responseBody(response), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("handleSessionAction validate_session reports invalid when no active session exists", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      { data: null, error: null }, // primary lookup: no match
      { data: null, error: null }, // revoked lookup: nothing found
    ]),
  );
  const response = await handleSessionAction(adminOpsContextFor("validate_session", client));

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { valid: false } });
});

Deno.test("handleSessionAction validate_session confirms and refreshes an active session", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null }, // find: token-block pass
      {
        data: { id: "s1", auth_session_id: "auth-session-1", auth_token_hash: null },
        error: null,
      }, // find: primary match -> exists
      { data: { id: "s1" }, error: null }, // touch: existing lookup
      { data: null, error: null }, // touch: token-block pass
      { data: [{ id: "s1" }], error: null }, // touch: update succeeds
    ]),
  );
  const response = await handleSessionAction(adminOpsContextFor("validate_session", client));

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { valid: true } });
});

Deno.test("handleSessionAction validate_session tolerates a missing session table during the refresh touch", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null },
      {
        data: { id: "s1", auth_session_id: "auth-session-1", auth_token_hash: null },
        error: null,
      },
      { data: null, error: RELATION_MISSING_ERROR }, // touch: existing lookup missing table
    ]),
  );
  const response = await handleSessionAction(adminOpsContextFor("validate_session", client));

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { valid: true } });
});

Deno.test("handleSessionAction validate_session fails closed when the refresh touch is rejected", async () => {
  const { client } = makeClient(
    sequence([
      { data: null, error: null }, // find: token-block pass
      {
        data: { id: "s1", auth_session_id: "auth-session-1", auth_token_hash: null },
        error: null,
      }, // find: primary match -> exists
      { data: { id: "s1" }, error: null }, // touch: existing lookup
      { data: { id: "revoked-row" }, error: null }, // touch: token-block now blocked
    ]),
  );
  const response = await handleSessionAction(adminOpsContextFor("validate_session", client));

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Unable to refresh admin session." });
});

Deno.test("handleSessionAction list_sessions dedupes rows and flags the current device", async () => {
  const rows = [
    {
      id: "session-1",
      device_id: "device-1",
      device_label: "Front Desk",
      user_agent: "ua-1",
      login_method: "password",
      login_location: "admin_login",
      general_location: "Seattle, WA, US",
      created_at: "2026-07-01T00:00:00.000Z",
      last_seen_at: "2026-07-02T00:00:00.000Z",
    },
    {
      id: "session-1-dup",
      device_id: "device-1",
      device_label: "Front Desk (dup)",
      user_agent: "ua-1",
      created_at: "2026-06-01T00:00:00.000Z",
      last_seen_at: "2026-06-02T00:00:00.000Z",
    },
    {
      id: "session-2",
      device_id: "device-2",
      device_label: "Back Office",
      user_agent: "ua-2",
      created_at: "2026-07-01T00:00:00.000Z",
      last_seen_at: "2026-07-01T00:00:00.000Z",
    },
  ];
  const { client } = makeClient(sequence([{ data: rows, error: null }]));
  const response = await handleSessionAction(adminOpsContextFor("list_sessions", client));

  assertEquals(response.status, 200);
  const body = await responseBody(response);
  const sessions = (body.data as { sessions: Array<Record<string, unknown>> }).sessions;
  assertEquals(sessions.length, 2);
  assertEquals(sessions[0].id, "session-1");
  assertEquals(sessions[0].is_current, true);
  assertEquals(sessions[1].id, "session-2");
  assertEquals(sessions[1].is_current, false);
});

Deno.test("handleSessionAction list_sessions retries without optional metadata columns", async () => {
  const { client, calls } = makeClient(
    sequence([
      { data: null, error: METADATA_COLUMN_MISSING_ERROR },
      {
        data: [{
          id: "session-1",
          device_id: "device-1",
          device_label: "Front Desk",
          user_agent: "ua-1",
          created_at: "2026-07-01T00:00:00.000Z",
          last_seen_at: "2026-07-02T00:00:00.000Z",
        }],
        error: null,
      },
    ]),
  );
  const response = await handleSessionAction(adminOpsContextFor("list_sessions", client));

  assertEquals(response.status, 200);
  const body = await responseBody(response);
  const sessions = (body.data as { sessions: Array<Record<string, unknown>> }).sessions;
  assertEquals(sessions[0].login_method, null);
  assertEquals(
    calls.filter((call) => call.operations.some((op) => op.method === "select")).length,
    2,
  );
});

Deno.test("handleSessionAction list_sessions surfaces the missing-setup response", async () => {
  const { client } = makeClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSessionAction(adminOpsContextFor("list_sessions", client));

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("handleSessionAction list_sessions reports a generic failure for other errors", async () => {
  const { client } = makeClient(sequence([{ data: null, error: OTHER_ERROR }]));
  const response = await handleSessionAction(adminOpsContextFor("list_sessions", client));

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Unable to load active devices." });
});

Deno.test("handleSessionAction revoke_session requires a session id", async () => {
  const { client, calls } = makeClient(sequence([]));
  const response = await handleSessionAction(adminOpsContextFor("revoke_session", client, {}));

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Session id is required." });
  assertEquals(calls.length, 0);
});

Deno.test("handleSessionAction revoke_session surfaces the missing-setup response", async () => {
  const { client } = makeClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_session", client, { session_id: "session-1" }),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("handleSessionAction revoke_session reports a generic failure for other errors", async () => {
  const { client } = makeClient(sequence([{ data: null, error: OTHER_ERROR }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_session", client, { session_id: "session-1" }),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Unable to revoke session." });
});

Deno.test("handleSessionAction revoke_session reports not-found when nothing matched", async () => {
  const { client } = makeClient(sequence([{ data: [], error: null }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_session", client, { session_id: "session-1" }),
  );

  assertEquals(response.status, 404);
  assertEquals(await responseBody(response), { error: "Session not found." });
});

Deno.test("handleSessionAction revoke_session succeeds", async () => {
  const { client } = makeClient(sequence([{ data: [{ id: "session-1" }], error: null }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_session", client, { session_id: "session-1" }),
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { revoked: true } });
});

Deno.test("handleSessionAction revoke_current_session refuses when there is no session binding at all", async () => {
  const { client, calls } = makeClient(sequence([]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_current_session", client, {}, {
      authSessionBinding: { sessionId: null, issuedAt: null },
      deviceSession: baseDeviceSession({ deviceId: null }),
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(await responseBody(response), { error: "Session binding unavailable." });
  assertEquals(calls.length, 0);
});

Deno.test("handleSessionAction revoke_current_session uses the auth session binding when available", async () => {
  const { client, calls } = makeClient(sequence([{ data: [{ id: "session-1" }], error: null }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_current_session", client),
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { revoked: true } });
  assert(
    calls.some((call) =>
      call.operations.some((op) =>
        op.method === "eq" && op.args[0] === "auth_session_id" && op.args[1] === "auth-session-1"
      )
    ),
    "expected the query to be scoped by auth_session_id",
  );
});

Deno.test("handleSessionAction revoke_current_session falls back to the device id when there is no auth session binding", async () => {
  const { client, calls } = makeClient(sequence([{ data: [{ id: "session-1" }], error: null }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_current_session", client, {}, {
      authSessionBinding: { sessionId: null, issuedAt: null },
    }),
  );

  assertEquals(response.status, 200);
  assert(
    calls.some((call) =>
      call.operations.some((op) =>
        op.method === "eq" && op.args[0] === "device_id" && op.args[1] === "device-1"
      )
    ),
    "expected the query to be scoped by device_id",
  );
});

Deno.test("handleSessionAction revoke_current_session reports a generic failure on error", async () => {
  const { client } = makeClient(sequence([{ data: null, error: OTHER_ERROR }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_current_session", client),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Unable to revoke session." });
});

Deno.test("handleSessionAction revoke_all_sessions preserves the other-devices default and counts revocations", async () => {
  const { client, calls } = makeClient(
    sequence([{ data: [{ id: "session-1" }, { id: "session-2" }], error: null }]),
  );
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_all_sessions", client, {}),
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { revoked: 2 } });
  assert(
    calls.some((call) =>
      call.operations.some((op) =>
        op.method === "neq" && op.args[0] === "device_id" && op.args[1] === "device-1"
      )
    ),
    "expected the current device to be excluded by default",
  );
});

Deno.test("handleSessionAction revoke_all_sessions includes the current device when sign_out_current is set", async () => {
  const { client, calls } = makeClient(sequence([{ data: [{ id: "session-1" }], error: null }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_all_sessions", client, { sign_out_current: true }),
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { revoked: 1 } });
  assert(
    !calls.some((call) => call.operations.some((op) => op.method === "neq")),
    "expected no device exclusion when signing out the current device too",
  );
});

Deno.test("handleSessionAction revoke_all_sessions surfaces the missing-setup response", async () => {
  const { client } = makeClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_all_sessions", client, {}),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("handleSessionAction revoke_all_sessions reports a generic failure for other errors", async () => {
  const { client } = makeClient(sequence([{ data: null, error: OTHER_ERROR }]));
  const response = await handleSessionAction(
    adminOpsContextFor("revoke_all_sessions", client, {}),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Unable to revoke sessions." });
});
