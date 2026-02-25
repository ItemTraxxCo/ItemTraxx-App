import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";
import type { AdminOpsAction, EdgeEnvelope, TenantFeatureFlags } from "../types/edgeContracts";
import { getOrCreateDeviceSession } from "../utils/deviceSession";

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
  feature_flags: TenantFeatureFlags;
  maintenance: { enabled: boolean; message: string } | null;
  recent_status_events: StatusHistoryItem[];
};

export type TenantSettingsPayload = {
  checkout_due_hours: number;
  feature_flags: TenantFeatureFlags;
};

export type TenantSessionItem = {
  id: string;
  device_id: string;
  device_label: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
};

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
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, { action: string; payload: Record<string, unknown> }>(
    "admin-ops",
    {
      method: "POST",
      accessToken,
      body: {
        action,
        payload: {
          ...payload,
          device_id: deviceId,
          device_label: deviceLabel,
        },
      },
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

export const touchTenantAdminSession = async () =>
  callAdminOps<{ ok: boolean }>("touch_session");

export const validateTenantAdminSession = async () =>
  callAdminOps<{ valid: boolean }>("validate_session");

export const listTenantAdminSessions = async () =>
  callAdminOps<{ sessions: TenantSessionItem[] }>("list_sessions");

export const revokeTenantAdminSession = async (sessionId: string) =>
  callAdminOps<{ revoked: boolean }>("revoke_session", { session_id: sessionId });

export const revokeAllTenantAdminSessions = async (signOutCurrent = false) =>
  callAdminOps<{ revoked: number }>("revoke_all_sessions", { sign_out_current: signOutCurrent });
