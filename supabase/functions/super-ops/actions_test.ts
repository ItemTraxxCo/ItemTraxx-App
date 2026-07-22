import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { dispatchSuperOpsAction, SUPER_OPS_ACTIONS } from "./actions/index.ts";
import { CONTROL_CENTER_ACTIONS } from "./actions/controlCenter.ts";
import { INTERNAL_OPS_ACTIONS } from "./actions/internalOps.ts";
import { SALES_CUSTOMER_ACTIONS } from "./actions/salesCustomers.ts";
import { SECURITY_SESSION_ACTIONS } from "./actions/securitySessions.ts";
import { SUPPORT_ACTIONS } from "./actions/support.ts";
import { SUBPROCESSOR_ACTIONS } from "./actions/subprocessors.ts";
import type { SuperOpsContext } from "./context.ts";

const EXPECTED_ACTIONS = [
  "verify_password",
  "touch_session",
  "list_sessions",
  "list_passkeys",
  "revoke_session",
  "revoke_all_sessions",
  "get_control_center",
  "set_runtime_config",
  "upsert_alert_rule",
  "set_tenant_policy",
  "set_tenant_force_reauth",
  "create_approval",
  "approve_request",
  "list_support_requests",
  "get_support_request",
  "update_support_request",
  "list_sales_leads",
  "close_sales_lead",
  "move_sales_lead_to_customer",
  "set_sales_lead_stage",
  "delete_sales_lead",
  "list_customers",
  "add_customer_status_entry",
  "get_internal_ops_snapshot",
  "preview_subprocessor_notice",
  "announce_subprocessor_change",
  "list_subprocessor_notices",
] as const;

Deno.test("super ops registry contains exactly the 27 live actions", () => {
  assertEquals(SUPER_OPS_ACTIONS.length, 27);
  assertEquals(new Set(SUPER_OPS_ACTIONS).size, 27);
  assertEquals([...SUPER_OPS_ACTIONS].sort(), [...EXPECTED_ACTIONS].sort());
});

Deno.test("super ops family registries partition every live action", () => {
  const familyActions = [
    ...SECURITY_SESSION_ACTIONS,
    ...CONTROL_CENTER_ACTIONS,
    ...SUPPORT_ACTIONS,
    ...SALES_CUSTOMER_ACTIONS,
    ...INTERNAL_OPS_ACTIONS,
    ...SUBPROCESSOR_ACTIONS,
  ];

  assertEquals(familyActions.length, SUPER_OPS_ACTIONS.length);
  assertEquals(new Set(familyActions).size, SUPER_OPS_ACTIONS.length);
  assertEquals([...familyActions].sort(), [...SUPER_OPS_ACTIONS].sort());
});

const testJsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: status < 400, ...body }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const contextFor = (
  action: string,
  payload: Record<string, unknown>,
  adminClient: unknown,
  writeAudit: SuperOpsContext["writeAudit"] = async () => {},
) => ({
  req: new Request("https://example.test/functions/v1/super-ops", {
    method: "POST",
  }),
  action,
  payload,
  adminClient,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.test",
  },
  profile: { auth_email: "admin@example.test" },
  accessToken: "test-token",
  supabaseUrl: "https://example.test",
  publishableKey: "test-key",
  jsonResponse: testJsonResponse,
  writeAudit,
} as unknown as SuperOpsContext);

const queryResult = (result: Record<string, unknown>) => {
  const query: Record<string, unknown> = {};
  for (
    const method of [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
      "eq",
      "neq",
      "is",
      "in",
      "gte",
      "not",
      "or",
      "order",
      "limit",
    ]
  ) {
    query[method] = () => query;
  }
  query.single = () => Promise.resolve(result);
  query.maybeSingle = () => Promise.resolve(result);
  query.then = (
    resolve: (value: Record<string, unknown>) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
};

Deno.test("super ops dispatcher preserves a representative control-center read", async () => {
  const rowsByTable: Record<string, Record<string, unknown>> = {
    app_runtime_config: {
      data: [{ key: "maintenance_mode", value: false }],
      error: null,
    },
    super_alert_rules: { data: [], error: null },
    super_approvals: { data: [], error: null },
    super_jobs: { data: [], error: null },
  };
  const adminClient = {
    from: (table: string) => queryResult(rowsByTable[table]),
  };

  const response = await dispatchSuperOpsAction(
    contextFor("get_control_center", {}, adminClient),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ok: true,
    data: {
      runtime_config: { maintenance_mode: false },
      alert_rules: [],
      approvals: [],
      jobs: [],
    },
  });
});

Deno.test("super ops dispatcher preserves a representative audited sales write", async () => {
  const lead = {
    id: "00000000-0000-4000-8000-000000000002",
    lead_state: "closed",
  };
  const auditCalls: unknown[][] = [];
  const adminClient = {
    from: () => queryResult({ data: lead, error: null }),
  };

  const response = await dispatchSuperOpsAction(
    contextFor(
      "close_sales_lead",
      { lead_id: lead.id },
      adminClient,
      async (...args) => {
        auditCalls.push(args);
      },
    ),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, data: { lead } });
  assertEquals(auditCalls, [["close_sales_lead", "sales_lead", lead.id, {}]]);
});

Deno.test("super ops dispatcher preserves a representative database error", async () => {
  const adminClient = {
    from: () => queryResult({ data: null, error: { message: "db down" } }),
  };

  const response = await dispatchSuperOpsAction(
    contextFor("list_sales_leads", {}, adminClient),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    ok: false,
    error: "Unable to load sales leads.",
  });
});

Deno.test("super ops lists only the current super admin's passkeys", async () => {
  let requestedUserId: string | null = null;
  const adminClient = {
    auth: {
      admin: {
        passkey: {
          listPasskeys: async ({ userId }: { userId: string }) => {
            requestedUserId = userId;
            return {
              data: [{
                id: "passkey-1",
                created_at: "2026-07-22T00:00:00.000Z",
                last_used_at: "2026-07-22T00:05:00.000Z",
                credential: "must-not-be-returned",
              }],
              error: null,
            };
          },
        },
      },
    },
  };

  const response = await dispatchSuperOpsAction(
    contextFor("list_passkeys", {}, adminClient),
  );

  assertEquals(response.status, 200);
  assertEquals(requestedUserId, "00000000-0000-4000-8000-000000000001");
  assertEquals(await response.json(), {
    ok: true,
    data: {
      passkeys: [{
        id: "passkey-1",
        created_at: "2026-07-22T00:00:00.000Z",
        last_used_at: "2026-07-22T00:05:00.000Z",
      }],
    },
  });
});

Deno.test("session refresh does not erase the recorded sign-in method", async () => {
  let updatePayload: Record<string, unknown> | null = null;
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) {
    query[method] = () => query;
  }
  query.update = (payload: Record<string, unknown>) => {
    updatePayload = payload;
    return query;
  };
  query.maybeSingle = () => Promise.resolve({ data: { id: "session-1" }, error: null });
  query.then = (
    resolve: (value: { data: { id: string }; error: null }) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: { id: "session-1" }, error: null }).then(resolve, reject);

  const adminClient = {
    auth: {
      getClaims: async () => ({
        data: { claims: { session_id: "auth-session-1", iat: 1_784_681_900 } },
        error: null,
      }),
    },
    from: () => query,
  };

  const response = await dispatchSuperOpsAction(
    contextFor("touch_session", {
      device_id: "device-1",
      device_label: "Mac",
      login_method: null,
      login_location: "super_settings",
    }, adminClient),
  );

  assertEquals(response.status, 200);
  const updated = updatePayload as Record<string, unknown> | null;
  assertEquals(updated?.login_method, undefined);
  assertEquals(updated?.login_location, "super_settings");
});

Deno.test("super ops dispatcher preserves the unknown-action response", async () => {
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const context = {
    req: new Request("https://example.test/functions/v1/super-ops", {
      method: "POST",
    }),
    action: "unknown_action",
    payload: {},
    adminClient: {},
    user: { id: "00000000-0000-4000-8000-000000000001" },
    profile: {},
    accessToken: "test-token",
    supabaseUrl: "https://example.test",
    publishableKey: "test-key",
    jsonResponse,
    writeAudit: async () => {},
  } as unknown as SuperOpsContext;

  const response = await dispatchSuperOpsAction(context);

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { ok: false, error: "Invalid action" });
});
