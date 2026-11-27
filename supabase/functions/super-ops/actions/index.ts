import type { SuperOpsContext } from "../context.ts";
import { handleControlCenterAction } from "./controlCenter.ts";
import { handleInternalOpsAction } from "./internalOps.ts";
import { handleSalesCustomersAction } from "./salesCustomers.ts";
import { handleSecuritySessionsAction } from "./securitySessions.ts";
import { handleSupportAction } from "./support.ts";
import { handleSubprocessorsAction } from "./subprocessors.ts";
import { handleJitAccessAction } from "./jitAccess.ts";

export const SUPER_OPS_ACTIONS = [
  "verify_password",
  "touch_session",
  "list_sessions",
  "list_passkeys",
  "revoke_session",
  "revoke_all_sessions",
  "start_passkey_registration",
  "verify_passkey_registration",
  "delete_passkey",
  "get_control_center",
  "set_runtime_config",
  "upsert_alert_rule",
  "set_workspace_policy",
  "set_workspace_force_reauth",
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
  "request_jit_ticket",
  "invoke_break_glass",
  "revoke_jit_ticket",
  "list_jit_tickets",
  "list_jit_audit_logs",
] as const;

export const dispatchSuperOpsAction = async (
  context: SuperOpsContext,
): Promise<Response> => {
  for (
    const handler of [
      handleSecuritySessionsAction,
      handleControlCenterAction,
      handleSupportAction,
      handleSalesCustomersAction,
      handleInternalOpsAction,
      handleSubprocessorsAction,
      handleJitAccessAction,
    ]
  ) {
    const response = await handler(context);
    if (response) return response;
  }
  return context.jsonResponse(400, { error: "Invalid action" });
};
