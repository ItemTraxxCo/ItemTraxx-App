import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type SuperTenantAdmin = {
  id: string;
  tenant_id: string;
  auth_email: string;
  role: "tenant_admin";
  is_active: boolean;
  created_at: string;
  tenant_name?: string;
};

type SuperAdminAction =
  | "list_tenant_admins"
  | "create_tenant_admin"
  | "set_admin_status"
  | "update_admin_email"
  | "send_reset";

type SuperAdminRequest = {
  action: SuperAdminAction;
  payload: Record<string, unknown>;
};

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Unauthorized");
  }
  return data.session.access_token;
};

const callSuperAdmin = async <TData>(payload: SuperAdminRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: TData }, SuperAdminRequest>(
    "super-admin-mutate",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Super admin request failed.");
  }

  return result.data?.data as TData;
};

export const listTenantAdmins = async (search = "", tenantId = "all") =>
  callSuperAdmin<SuperTenantAdmin[]>({
    action: "list_tenant_admins",
    payload: { search, tenant_id: tenantId },
  });

export const createTenantAdmin = async (payload: {
  tenant_id: string;
  auth_email: string;
  password: string;
}) =>
  callSuperAdmin<SuperTenantAdmin>({
    action: "create_tenant_admin",
    payload,
  });

export const setTenantAdminStatus = async (payload: {
  id: string;
  is_active: boolean;
}) =>
  callSuperAdmin<SuperTenantAdmin>({
    action: "set_admin_status",
    payload,
  });

export const sendTenantAdminReset = async (payload: { auth_email: string }) =>
  callSuperAdmin<{ success: boolean }>({
    action: "send_reset",
    payload,
  });

export const updateTenantAdminEmail = async (payload: {
  id: string;
  auth_email: string;
}) =>
  callSuperAdmin<SuperTenantAdmin>({
    action: "update_admin_email",
    payload,
  });
