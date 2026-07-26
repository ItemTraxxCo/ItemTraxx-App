import { edgeFunctionError } from "./appErrors";
import { invokeEdgeFunction } from "./edgeFunctionClient";

export type SuperTenantAccount = {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  auth_email: string;
  role: "tenant_account";
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
};

const call = async <T>(action: string, payload: Record<string, unknown> = {}) => {
  const result = await invokeEdgeFunction<
    { data: T },
    { action: string; payload: Record<string, unknown> }
  >("super-admin-mutate", { method: "POST", body: { action, payload } });
  if (!result.ok) throw edgeFunctionError(result, "Tenant Account request failed.");
  return result.data!.data;
};

export const listTenantAccounts = (search = "", workspace_id = "all") =>
  call<SuperTenantAccount[]>("list_tenant_accounts", { search, workspace_id });
export const createTenantAccount = (workspace_id: string, auth_email: string) =>
  call<SuperTenantAccount>("create_tenant_account", { workspace_id, auth_email });
export const setTenantAccountStatus = (id: string, is_active: boolean) =>
  call<SuperTenantAccount>("set_tenant_account_status", { id, is_active });
export const updateTenantAccountEmail = (id: string, auth_email: string) =>
  call<SuperTenantAccount>("update_tenant_account_email", { id, auth_email });
export const sendTenantAccountReset = (id: string) =>
  call<{ success: boolean }>("send_tenant_account_reset", { id });
export const removeTenantAccount = (id: string) =>
  call<{ success: boolean }>("remove_tenant_account", { id });
