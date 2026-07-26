import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";
export type SuperWorkspace = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  archived_at: string | null;
  created_at: string;
  primary_admin_profile_id: string | null;
  primary_admin_email: string | null;
  account_category?: "organization" | "district" | "individual";
  plan_code?: string | null;
  checkout_due_hours?: number;
  feature_flags?: Record<string, boolean>;
  contact_name?: string | null;
  support_email?: string | null;
  billing_email?: string | null;
  billing_status?: "draft" | "active" | "past_due" | "canceled" | null;
  renewal_date?: string | null;
  invoice_reference?: string | null;
};
export type WorkspacePolicyInput = {
  account_category: "organization" | "district" | "individual";
  plan_code?: string | null;
  checkout_due_hours: number;
  feature_flags: Record<string, boolean>;
  contact_name?: string | null;
  support_email?: string | null;
  billing_email?: string | null;
  billing_status?: "draft" | "active" | "past_due" | "canceled" | null;
  renewal_date?: string | null;
  invoice_reference?: string | null;
};
const call = async <T>(action: string, payload: Record<string, unknown>) => {
  const result = await invokeEdgeFunction<
    { data: T },
    { action: string; payload: Record<string, unknown> }
  >("super-workspace-mutate", { method: "POST", body: { action, payload } });
  if (!result.ok) {
    throw edgeFunctionError(result, "Super Admin workspace request failed.");
  }
  return result.data!.data;
};
export const listWorkspaces = (search = "", status = "all") =>
  call<SuperWorkspace[]>("list_workspaces", { search, status });
export const createWorkspace = (payload: WorkspacePolicyInput & { name: string; slug: string; auth_email: string; password: string }) =>
  call<SuperWorkspace>("create_workspace", payload);
export const updateWorkspace = (payload: WorkspacePolicyInput & { id: string; name: string; slug: string }) =>
  call<SuperWorkspace>("update_workspace", payload);
export const setWorkspaceStatus = (id: string, status: string) =>
  call<SuperWorkspace>("set_workspace_status", { id, status });
export const setPrimaryWorkspaceAdmin = (
  workspace_id: string,
  profile_id: string,
) => call<SuperWorkspace>("set_primary_admin", { workspace_id, profile_id });
export const sendPrimaryWorkspaceAdminReset = (workspace_id: string) =>
  call<{ success: boolean; auth_email: string }>("send_primary_admin_reset", {
    workspace_id,
  });
