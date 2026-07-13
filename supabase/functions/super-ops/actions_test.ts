import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { dispatchSuperOpsAction, SUPER_OPS_ACTIONS } from "./actions/index.ts";
import type { SuperOpsContext } from "./context.ts";

const EXPECTED_ACTIONS = [
  "verify_password",
  "touch_session",
  "list_sessions",
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

Deno.test("super ops registry contains exactly the 26 live actions", () => {
  assertEquals(SUPER_OPS_ACTIONS.length, 26);
  assertEquals(new Set(SUPER_OPS_ACTIONS).size, 26);
  assertEquals([...SUPER_OPS_ACTIONS].sort(), [...EXPECTED_ACTIONS].sort());
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
