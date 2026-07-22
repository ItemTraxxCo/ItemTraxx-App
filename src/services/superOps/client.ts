import { edgeFunctionError } from "../appErrors";
import { invokeEdgeFunction } from "../edgeFunctionClient";

type SuperOpsAction =
  | "verify_password"
  | "touch_session"
  | "list_sessions"
  | "list_passkeys"
  | "revoke_session"
  | "revoke_all_sessions"
  | "get_control_center"
  | "set_runtime_config"
  | "upsert_alert_rule"
  | "set_tenant_policy"
  | "set_tenant_force_reauth"
  | "create_approval"
  | "approve_request"
  | "list_support_requests"
  | "get_support_request"
  | "update_support_request"
  | "list_sales_leads"
  | "set_sales_lead_stage"
  | "delete_sales_lead"
  | "close_sales_lead"
  | "move_sales_lead_to_customer"
  | "list_customers"
  | "add_customer_status_entry"
  | "get_internal_ops_snapshot";

export type SuperOpsRequest = {
  action: SuperOpsAction;
  payload: Record<string, unknown>;
};

export const callSuperOps = async <TData>(payload: SuperOpsRequest) => {
  const result = await invokeEdgeFunction<{ data?: TData }, SuperOpsRequest>(
    "super-ops",
    {
      method: "POST",
      body: payload,
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Super ops request failed. Please try again.");
  }

  return result.data?.data as TData;
};
