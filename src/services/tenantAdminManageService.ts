import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getFreshAccessToken } from "./sessionAccessToken";
import type { EdgeEnvelope, TenantAdminManageAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";

export type TenantManagedAdmin = {
  id: string;
  tenant_id: string;
  auth_email: string;
  role: "tenant_admin";
  is_active: boolean;
  created_at: string;
  is_primary_admin: boolean;
};

type TenantAdminManageRequest = {
  action: TenantAdminManageAction;
  payload: Record<string, unknown>;
};

const callTenantAdminManage = async <TData>(payload: TenantAdminManageRequest) => {
  const accessToken = await getFreshAccessToken();
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, TenantAdminManageRequest>(
    "tenant-admin-mutate",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Tenant admin request failed.");
  }

  return result.data?.data as TData;
};

export const listTenantManagedAdmins = async () =>
  callTenantAdminManage<{
    admins: TenantManagedAdmin[];
    can_manage_admins: boolean;
    primary_admin_profile_id: string | null;
  }>({
    action: "list_tenant_admins",
    payload: {},
  });

export const createTenantManagedAdmin = async (payload: { auth_email: string }) =>
  callTenantAdminManage<{
    success: boolean;
    auth_email: string;
  }>({
    action: "create_tenant_admin",
    payload,
  });

export const setTenantManagedAdminStatus = async (payload: {
  id: string;
  is_active: boolean;
}) =>
  callTenantAdminManage<TenantManagedAdmin>({
    action: "set_admin_status",
    payload,
  });

export const updateTenantManagedAdminEmail = async (payload: {
  id: string;
  auth_email: string;
}) =>
  callTenantAdminManage<TenantManagedAdmin>({
    action: "update_admin_email",
    payload,
  });

export const sendTenantManagedAdminReset = async (payload: { auth_email: string }) =>
  callTenantAdminManage<{ success: boolean }>({
    action: "send_tenant_admin_reset",
    payload,
  });
