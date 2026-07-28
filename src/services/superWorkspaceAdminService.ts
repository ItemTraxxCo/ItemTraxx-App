import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";
export type SuperWorkspaceAdmin = {
  id: string;
  workspace_id: string;
  auth_email: string;
  role: "workspace_admin";
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  workspace_name?: string;
  is_primary_admin?: boolean;
};
const call = async <T>(
  action: string,
  payload: Record<string, unknown> = {},
) => {
  const r = await invokeEdgeFunction<
    { data: T },
    { action: string; payload: Record<string, unknown> }
  >("super-admin-mutate", { method: "POST", body: { action, payload } });
  if (!r.ok) throw edgeFunctionError(r, "Workspace Admin request failed.");
  return r.data!.data;
};
export const listWorkspaceAdmins = (search = "", workspace_id = "all") =>
  call<SuperWorkspaceAdmin[]>("list_workspace_admins", {
    search,
    workspace_id,
  });
export const createWorkspaceAdmin = (
  workspace_id: string,
  auth_email: string,
) =>
  call<SuperWorkspaceAdmin>("create_workspace_admin", {
    workspace_id,
    auth_email,
  });
export const setWorkspaceAdminStatus = (id: string, is_active: boolean) =>
  call<SuperWorkspaceAdmin>("set_workspace_admin_status", { id, is_active });
export const sendWorkspaceAdminReset = (id: string) =>
  call<{ success: boolean }>("send_workspace_admin_reset", { id });
