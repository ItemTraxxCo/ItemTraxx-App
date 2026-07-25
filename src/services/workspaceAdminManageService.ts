import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { EdgeEnvelope, WorkspaceAdminManageAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";

export type TenantManagedAdmin = {
  id: string;
  workspace_id: string;
  auth_email: string;
  role: "workspace_admin";
  is_active: boolean;
  created_at: string;
  is_primary_admin: boolean;
};

type WorkspaceAdminManageRequest = {
  action: WorkspaceAdminManageAction;
  payload: Record<string, unknown>;
};

const callWorkspaceAdminManage = async <TData>(payload: WorkspaceAdminManageRequest) => {
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, WorkspaceAdminManageRequest>(
    "workspace-admin-mutate",
    {
      method: "POST",
      body: {
        ...payload,
        payload: {
          ...payload.payload,
          device_id: deviceId,
          device_label: deviceLabel,
        },
      },
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Workspace Admin request failed. Please try again. If this keeps happening, sign out and sign back in. If that doesn't work, please contact support.");
  }

  return result.data?.data as TData;
};

export const listTenantManagedAdmins = async () =>
  callWorkspaceAdminManage<{
    admins: TenantManagedAdmin[];
    can_manage_admins: boolean;
    primary_admin_profile_id: string | null;
  }>({
    action: "list_workspace_admins",
    payload: {},
  });

export const createTenantManagedAdmin = async (payload: { auth_email: string }) =>
  callWorkspaceAdminManage<{
    success: boolean;
    auth_email: string;
  }>({
    action: "create_workspace_admin",
    payload,
  });

export const setTenantManagedAdminStatus = async (payload: {
  id: string;
  is_active: boolean;
}) =>
  callWorkspaceAdminManage<TenantManagedAdmin>({
    action: "set_admin_status",
    payload,
  });

export const updateTenantManagedAdminEmail = async (payload: {
  id: string;
  auth_email: string;
}) =>
  callWorkspaceAdminManage<TenantManagedAdmin>({
    action: "update_admin_email",
    payload,
  });

export const sendTenantManagedAdminReset = async (payload: { auth_email: string }) =>
  callWorkspaceAdminManage<{ success: boolean }>({
    action: "send_workspace_admin_reset",
    payload,
  });

export type TenantAccount={id:string;workspace_id:string;auth_email:string;role:"tenant_account";is_active:boolean;created_at:string};
export const listTenantAccounts=()=>callWorkspaceAdminManage<TenantAccount[]>({action:"list_tenant_accounts",payload:{}});
export const createTenantAccount=(auth_email:string)=>callWorkspaceAdminManage<TenantAccount>({action:"create_tenant_account",payload:{auth_email}});
export const setTenantAccountStatus=(id:string,is_active:boolean)=>callWorkspaceAdminManage<TenantAccount>({action:"set_tenant_account_status",payload:{id,is_active}});
export const removeTenantAccount=(id:string)=>callWorkspaceAdminManage<{success:boolean}>({action:"remove_tenant_account",payload:{id}});
export const sendTenantAccountReset=(id:string)=>callWorkspaceAdminManage<{success:boolean}>({action:"send_tenant_account_reset",payload:{id}});
