import { requireRecentAdminAuth } from "../../_shared/adminReauth.ts";
import type {
  AdminOpsContext,
  JsonResponse,
  SupabaseClient,
} from "../context.ts";
import { handleBulkItemsAction } from "./bulkItems.ts";
import { handleNotificationAction } from "./notifications.ts";
import { handleSettingsAction } from "./settings.ts";
import { handleSessionAction } from "./sessions.ts";
import { handleStatusTrackingAction } from "./statusTracking.ts";

export const ADMIN_OPS_ACTIONS = [
  "get_notifications",
  "get_workspace_settings",
  "update_workspace_settings",
  "get_status_tracking",
  "get_workspace_dashboard",
  "touch_session",
  "validate_session",
  "list_sessions",
  "revoke_session",
  "revoke_current_session",
  "revoke_all_sessions",
  "bulk_import_items",
] as const;

export type AdminOpsAction = (typeof ADMIN_OPS_ACTIONS)[number];

export const ADMIN_OPS_ACTION_OWNERS: Record<AdminOpsAction, string> = {
  get_notifications: "notifications",
  get_workspace_settings: "settings",
  update_workspace_settings: "settings",
  get_status_tracking: "statusTracking",
  get_workspace_dashboard: "settings",
  touch_session: "sessions",
  validate_session: "sessions",
  list_sessions: "sessions",
  revoke_session: "sessions",
  revoke_current_session: "sessions",
  revoke_all_sessions: "sessions",
  bulk_import_items: "bulkItems",
};

const WORKSPACE_ADMIN_ONLY_ACTIONS = new Set<AdminOpsAction>([
  "get_workspace_settings",
  "update_workspace_settings",
  "get_status_tracking",
  "get_workspace_dashboard",
  "bulk_import_items",
]);

// Actions that change workspace state and therefore require the caller to have
// authenticated interactively within the admin re-auth window. Session
// lifecycle actions (touch/validate/list/revoke) are deliberately excluded:
// touch/validate are polled continuously by useAdminSessionLifecycle, and a
// user must always be able to sign themselves out of a device.
const ADMIN_REAUTH_ACTIONS = new Set<AdminOpsAction>([
  "update_workspace_settings",
  "bulk_import_items",
]);

const SUSPENDED_TENANT_WRITE_ACTIONS = new Set<AdminOpsAction>([
  "update_workspace_settings",
  "revoke_session",
  "revoke_current_session",
  "revoke_all_sessions",
  "bulk_import_items",
]);

const isAdminOpsAction = (action: string): action is AdminOpsAction =>
  (ADMIN_OPS_ACTIONS as readonly string[]).includes(action);

export const authorizeAdminOpsAction = async (input: {
  action: string;
  profileRole: "workspace_admin" | "tenant_account";
  isWorkspaceSuspended: boolean;
  adminClient: SupabaseClient;
  userId: string;
  authToken: string;
  jsonResponse: JsonResponse;
}): Promise<Response | null> => {
  if (!isAdminOpsAction(input.action)) return null;
  if (
    WORKSPACE_ADMIN_ONLY_ACTIONS.has(input.action) &&
    input.profileRole !== "workspace_admin"
  ) {
    return input.jsonResponse(403, { error: "Access denied" });
  }
  if (
    SUSPENDED_TENANT_WRITE_ACTIONS.has(input.action) &&
    input.isWorkspaceSuspended
  ) {
    return input.jsonResponse(403, { error: "Workspace disabled" });
  }
  if (ADMIN_REAUTH_ACTIONS.has(input.action)) {
    const reauthFailure = await requireRecentAdminAuth(
      input.adminClient,
      input.authToken,
      input.jsonResponse,
    );
    if (reauthFailure) return reauthFailure;
  }
  return null;
};

type ActionHandler = (context: AdminOpsContext) => Promise<Response>;

const ACTION_HANDLERS: Partial<Record<AdminOpsAction, ActionHandler>> = {
  get_notifications: handleNotificationAction,
  get_workspace_settings: handleSettingsAction,
  update_workspace_settings: handleSettingsAction,
  get_status_tracking: handleStatusTrackingAction,
  get_workspace_dashboard: handleSettingsAction,
  touch_session: handleSessionAction,
  validate_session: handleSessionAction,
  list_sessions: handleSessionAction,
  revoke_session: handleSessionAction,
  revoke_current_session: handleSessionAction,
  revoke_all_sessions: handleSessionAction,
  bulk_import_items: handleBulkItemsAction,
};

export const dispatchAdminOpsAction = (context: AdminOpsContext) => {
  const handler = ACTION_HANDLERS[context.action as AdminOpsAction];
  return handler
    ? handler(context)
    : Promise.resolve(context.jsonResponse(400, { error: "Invalid action" }));
};
