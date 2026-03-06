import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getFreshAccessToken } from "./sessionAccessToken";
import type { EdgeEnvelope, SuperTenantAction } from "../types/edgeContracts";

export type SuperTenant = {
  id: string;
  name: string;
  access_code: string;
  status: "active" | "suspended" | "archived";
  created_at: string;
  district_id?: string | null;
  district_name?: string | null;
  district_slug?: string | null;
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

export type SuperDistrict = {
  id: string;
  name: string;
  slug: string;
  support_email?: string | null;
  contact_name?: string | null;
  is_active: boolean;
  created_at: string;
  tenants_count?: number;
  subscription_plan?: "starter" | "standard" | "enterprise" | null;
  billing_status?: "draft" | "active" | "past_due" | "canceled" | null;
  renewal_date?: string | null;
  billing_email?: string | null;
  invoice_reference?: string | null;
};

export type SuperDistrictDetail = {
  district: SuperDistrict;
  tenants: SuperTenant[];
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
  usage: {
    gear_total: number;
    students_total: number;
    active_checkouts: number;
    overdue_items: number;
    transactions_7d: number;
  };
};

type SuperTenantRequest = {
  action: SuperTenantAction;
  payload: Record<string, unknown>;
};

const getAccessToken = getFreshAccessToken;

const callSuperTenant = async <TData>(payload: SuperTenantRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperTenantRequest>(
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
  status === "suspended" ? "disabled" : status;

export const fromTenantStatusLabel = (label: "active" | "disabled" | "archived") =>
  label === "disabled" ? "suspended" : label;

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
  status: "active" | "suspended" | "archived";
  district_name?: string;
  district_slug?: string;
}) =>
  callSuperTenant<SuperTenant>({
    action: "create_tenant",
    payload,
  });

export const updateTenant = async (payload: {
  id: string;
  name: string;
  access_code: string;
  district_name?: string;
  district_slug?: string;
}) =>
  callSuperTenant<SuperTenant>({
    action: "update_tenant",
    payload,
  });

export const setTenantStatus = async (payload: {
  id: string;
  status: "active" | "suspended" | "archived";
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

export const listDistricts = async (search = "") =>
  callSuperTenant<SuperDistrict[]>({
    action: "list_districts",
    payload: { search },
  });

export const createDistrict = async (payload: {
  name: string;
  slug: string;
  support_email?: string;
  contact_name?: string;
  subscription_plan?: "starter" | "standard" | "enterprise";
  billing_status?: "draft" | "active" | "past_due" | "canceled";
  renewal_date?: string;
  billing_email?: string;
  invoice_reference?: string;
}) =>
  callSuperTenant<SuperDistrict>({
    action: "create_district",
    payload,
  });

export const updateDistrict = async (payload: {
  id: string;
  name: string;
  slug: string;
  support_email?: string;
  contact_name?: string;
  is_active: boolean;
  subscription_plan?: "starter" | "standard" | "enterprise";
  billing_status?: "draft" | "active" | "past_due" | "canceled";
  renewal_date?: string;
  billing_email?: string;
  invoice_reference?: string;
}) =>
  callSuperTenant<SuperDistrict>({
    action: "update_district",
    payload,
  });

export const getDistrictDetails = async (districtId: string) =>
  callSuperTenant<SuperDistrictDetail>({
    action: "get_district_details",
    payload: { id: districtId },
  });
