import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  ADMIN_OPS_ACTION_OWNERS,
  ADMIN_OPS_ACTIONS,
  authorizeAdminOpsAction,
  dispatchAdminOpsAction,
} from "./actions/index.ts";
import { resolveTenantPolicyState } from "./actions/settings.ts";
import type {
  AdminOpsContext,
  JsonResponse,
  SupabaseClient,
} from "./context.ts";

const EXPECTED_ACTIONS = [
  "get_notifications",
  "get_tenant_settings",
  "update_tenant_settings",
  "get_status_tracking",
  "touch_session",
  "validate_session",
  "list_sessions",
  "revoke_session",
  "revoke_current_session",
  "revoke_all_sessions",
  "bulk_import_gear",
] as const;

const jsonResponse: JsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type QueryCall = {
  table: string;
  operations: Array<{ method: string; args: unknown[] }>;
};

type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
};

const queryClient = (
  respond: (call: QueryCall) => QueryResult | Promise<QueryResult>,
  options: {
    claims?: Record<string, unknown> | null;
    claimsError?: unknown;
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
              claims: options.claims ??
                { session_id: "auth-session-1", iat: 1_700_000_000 },
            },
            error: options.claimsError ?? null,
          }),
      },
    } as unknown as SupabaseClient,
    calls,
  };
};

const contextFor = (
  action: string,
  adminClient: SupabaseClient,
  payload: Record<string, unknown> = {},
  overrides: Partial<AdminOpsContext> = {},
): AdminOpsContext => ({
  req: new Request("https://example.test/functions/v1/admin-ops", {
    method: "POST",
    headers: { "user-agent": "ItemTraxx test" },
  }),
  requestId: "request-1",
  action,
  payload,
  adminClient,
  user: { id: "00000000-0000-4000-8000-000000000001" },
  profile: { role: "tenant_admin" },
  tenantId: "00000000-0000-4000-8000-000000000002",
  isTenantSuspended: false,
  authToken: "test-auth-token",
  authSessionBinding: {
    sessionId: "auth-session-1",
    issuedAt: "2023-11-14T22:13:20.000Z",
  },
  authTokenBindingKey: "session:auth-session-1",
  deviceSession: {
    deviceId: "device-1",
    deviceLabel: "Test laptop",
    userAgent: "ItemTraxx test",
    loginMethod: "password",
    loginLocation: "admin_login",
    generalLocation: "Seattle, WA, US",
  },
  tenantPolicy: null,
  checkoutDueHours: 72,
  featureFlags: {
    enable_notifications: true,
    enable_bulk_item_import: true,
    enable_bulk_student_tools: true,
    enable_status_tracking: true,
    enable_barcode_generator: true,
  },
  maintenance: { enabled: false, message: "" },
  tenantUpdates: [],
  jsonResponse,
  ...overrides,
});

const responseBody = (response: Response) =>
  response.json() as Promise<Record<string, unknown>>;

Deno.test("admin ops registry owns exactly the 11 live actions once", () => {
  assertEquals(ADMIN_OPS_ACTIONS.length, 11);
  assertEquals(new Set(ADMIN_OPS_ACTIONS).size, 11);
  assertEquals([...ADMIN_OPS_ACTIONS].sort(), [...EXPECTED_ACTIONS].sort());
  assertEquals(
    Object.keys(ADMIN_OPS_ACTION_OWNERS).sort(),
    [...EXPECTED_ACTIONS].sort(),
  );
});

Deno.test("admin ops dispatcher preserves the invalid-action response", async () => {
  const { client } = queryClient(() => ({ data: null, error: null }));
  const response = await dispatchAdminOpsAction(
    contextFor("not_a_live_action", client),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "Invalid action" });
});

Deno.test("tenant users remain denied from tenant-admin-only actions", async () => {
  const { client } = queryClient(() => ({ data: null, error: null }));
  const response = await authorizeAdminOpsAction({
    action: "get_status_tracking",
    profileRole: "tenant_user",
    isTenantSuspended: false,
    adminClient: client,
    userId: "user-1",
    authToken: "token-1",
    jsonResponse,
  });

  assertExists(response);
  assertEquals(response.status, 403);
  assertEquals(await responseBody(response), { error: "Access denied" });
});

Deno.test("suspended tenants remain denied from write actions", async () => {
  const { client } = queryClient(() => ({ data: null, error: null }));
  const response = await authorizeAdminOpsAction({
    action: "bulk_import_gear",
    profileRole: "tenant_admin",
    isTenantSuspended: true,
    adminClient: client,
    userId: "user-1",
    authToken: "token-1",
    jsonResponse,
  });

  assertExists(response);
  assertEquals(response.status, 403);
  assertEquals(await responseBody(response), { error: "Tenant disabled" });
});

Deno.test("missing privileged-step-up storage remains a fail-closed 503", async () => {
  const { client } = queryClient((call) => {
    if (call.table === "privileged_session_stepups") {
      return {
        data: null,
        error: {
          code: "42P01",
          message: 'relation "privileged_session_stepups" does not exist',
        },
      };
    }
    return { data: null, error: null };
  });
  const response = await authorizeAdminOpsAction({
    action: "update_tenant_settings",
    profileRole: "tenant_admin",
    isTenantSuspended: false,
    adminClient: client,
    userId: "user-1",
    authToken: "token-1",
    jsonResponse,
  });

  assertExists(response);
  assertEquals(response.status, 503);
  assertEquals(await responseBody(response), {
    error:
      "Privileged verification controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("touch_session rejects a blocked auth token", async () => {
  const { client } = queryClient(
    () => ({ data: null, error: null }),
    { claims: null, claimsError: new Error("claims unavailable") },
  );
  const response = await dispatchAdminOpsAction(
    contextFor("touch_session", client),
  );

  assertEquals(response.status, 401);
  assertEquals(await responseBody(response), { error: "Session revoked" });
});

Deno.test("touch_session preserves the missing-session-table fallback", async () => {
  const { client } = queryClient((call) => {
    if (call.table === "tenant_admin_sessions") {
      return {
        data: null,
        error: {
          code: "42P01",
          message: 'relation "tenant_admin_sessions" does not exist',
        },
      };
    }
    return { data: null, error: null };
  });
  const response = await dispatchAdminOpsAction(
    contextFor("touch_session", client),
  );

  assertEquals(response.status, 503);
  assertEquals(await responseBody(response), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("touch_session fails closed when auth-binding columns are missing", async () => {
  let tenantSessionCall = 0;
  const { client } = queryClient((call) => {
    if (call.table !== "tenant_admin_sessions") {
      return { data: null, error: null };
    }
    tenantSessionCall += 1;
    if (tenantSessionCall <= 2) return { data: null, error: null };
    return {
      data: null,
      error: {
        code: "42703",
        message: 'column "auth_session_id" does not exist',
      },
    };
  });
  const response = await dispatchAdminOpsAction(
    contextFor("touch_session", client),
  );

  assertEquals(response.status, 503);
  assertEquals(await responseBody(response), {
    error: "Session controls unavailable. Run latest SQL setup.",
  });
});

Deno.test("touch_session retries without optional metadata columns", async () => {
  let updateCalls = 0;
  const { client, calls } = queryClient((call) => {
    if (call.table !== "tenant_admin_sessions") {
      return { data: null, error: null };
    }
    const update = call.operations.find((operation) =>
      operation.method === "update"
    );
    if (update) {
      updateCalls += 1;
      return updateCalls === 1
        ? {
          data: null,
          error: {
            code: "42703",
            message: 'column "login_method" does not exist',
          },
        }
        : { data: null, error: null };
    }
    const selected = call.operations.find((operation) =>
      operation.method === "select"
    );
    if (selected?.args[0] === "id") {
      return { data: { id: "session-1" }, error: null };
    }
    return { data: null, error: null };
  });
  const response = await dispatchAdminOpsAction(
    contextFor("touch_session", client),
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { ok: true } });
  assertEquals(updateCalls, 2);
  assertEquals(
    calls.filter((call) =>
      call.operations.some((operation) => operation.method === "update")
    ).length,
    2,
  );
});

Deno.test("revoke_session preserves successful scoped revocation", async () => {
  const { client } = queryClient(() => ({
    data: [{ id: "session-2" }],
    error: null,
  }));
  const response = await dispatchAdminOpsAction(
    contextFor("revoke_session", client, { session_id: "session-2" }),
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { revoked: true } });
});

Deno.test("revoke_current_session remains bound to the current auth session", async () => {
  const { client, calls } = queryClient(() => ({
    data: [{ id: "session-1" }],
    error: null,
  }));
  const response = await dispatchAdminOpsAction(
    contextFor("revoke_current_session", client),
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { revoked: true } });
  assertEquals(
    calls.some((call) =>
      call.operations.some((operation) =>
        operation.method === "eq" &&
        operation.args[0] === "auth_session_id" &&
        operation.args[1] === "auth-session-1"
      )
    ),
    true,
  );
});

Deno.test("revoke_all_sessions preserves the revoked-row count", async () => {
  const { client } = queryClient(() => ({
    data: [{ id: "session-1" }, { id: "session-2" }],
    error: null,
  }));
  const response = await dispatchAdminOpsAction(
    contextFor("revoke_all_sessions", client, { sign_out_current: true }),
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { data: { revoked: 2 } });
});

Deno.test("tenant policy resolution retries when feature_flags is missing", async () => {
  let policyQueries = 0;
  const { client, calls } = queryClient((call) => {
    if (call.table !== "tenant_policies") return { data: null, error: null };
    policyQueries += 1;
    return policyQueries === 1
      ? {
        data: null,
        error: {
          code: "42703",
          message: 'column "feature_flags" does not exist',
        },
      }
      : {
        data: {
          checkout_due_hours: 48,
          account_category: "organization",
          plan_code: "growth",
        },
        error: null,
      };
  });
  const resolved = await resolveTenantPolicyState(client, "tenant-1");

  assertEquals(resolved.checkoutDueHours, 48);
  assertEquals(resolved.featureFlags.enable_notifications, true);
  assertEquals(policyQueries, 2);
  assertEquals(
    calls.map((call) => call.operations[0]?.args[0]),
    [
      "checkout_due_hours, account_category, plan_code, feature_flags",
      "checkout_due_hours, account_category, plan_code",
    ],
  );
});

Deno.test("bulk_import_gear preserves the 1000-row hard limit", async () => {
  const { client, calls } = queryClient(() => ({ data: null, error: null }));
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    name: `Item ${index}`,
    barcode: `ITEM-${index}`,
  }));
  const response = await dispatchAdminOpsAction(
    contextFor("bulk_import_gear", client, { rows }),
  );

  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), {
    error: "Provide between 1 and 1000 rows.",
  });
  assertEquals(calls.length, 0);
});
