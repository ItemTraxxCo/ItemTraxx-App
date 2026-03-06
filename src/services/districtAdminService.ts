import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type DistrictAdminDashboard = {
  district: {
    id: string;
    name: string;
    slug: string;
    support_email?: string | null;
    contact_name?: string | null;
    is_active: boolean;
    subscription_plan?: "starter" | "standard" | "enterprise" | null;
    billing_status?: "draft" | "active" | "past_due" | "canceled" | null;
    renewal_date?: string | null;
    billing_email?: string | null;
    invoice_reference?: string | null;
  };
  support_requests: Array<{
    id: string;
    requester_email?: string | null;
    requester_name?: string | null;
    subject: string;
    message: string;
    priority: "low" | "normal" | "high" | "urgent";
    status: "open" | "in_progress" | "resolved";
    created_at: string;
  }>;
  tenant_metrics: Array<{
    tenant_id: string;
    tenant_name: string;
    gear_total: number;
    students_total: number;
    active_checkouts: number;
    overdue_items: number;
    transactions_7d: number;
  }>;
  traffic: {
    checkout_24h: number;
    return_24h: number;
    active_tenants_24h: number;
    events_24h: number;
  };
  traffic_by_hour: Array<{
    hour: string;
    checkout: number;
    return: number;
  }>;
  recent_events: Array<{
    tenant_id: string | null;
    tenant_name: string;
    action_type: "checkout" | "return";
    action_time: string;
    gear_name: string | null;
    gear_barcode: string | null;
    student_username: string | null;
    student_id: string | null;
  }>;
  needs_attention: Array<{
    key: string;
    level: "high" | "medium" | "low";
    title: string;
    count: number;
  }>;
  tenants: Array<{
    id: string;
    name: string;
    access_code: string;
    status: "active" | "suspended" | "archived";
    primary_admin_email?: string | null;
    created_at: string;
  }>;
  usage: {
    gear_total: number;
    students_total: number;
    active_checkouts: number;
    overdue_items: number;
    transactions_7d: number;
  };
};

export type DistrictAdminTenant = DistrictAdminDashboard["tenants"][number];

const getAccessToken = async () => {
  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data.session?.access_token;
  if (!refreshed.error && refreshedToken) {
    return refreshedToken;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Unauthorized");
  }
  return data.session.access_token;
};

export const getDistrictAdminDashboard = async () => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: DistrictAdminDashboard }>(
    "district-dashboard",
    {
      method: "GET",
      accessToken,
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Unable to load district dashboard.");
  }

  return result.data?.data as DistrictAdminDashboard;
};

type DistrictAdminMutateRequest = {
  action:
    | "update_tenant"
    | "set_tenant_status"
    | "send_primary_admin_reset"
    | "create_support_request";
  payload: Record<string, unknown>;
};

const callDistrictAdminMutate = async <TData>(payload: DistrictAdminMutateRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: TData }, DistrictAdminMutateRequest>(
    "district-admin-mutate",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "District admin request failed.");
  }

  return result.data?.data as TData;
};

export const updateDistrictTenant = async (payload: {
  id: string;
  name: string;
  access_code: string;
}) =>
  callDistrictAdminMutate<DistrictAdminTenant>({
    action: "update_tenant",
    payload,
  });

export const setDistrictTenantStatus = async (payload: {
  id: string;
  status: "active" | "suspended" | "archived";
}) =>
  callDistrictAdminMutate<DistrictAdminTenant>({
    action: "set_tenant_status",
    payload,
  });

export const sendDistrictTenantPrimaryAdminReset = async (payload: { tenant_id: string }) =>
  callDistrictAdminMutate<{ success: boolean; auth_email: string | null }>({
    action: "send_primary_admin_reset",
    payload,
  });

export const createDistrictSupportRequest = async (payload: {
  subject: string;
  message: string;
  priority: "low" | "normal" | "high" | "urgent";
}) =>
  callDistrictAdminMutate<DistrictAdminDashboard["support_requests"][number]>({
    action: "create_support_request",
    payload,
  });
