import {
  handleSecuritySessionsAction,
  SECURITY_SESSION_ACTIONS,
} from "./securitySessions.ts";
import type { SuperOpsContext } from "../context.ts";

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

// --- mock Supabase admin client ---
type QueryCall = { table: string; operations: Array<{ method: string; args: unknown[] }> };
type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};

const makeAdminClient = (
  respond: (call: QueryCall) => QueryResult | Promise<QueryResult>,
  options: {
    claims?: Record<string, unknown> | null;
    claimsError?: unknown;
    passkeys?: { data: unknown; error: { message?: string } | null };
  } = {},
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
            data: options.claims === null
              ? null
              : { claims: options.claims ?? { session_id: "auth-session-1", iat: 1_700_000_000 } },
            error: options.claimsError ?? null,
          }),
        admin: {
          passkey: {
            listPasskeys: () =>
              Promise.resolve(options.passkeys ?? { data: [], error: null }),
            deletePasskey: () => Promise.resolve({ data: null, error: null }),
          },
        },
      },
    } as unknown as SuperOpsContext["adminClient"],
    calls,
  };
};

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
  message: 'relation "super_admin_sessions" does not exist',
};
const METADATA_COLUMN_MISSING_ERROR = {
  code: "42703",
  message: 'column "login_method" does not exist',
};
const OTHER_ERROR = { code: "53300", message: "too many connections" };

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const contextFor = (
  action: string,
  payload: Record<string, unknown>,
  adminClient: SuperOpsContext["adminClient"],
  overrides: Partial<SuperOpsContext> = {},
): SuperOpsContext => ({
  req: new Request("https://example.test/functions/v1/super-ops", { method: "POST" }),
  action,
  payload,
  adminClient,
  user: { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.test" },
  profile: { auth_email: "admin@example.test" },
  accessToken: "test-access-token",
  supabaseUrl: "https://example.test",
  publishableKey: "test-publishable-key",
  jsonResponse,
  writeAudit: async () => {},
  ...overrides,
});

const responseBody = (response: Response) =>
  response.json() as Promise<Record<string, unknown>>;

const withMockedAuthFetch = async (
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<void>,
) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.includes("/auth/v1/token")) {
      return handler(url, init);
    }
    return original(input as Parameters<typeof fetch>[0], init);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

const withMockedPasskeyFetch = async (
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<void>,
) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.includes("/auth/v1/passkeys/")) {
      return handler(url, init);
    }
    return original(input as Parameters<typeof fetch>[0], init);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

const signInSuccessResponse = (userId: string) =>
  new Response(
    JSON.stringify({
      access_token: "test-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "test-refresh-token",
      user: { id: userId, aud: "authenticated", email: "admin@example.test" },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const signInErrorResponse = () =>
  new Response(
    JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );

Deno.test("securitySessions registry owns exactly the 9 live actions", () => {
  assertEquals(SECURITY_SESSION_ACTIONS.length, 9);
  assertEquals(new Set(SECURITY_SESSION_ACTIONS).size, 9);
});

Deno.test("handleSecuritySessionsAction returns null for actions it does not own", async () => {
  const { client } = makeAdminClient(sequence([]));
  const response = await handleSecuritySessionsAction(
    contextFor("not_a_live_action", {}, client),
  );
  assertEquals(response, null);
});

// =====================================================================
// verify_password
// =====================================================================

Deno.test("verify_password requires a password", async () => {
  const { client, calls } = makeAdminClient(sequence([]));
  const response = await handleSecuritySessionsAction(
    contextFor("verify_password", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Password is required." });
  assertEquals(calls.length, 0);
});

Deno.test("verify_password requires a resolvable email", async () => {
  const { client } = makeAdminClient(sequence([]));
  const response = await handleSecuritySessionsAction(
    contextFor("verify_password", { password: "secret" }, client, {
      profile: { auth_email: null },
      user: { id: "00000000-0000-4000-8000-000000000001", email: null },
    }),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Password is required." });
});

Deno.test("verify_password requires a configured publishable key", async () => {
  const { client } = makeAdminClient(sequence([]));
  const response = await handleSecuritySessionsAction(
    contextFor("verify_password", { password: "secret" }, client, { publishableKey: null }),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 500);
  assertEquals(await responseBody(response!), { error: "Server misconfiguration" });
});

Deno.test("verify_password rejects invalid credentials from the auth provider", async () => {
  await withMockedAuthFetch(
    () => signInErrorResponse(),
    async () => {
      const { client } = makeAdminClient(sequence([]));
      const response = await handleSecuritySessionsAction(
        contextFor("verify_password", { password: "wrong" }, client),
      );

      assert(response !== null, "expected a response");
      assertEquals(response!.status, 401);
      assertEquals(await responseBody(response!), { error: "Invalid password." });
    },
  );
});

Deno.test("verify_password rejects a sign-in that resolves to a different user", async () => {
  await withMockedAuthFetch(
    () => signInSuccessResponse("00000000-0000-4000-8000-000000000099"),
    async () => {
      const { client } = makeAdminClient(sequence([]));
      const response = await handleSecuritySessionsAction(
        contextFor("verify_password", { password: "secret" }, client),
      );

      assert(response !== null, "expected a response");
      assertEquals(response!.status, 401);
      assertEquals(await responseBody(response!), { error: "Invalid password." });
    },
  );
});

Deno.test("verify_password succeeds and records an audit entry", async () => {
  await withMockedAuthFetch(
    () => signInSuccessResponse("00000000-0000-4000-8000-000000000001"),
    async () => {
      const { client } = makeAdminClient(sequence([]));
      const auditCalls: unknown[][] = [];
      const response = await handleSecuritySessionsAction(
        contextFor("verify_password", { password: "secret" }, client, {
          writeAudit: async (...args) => {
            auditCalls.push(args);
          },
        }),
      );

      assert(response !== null, "expected a response");
      assertEquals(response!.status, 200);
      assertEquals(await responseBody(response!), { data: { verified: true } });
      assertEquals(auditCalls, [[
        "super_admin_settings_password_verified",
        "super_admin_auth",
        "00000000-0000-4000-8000-000000000001",
        {},
      ]]);
    },
  );
});

Deno.test("start_passkey_registration proxies the server-side ceremony", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  await withMockedPasskeyFetch(
    (url, init) => {
      requestUrl = url;
      requestInit = init;
      return new Response(
        JSON.stringify({
          challenge_id: "challenge-1",
          options: { challenge: "abc", user: { id: "user" } },
          expires_at: 123,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    async () => {
      const { client } = makeAdminClient(sequence([]));
      const auditCalls: unknown[][] = [];
      const response = await handleSecuritySessionsAction(
        contextFor("start_passkey_registration", {}, client, {
          writeAudit: async (...args) => {
            auditCalls.push(args);
          },
        }),
      );

      assert(response !== null, "expected a response");
      assertEquals(response!.status, 200);
      assertEquals(await responseBody(response!), {
        data: {
          challenge_id: "challenge-1",
          options: { challenge: "abc", user: { id: "user" } },
          expires_at: 123,
        },
      });
      assertEquals(requestUrl, "https://example.test/auth/v1/passkeys/registration/options");
      assertEquals(requestInit?.method, "POST");
      assertEquals(JSON.parse(String(requestInit?.body)), {});
      assertEquals(auditCalls[0]?.[0], "super_admin_passkey_registration_started");
    },
  );
});

Deno.test("verify_passkey_registration proxies the credential and audits success", async () => {
  let requestBody: Record<string, unknown> | null = null;
  await withMockedPasskeyFetch(
    (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ id: "passkey-1", created_at: "2026-01-01T00:00:00Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    async () => {
      const { client } = makeAdminClient(sequence([]));
      const auditCalls: unknown[][] = [];
      const credential = { id: "credential-1", response: { clientDataJSON: "abc" } };
      const response = await handleSecuritySessionsAction(
        contextFor("verify_passkey_registration", {
          challenge_id: "challenge-1",
          credential,
        }, client, {
          writeAudit: async (...args) => {
            auditCalls.push(args);
          },
        }),
      );

      assert(response !== null, "expected a response");
      assertEquals(response!.status, 200);
      assertEquals(await responseBody(response!), {
        data: { id: "passkey-1", created_at: "2026-01-01T00:00:00Z" },
      });
      assertEquals(requestBody, {
        challenge_id: "challenge-1",
        credential,
      });
      assertEquals(auditCalls[0]?.[0], "super_admin_passkey_registered");
    },
  );
});

// =====================================================================
// touch_session
// =====================================================================

Deno.test("touch_session requires a device id", async () => {
  const { client, calls } = makeAdminClient(sequence([]));
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Device session is required." });
  assertEquals(calls.length, 0);
});

Deno.test("touch_session rejects when the JWT claims cannot be resolved", async () => {
  const { client } = makeAdminClient(sequence([]), { claimsError: new Error("bad token") });
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", { device_id: "device-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 401);
  assertEquals(await responseBody(response!), { error: "Unauthorized" });
});

Deno.test("touch_session surfaces the missing-setup response on the existing-session lookup", async () => {
  const { client } = makeAdminClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", { device_id: "device-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("touch_session reports a generic failure for other existing-session lookup errors", async () => {
  const { client } = makeAdminClient(sequence([{ data: null, error: OTHER_ERROR }]));
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", { device_id: "device-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to update session." });
});

Deno.test("touch_session updates an existing row and falls back to the JWT sign-in method", async () => {
  const { client, calls } = makeAdminClient(
    sequence([
      { data: { id: "session-1" }, error: null },
      { data: null, error: null },
    ]),
    { claims: { session_id: "auth-session-1", iat: 1_700_000_000, amr: [{ method: "password" }] } },
  );
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", {
      device_id: "device-1",
      device_label: "Mac",
      login_location: "super_settings",
    }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: { ok: true } });
  const updateCall = calls.find((call) =>
    call.operations.some((op) => op.method === "update")
  );
  assert(!!updateCall, "expected an update call");
  const updatePayload = updateCall!.operations.find((op) => op.method === "update")!
    .args[0] as Record<string, unknown>;
  assertEquals(updatePayload.login_method, "password");
  assertEquals(updatePayload.login_location, "super_settings");
});

Deno.test("touch_session reports a generic failure when the update fails", async () => {
  const { client } = makeAdminClient(
    sequence([
      { data: { id: "session-1" }, error: null },
      { data: null, error: OTHER_ERROR },
    ]),
  );
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", { device_id: "device-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to update session." });
});

Deno.test("touch_session creates a new row when none exists, preferring the explicit login method", async () => {
  const { client, calls } = makeAdminClient(
    sequence([
      { data: null, error: null },
      { data: null, error: null },
    ]),
  );
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", {
      device_id: "device-1",
      login_method: "passkey",
      login_location: "super_auth",
    }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: { ok: true } });
  const insertCall = calls.find((call) =>
    call.operations.some((op) => op.method === "insert")
  );
  assert(!!insertCall, "expected an insert call");
  const insertPayload = insertCall!.operations.find((op) => op.method === "insert")!
    .args[0] as Record<string, unknown>;
  assertEquals(insertPayload.login_method, "passkey");
  assertEquals(insertPayload.login_location, "super_auth");
});

Deno.test("touch_session surfaces the missing-setup response on insert", async () => {
  const { client } = makeAdminClient(
    sequence([
      { data: null, error: null },
      { data: null, error: RELATION_MISSING_ERROR },
    ]),
  );
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", { device_id: "device-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("touch_session reports a generic failure when the insert fails", async () => {
  const { client } = makeAdminClient(
    sequence([
      { data: null, error: null },
      { data: null, error: OTHER_ERROR },
    ]),
  );
  const response = await handleSecuritySessionsAction(
    contextFor("touch_session", { device_id: "device-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to create session." });
});

// =====================================================================
// list_sessions
// =====================================================================

Deno.test("list_sessions maps rows and flags the current device", async () => {
  const rows = [
    {
      id: "session-1",
      device_id: "device-1",
      device_label: "Front Desk",
      user_agent: "ua-1",
      login_method: "password",
      login_location: "super_auth",
      general_location: "Seattle, WA, US",
      created_at: "2026-07-01T00:00:00.000Z",
      last_seen_at: "2026-07-02T00:00:00.000Z",
    },
    {
      id: "session-2",
      device_id: "device-2",
      // Missing optional metadata fields to exercise the safe-coercion paths.
      created_at: "2026-07-01T00:00:00.000Z",
      last_seen_at: "2026-07-01T00:00:00.000Z",
    },
  ];
  const { client } = makeAdminClient(sequence([{ data: rows, error: null }]));
  const response = await handleSecuritySessionsAction(
    contextFor("list_sessions", { device_id: "device-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  const body = await responseBody(response!);
  const sessions = (body.data as { sessions: Array<Record<string, unknown>> }).sessions;
  assertEquals(sessions.length, 2);
  assertEquals(sessions[0].is_current, true);
  assertEquals(sessions[1].is_current, false);
  assertEquals(sessions[1].device_label, null);
  assertEquals(sessions[1].login_method, null);
});

Deno.test("list_sessions retries without the login_method column", async () => {
  const { client, calls } = makeAdminClient(
    sequence([
      { data: null, error: METADATA_COLUMN_MISSING_ERROR },
      {
        data: [{
          id: "session-1",
          device_id: "device-1",
          created_at: "2026-07-01T00:00:00.000Z",
          last_seen_at: "2026-07-02T00:00:00.000Z",
        }],
        error: null,
      },
    ]),
  );
  const response = await handleSecuritySessionsAction(
    contextFor("list_sessions", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  assertEquals(
    calls.filter((call) => call.operations.some((op) => op.method === "select")).length,
    2,
  );
});

Deno.test("list_sessions surfaces the missing-setup response", async () => {
  const { client } = makeAdminClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSecuritySessionsAction(
    contextFor("list_sessions", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("list_sessions reports a generic failure for other errors", async () => {
  const { client } = makeAdminClient(sequence([{ data: null, error: OTHER_ERROR }]));
  const response = await handleSecuritySessionsAction(
    contextFor("list_sessions", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to load active sessions." });
});

// =====================================================================
// list_passkeys
// =====================================================================

Deno.test("list_passkeys returns only the safe passkey fields", async () => {
  const { client } = makeAdminClient(sequence([]), {
    passkeys: {
      data: [{
        id: "passkey-1",
        created_at: "2026-07-01T00:00:00.000Z",
        last_used_at: "2026-07-02T00:00:00.000Z",
        credential: "must-not-be-returned",
      }],
      error: null,
    },
  });
  const response = await handleSecuritySessionsAction(
    contextFor("list_passkeys", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), {
    data: {
      passkeys: [{
        id: "passkey-1",
        created_at: "2026-07-01T00:00:00.000Z",
        last_used_at: "2026-07-02T00:00:00.000Z",
      }],
    },
  });
});

Deno.test("list_passkeys reports a generic failure on error", async () => {
  const { client } = makeAdminClient(sequence([]), {
    passkeys: { data: null, error: { message: "boom" } },
  });
  const response = await handleSecuritySessionsAction(
    contextFor("list_passkeys", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to load passkeys." });
});

Deno.test("delete_passkey deletes only through the server admin API", async () => {
  const { client } = makeAdminClient(sequence([]));
  const auditCalls: unknown[][] = [];
  const response = await handleSecuritySessionsAction(
    contextFor("delete_passkey", { passkey_id: "passkey-1" }, client, {
      writeAudit: async (...args) => {
        auditCalls.push(args);
      },
    }),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: { deleted: true } });
  assertEquals(auditCalls, [[
    "super_admin_passkey_deleted",
    "super_admin_auth",
    "00000000-0000-4000-8000-000000000001",
    { passkey_id: "passkey-1" },
  ]]);
});

// =====================================================================
// revoke_session
// =====================================================================

Deno.test("revoke_session requires a session id", async () => {
  const { client } = makeAdminClient(sequence([]));
  await assertThrowsAsync(
    () => handleSecuritySessionsAction(contextFor("revoke_session", {}, client)) as Promise<unknown>,
    "Invalid request",
  );
});

Deno.test("revoke_session surfaces the missing-setup response", async () => {
  const { client } = makeAdminClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSecuritySessionsAction(
    contextFor("revoke_session", { session_id: "session-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("revoke_session reports a generic failure for other errors", async () => {
  const { client } = makeAdminClient(sequence([{ data: null, error: OTHER_ERROR }]));
  const response = await handleSecuritySessionsAction(
    contextFor("revoke_session", { session_id: "session-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to revoke session." });
});

Deno.test("revoke_session reports not-found when nothing matched", async () => {
  const { client } = makeAdminClient(sequence([{ data: [], error: null }]));
  const response = await handleSecuritySessionsAction(
    contextFor("revoke_session", { session_id: "session-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 404);
  assertEquals(await responseBody(response!), { error: "Session not found." });
});

Deno.test("revoke_session succeeds", async () => {
  const { client } = makeAdminClient(sequence([{ data: [{ id: "session-1" }], error: null }]));
  const response = await handleSecuritySessionsAction(
    contextFor("revoke_session", { session_id: "session-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: { revoked: true } });
});

// =====================================================================
// revoke_all_sessions
// =====================================================================

Deno.test("revoke_all_sessions excludes the current device by default", async () => {
  const { client, calls } = makeAdminClient(
    sequence([{ data: [{ id: "session-1" }, { id: "session-2" }], error: null }]),
  );
  const response = await handleSecuritySessionsAction(
    contextFor("revoke_all_sessions", { device_id: "device-1" }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: { revoked: 2 } });
  assert(
    calls.some((call) =>
      call.operations.some((op) =>
        op.method === "neq" && op.args[0] === "device_id" && op.args[1] === "device-1"
      )
    ),
    "expected the current device to be excluded",
  );
});

Deno.test("revoke_all_sessions signs out every device including the current one when requested", async () => {
  const { client, calls } = makeAdminClient(sequence([{ data: [{ id: "session-1" }], error: null }]));
  const response = await handleSecuritySessionsAction(
    contextFor("revoke_all_sessions", { device_id: "device-1", sign_out_current: true }, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: { revoked: 1 } });
  assert(
    !calls.some((call) => call.operations.some((op) => op.method === "neq")),
    "expected no device exclusion when signing out every device",
  );
});

Deno.test("revoke_all_sessions surfaces the missing-setup response", async () => {
  const { client } = makeAdminClient(sequence([{ data: null, error: RELATION_MISSING_ERROR }]));
  const response = await handleSecuritySessionsAction(
    contextFor("revoke_all_sessions", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("revoke_all_sessions reports a generic failure for other errors", async () => {
  const { client } = makeAdminClient(sequence([{ data: null, error: OTHER_ERROR }]));
  const response = await handleSecuritySessionsAction(
    contextFor("revoke_all_sessions", {}, client),
  );

  assert(response !== null, "expected a response");
  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to revoke sessions." });
});
