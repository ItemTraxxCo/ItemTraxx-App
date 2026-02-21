import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type StatusTrackedItem = {
  id: string;
  name: string;
  barcode: string;
  serial_number: string | null;
  status: string;
  notes: string | null;
  updated_at: string;
};

export type StatusHistoryItem = {
  id: string;
  gear_id: string;
  status: string;
  note: string | null;
  changed_at: string;
  changed_by: string | null;
  gear: { name: string; barcode: string } | null;
};

export type TenantNotificationPayload = {
  overdue_count: number;
  flagged_count: number;
  checkout_due_hours: number;
  updates: Array<{
    id: string;
    title: string;
    message: string;
    level: "info" | "warning" | "critical";
    created_at: string;
    link_url: string | null;
  }>;
  feature_flags: {
    enable_notifications: boolean;
    enable_bulk_item_import: boolean;
    enable_bulk_student_tools: boolean;
    enable_status_tracking: boolean;
    enable_barcode_generator: boolean;
  };
  maintenance: { enabled: boolean; message: string } | null;
  recent_status_events: StatusHistoryItem[];
};

export type TenantSettingsPayload = {
  checkout_due_hours: number;
  feature_flags: {
    enable_notifications: boolean;
    enable_bulk_item_import: boolean;
    enable_bulk_student_tools: boolean;
    enable_status_tracking: boolean;
    enable_barcode_generator: boolean;
  };
};

type AdminOpsAction =
  | "get_notifications"
  | "get_status_tracking"
  | "bulk_import_gear"
  | "get_tenant_settings"
  | "update_tenant_settings";

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Unauthorized");
  }
  return data.session.access_token;
};

const callAdminOps = async <TData>(
  action: AdminOpsAction,
  payload: Record<string, unknown> = {}
) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: TData }, { action: string; payload: Record<string, unknown> }>(
    "admin-ops",
    {
      method: "POST",
      accessToken,
      body: { action, payload },
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Request failed.");
  }

  return result.data?.data as TData;
};

export const fetchTenantNotifications = async () =>
  callAdminOps<TenantNotificationPayload>("get_notifications");

export const fetchTenantSettings = async () =>
  callAdminOps<TenantSettingsPayload>("get_tenant_settings");

export const updateTenantSettings = async (payload: { checkout_due_hours: number }) =>
  callAdminOps<TenantSettingsPayload>("update_tenant_settings", payload);

export const fetchStatusTracking = async () =>
  callAdminOps<{
    flagged_items: StatusTrackedItem[];
    history: StatusHistoryItem[];
  }>("get_status_tracking");

export const bulkImportGear = async (
  rows: Array<{
    name: string;
    barcode: string;
    serial_number?: string;
    status?: string;
    notes?: string;
  }>
) =>
  callAdminOps<{
    inserted: number;
    skipped: number;
    inserted_items: StatusTrackedItem[];
    skipped_rows: Array<{ barcode: string; reason: string }>;
  }>("bulk_import_gear", { rows });
