import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type SuperTenant = {
  id: string;
  name: string;
  access_code: string;
  status: "active" | "suspended";
  created_at: string;
  primary_admin_profile_id?: string | null;
  primary_admin_email?: string | null;
  checkout_due_hours?: number;
  feature_flags?: {
    enable_notifications?: boolean;
    enable_bulk_item_import?: boolean;
    enable_bulk_student_tools?: boolean;
    enable_status_tracking?: boolean;
    enable_barcode_generator?: boolean;
  };
};

type SuperTenantAction =
  | "list_tenants"
  | "create_tenant"
  | "update_tenant"
  | "set_tenant_status"
  | "send_primary_admin_reset"
  | "set_primary_admin";

type SuperTenantRequest = {
  action: SuperTenantAction;
  payload: Record<string, unknown>;
};

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Unauthorized");
  }
  return data.session.access_token;
};

const callSuperTenant = async <TData>(payload: SuperTenantRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: TData }, SuperTenantRequest>(
    "super-tenant-mutate",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Super tenant request failed.");
  }

  return result.data?.data as TData;
};

export const toTenantStatusLabel = (status: SuperTenant["status"]) =>
  status === "suspended" ? "disabled" : "active";

export const fromTenantStatusLabel = (label: "active" | "disabled") =>
  label === "disabled" ? "suspended" : "active";

export const listTenants = async (search = "", status = "all") =>
  callSuperTenant<SuperTenant[]>({
    action: "list_tenants",
    payload: { search, status },
  });

export const createTenant = async (payload: {
  name: string;
  access_code: string;
  auth_email: string;
  password: string;
  status: "active" | "suspended";
}) =>
  callSuperTenant<SuperTenant>({
    action: "create_tenant",
    payload,
  });

export const updateTenant = async (payload: {
  id: string;
  name: string;
  access_code: string;
}) =>
  callSuperTenant<SuperTenant>({
    action: "update_tenant",
    payload,
  });

export const setTenantStatus = async (payload: {
  id: string;
  status: "active" | "suspended";
  super_password: string;
  confirm_phrase: string;
}) =>
  callSuperTenant<SuperTenant>({
    action: "set_tenant_status",
    payload,
  });

export const sendPrimaryAdminReset = async (payload: { tenant_id: string }) =>
  callSuperTenant<{ success: boolean; auth_email: string }>({
    action: "send_primary_admin_reset",
    payload,
  });

export const setPrimaryAdmin = async (payload: {
  tenant_id: string;
  profile_id: string;
}) =>
  callSuperTenant<SuperTenant>({
    action: "set_primary_admin",
    payload,
  });
