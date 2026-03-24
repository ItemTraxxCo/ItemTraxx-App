import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getFreshAccessToken } from "./sessionAccessToken";
import type { EdgeEnvelope, SuperAdminAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";

export type SuperTenantAdmin = {
  id: string;
  tenant_id: string;
  district_id?: string;
  auth_email: string;
  role: "tenant_admin" | "district_admin";
  is_active: boolean;
  created_at: string;
  tenant_name?: string;
  district_name?: string;
};

type SuperAdminRequest = {
  action: SuperAdminAction;
  payload: Record<string, unknown>;
};

const getAccessToken = getFreshAccessToken;

const callSuperAdmin = async <TData>(payload: SuperAdminRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperAdminRequest>(
    "super-admin-mutate",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Super admin request failed.");
  }

  return result.data?.data as TData;
};

export const listTenantAdmins = async (
  search = "",
  tenantId = "all",
  adminScope: "tenant" | "district" = "tenant",
  districtId = "all"
) =>
  callSuperAdmin<SuperTenantAdmin[]>({
    action: "list_tenant_admins",
    payload: { search, tenant_id: tenantId, district_id: districtId, admin_scope: adminScope },
  });

export const createTenantAdmin = async (payload: {
  tenant_id?: string;
  district_id?: string;
  auth_email: string;
  password: string;
  admin_scope?: "tenant" | "district";
}) =>
  callSuperAdmin<SuperTenantAdmin>({
    action: "create_tenant_admin",
    payload,
  });

export const setTenantAdminStatus = async (payload: {
  id: string;
  is_active: boolean;
  admin_scope?: "tenant" | "district";
}) =>
  callSuperAdmin<SuperTenantAdmin>({
    action: "set_admin_status",
    payload,
  });

export const sendTenantAdminReset = async (payload: {
  auth_email: string;
  admin_scope?: "tenant" | "district";
}) =>
  callSuperAdmin<{ success: boolean }>({
    action: "send_reset",
    payload,
  });

export const updateTenantAdminEmail = async (payload: {
  id: string;
  auth_email: string;
  admin_scope?: "tenant" | "district";
}) =>
  callSuperAdmin<SuperTenantAdmin>({
    action: "update_admin_email",
    payload,
  });
