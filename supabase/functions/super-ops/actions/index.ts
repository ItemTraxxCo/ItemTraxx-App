import type { SuperOpsContext } from "../context.ts";
import { handleControlCenterAction } from "./controlCenter.ts";
import { handleInternalOpsAction } from "./internalOps.ts";
import { handleSalesCustomersAction } from "./salesCustomers.ts";
import { handleSecuritySessionsAction } from "./securitySessions.ts";
import { handleSupportAction } from "./support.ts";
import { handleSubprocessorsAction } from "./subprocessors.ts";

export const SUPER_OPS_ACTIONS = [
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
    ]
  ) {
    const response = await handler(context);
    if (response) return response;
  }
  return context.jsonResponse(400, { error: "Invalid action" });
};
