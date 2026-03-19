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
  account_category?: "organization" | "district" | "individual";
  plan_code?:
    | "core"
    | "growth"
    | "starter"
    | "scale"
    | "enterprise"
    | "individual_yearly"
    | "individual_monthly"
    | null;
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
  subscription_plan?:
    | "district_core"
    | "district_growth"
    | "district_enterprise"
    | "organization_starter"
    | "organization_scale"
    | "organization_enterprise"
    | null;
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

const OPTION_CACHE_TTL_MS = 30_000;
const optionCache = new Map<string, { expiresAt: number; value: unknown }>();
const optionInflight = new Map<string, Promise<unknown>>();

const withCachedOptions = async <TData>(key: string, loader: () => Promise<TData>) => {
  const cached = optionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as TData;
  }

  const pending = optionInflight.get(key);
  if (pending) {
    return pending as Promise<TData>;
  }

  const next = loader()
    .then((value) => {
      optionCache.set(key, { expiresAt: Date.now() + OPTION_CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      optionInflight.delete(key);
    });

  optionInflight.set(key, next as Promise<unknown>);
  return next;
};

const invalidateOptionCaches = (...prefixes: string[]) => {
  for (const key of Array.from(optionCache.keys())) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      optionCache.delete(key);
    }
  }
  for (const key of Array.from(optionInflight.keys())) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      optionInflight.delete(key);
    }
  }
};

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

export const listTenants = async (search = "", status = "all") => {
  const normalizedSearch = search.trim();
  const cacheKey = `tenants:${status}:${normalizedSearch.toLowerCase()}`;
  const loader = () =>
    callSuperTenant<SuperTenant[]>({
      action: "list_tenants",
      payload: { search: normalizedSearch, status },
    });

  if (!normalizedSearch && status === "all") {
    return withCachedOptions(cacheKey, loader);
  }

  return loader();
};

export const createTenant = async (payload: {
  name: string;
  access_code: string;
  auth_email: string;
  password: string;
  status: "active" | "suspended" | "archived";
  account_category?: "organization" | "district" | "individual";
  plan_code?:
    | "core"
    | "growth"
    | "starter"
    | "scale"
    | "enterprise"
    | "individual_yearly"
    | "individual_monthly";
  district_name?: string;
  district_slug?: string;
}) =>
  callSuperTenant<SuperTenant>({
    action: "create_tenant",
    payload,
  }).then((value) => {
    invalidateOptionCaches("tenants:");
    return value;
  });

export const updateTenant = async (payload: {
  id: string;
  name: string;
  access_code: string;
  account_category?: "organization" | "district" | "individual";
  plan_code?:
    | "core"
    | "growth"
    | "starter"
    | "scale"
    | "enterprise"
    | "individual_yearly"
    | "individual_monthly";
  district_name?: string;
  district_slug?: string;
}) =>
  callSuperTenant<SuperTenant>({
    action: "update_tenant",
    payload,
  }).then((value) => {
    invalidateOptionCaches("tenants:");
    return value;
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
  }).then((value) => {
    invalidateOptionCaches("tenants:");
    return value;
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

export const listDistricts = async (search = "") => {
  const normalizedSearch = search.trim();
  const cacheKey = `districts:${normalizedSearch.toLowerCase()}`;
  const loader = () =>
    callSuperTenant<SuperDistrict[]>({
      action: "list_districts",
      payload: { search: normalizedSearch },
    });

  if (!normalizedSearch) {
    return withCachedOptions(cacheKey, loader);
  }

  return loader();
};

export const createDistrict = async (payload: {
  name: string;
  slug: string;
  support_email?: string;
  contact_name?: string;
  subscription_plan?:
    | "district_core"
    | "district_growth"
    | "district_enterprise"
    | "organization_starter"
    | "organization_scale"
    | "organization_enterprise";
  billing_status?: "draft" | "active" | "past_due" | "canceled";
  renewal_date?: string;
  billing_email?: string;
  invoice_reference?: string;
}) =>
  callSuperTenant<SuperDistrict>({
    action: "create_district",
    payload,
  }).then((value) => {
    invalidateOptionCaches("districts:", "tenants:");
    return value;
  });

export const updateDistrict = async (payload: {
  id: string;
  name: string;
  slug: string;
  support_email?: string;
  contact_name?: string;
  is_active: boolean;
  subscription_plan?:
    | "district_core"
    | "district_growth"
    | "district_enterprise"
    | "organization_starter"
    | "organization_scale"
    | "organization_enterprise";
  billing_status?: "draft" | "active" | "past_due" | "canceled";
  renewal_date?: string;
  billing_email?: string;
  invoice_reference?: string;
}) =>
  callSuperTenant<SuperDistrict>({
    action: "update_district",
    payload,
  }).then((value) => {
    invalidateOptionCaches("districts:", "tenants:");
    return value;
  });

export const getDistrictDetails = async (districtId: string) =>
  callSuperTenant<SuperDistrictDetail>({
    action: "get_district_details",
    payload: { id: districtId },
  });
