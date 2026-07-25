import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { AdminOpsAction, EdgeEnvelope, TenantFeatureFlags } from "../types/edgeContracts";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import { edgeFunctionError } from "./appErrors";

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

export type WorkspaceSettingsPayload = {
  checkout_due_hours: number;
  account_category: "organization" | "district" | "individual" | null;
  plan_code:
    | "core"
    | "growth"
    | "starter"
    | "scale"
    | "enterprise"
    | "individual_yearly"
    | "individual_monthly"
    | null;
  feature_flags: TenantFeatureFlags;
};

export type AccountSessionItem = {
  id: string;
  device_id: string;
  device_label: string | null;
  user_agent: string | null;
  login_method: "password" | "magic_link" | "session_handoff" | null;
  login_location: "regular_login" | "admin_login" | null;
  general_location: string | null;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
};

export type AccountSessionTouchOptions = {
  loginMethod?: AccountSessionItem["login_method"];
  loginLocation?: AccountSessionItem["login_location"];
};

export type WorkspaceAccountDashboardRow = {
  profile_id: string;
  auth_email: string;
  item_count: number;
  borrower_count: number;
  active_checkouts: number;
  overdue_count: number;
};

const requestCache = new Map<
  string,
  {
    expiresAt: number;
    data: unknown;
  }
>();

const requestInflight = new Map<string, Promise<unknown>>();

const getAdminOpCacheKey = (action: string, suffix = "") => {
  const { deviceId } = getOrCreateDeviceSession();
  return `${action}:${deviceId}:${suffix}`;
};

const withCachedAdminOp = async <TData>(
  key: string,
  ttlMs: number,
  loader: () => Promise<TData>
) => {
  const now = Date.now();
  const cached = requestCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.data as TData;
  }

  const inflight = requestInflight.get(key);
  if (inflight) {
    return (await inflight) as TData;
  }

  const pending = loader()
    .then((data) => {
      requestCache.set(key, { data, expiresAt: Date.now() + ttlMs });
      return data;
    })
    .finally(() => {
      requestInflight.delete(key);
    });

  requestInflight.set(key, pending);
  return (await pending) as TData;
};

const callAdminOps = async <TData>(
  action: AdminOpsAction,
  payload: Record<string, unknown> = {}
) => {
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, { action: string; payload: Record<string, unknown> }>(
    "admin-ops",
    {
      method: "POST",
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
    throw edgeFunctionError(result, "Request failed.");
  }

  return result.data?.data as TData;
};

export const fetchWorkspaceNotifications = async () =>
  withCachedAdminOp("get_notifications", 15_000, () =>
    callAdminOps<TenantNotificationPayload>("get_notifications")
  );

export const fetchWorkspaceSettings = async () =>
  callAdminOps<WorkspaceSettingsPayload>("get_workspace_settings");

export const updateWorkspaceSettings = async (payload: { checkout_due_hours: number }) =>
  callAdminOps<WorkspaceSettingsPayload>("update_workspace_settings", payload);

export const fetchStatusTracking = async () =>
  callAdminOps<{
    flagged_items: StatusTrackedItem[];
    history: StatusHistoryItem[];
  }>("get_status_tracking");

export const fetchWorkspaceAccountDashboard = async () =>
  callAdminOps<WorkspaceAccountDashboardRow[]>("get_workspace_dashboard");

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

export const touchAccountSession = async (
  options: AccountSessionTouchOptions = {}
) =>
  withCachedAdminOp(
    getAdminOpCacheKey(
      "touch_session",
      `${options.loginMethod ?? "none"}:${options.loginLocation ?? "none"}`
    ),
    20_000,
    () =>
      callAdminOps<{ ok: boolean }>("touch_session", {
        login_method: options.loginMethod,
        login_location: options.loginLocation,
      })
  );

export const validateAccountSession = async () =>
  withCachedAdminOp(getAdminOpCacheKey("validate_session"), 5_000, () =>
    callAdminOps<{ valid: boolean }>("validate_session")
  );

export const listAccountSessions = async () =>
  callAdminOps<{ sessions: AccountSessionItem[] }>("list_sessions");

export const revokeAccountSession = async (sessionId: string) =>
  callAdminOps<{ revoked: boolean }>("revoke_session", { session_id: sessionId });

export const revokeAllAccountSessions = async (signOutCurrent = false) =>
  callAdminOps<{ revoked: number }>("revoke_all_sessions", { sign_out_current: signOutCurrent });

export const revokeCurrentAccountSession = async () =>
  callAdminOps<{ revoked: boolean }>("revoke_current_session");
