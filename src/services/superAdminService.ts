import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";
export type SuperAdminAccount = {
  id: string;
  auth_email: string;
  role: "super_admin";
  is_active: boolean;
  created_at: string;
};
const call = async <T>(action: string, payload: Record<string, unknown>) => {
  const r = await invokeEdgeFunction<
    { data: T },
    { action: string; payload: Record<string, unknown> }
  >("super-admin-mutate", { method: "POST", body: { action, payload } });
  if (!r.ok) throw edgeFunctionError(r, "Super Admin request failed.");
  return r.data!.data;
};
export const listSuperAdmins = (search = "") =>
  call<SuperAdminAccount[]>("list_super_admins", { search });
export const createSuperAdmin = (
  payload: { auth_email: string; password: string },
) => call<SuperAdminAccount>("create_super_admin", payload);
export const setSuperAdminStatus = (
  payload: { id: string; is_active: boolean },
) => call<SuperAdminAccount>("set_super_admin_status", payload);
export const updateSuperAdminEmail = (
  payload: { id: string; auth_email: string },
) => call<SuperAdminAccount>("update_super_admin_email", payload);
export const sendSuperAdminReset = (payload: { auth_email: string }) =>
  call<{ success: boolean }>("send_super_admin_reset", payload);
