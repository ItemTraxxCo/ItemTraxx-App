import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../../_shared/privilegedStepUp.ts";
import type {
  AdminOpsContext,
  JsonResponse,
  SupabaseClient,
} from "../context.ts";
import { handleBulkGearAction } from "./bulkGear.ts";
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
  "bulk_import_gear",
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
  bulk_import_gear: "bulkGear",
};

const WORKSPACE_ADMIN_ONLY_ACTIONS = new Set<AdminOpsAction>([
  "get_workspace_settings",
  "update_workspace_settings",
  "get_status_tracking",
  "get_workspace_dashboard",
  "bulk_import_gear",
]);

const SUSPENDED_TENANT_WRITE_ACTIONS = new Set<AdminOpsAction>([
  "update_workspace_settings",
  "revoke_session",
  "revoke_current_session",
  "revoke_all_sessions",
  "bulk_import_gear",
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
  if (input.action === "update_workspace_settings") {
    try {
      const hasStepUp = await hasPrivilegedStepUp(input.adminClient, {
        userId: input.userId,
        roleScope: "workspace_admin",
        authToken: input.authToken,
      });
      if (!hasStepUp) {
        return input.jsonResponse(403, {
          error: "Admin verification required.",
        });
      }
    } catch (error) {
      if (
        isMissingPrivilegedStepUpTable(
          error as { code?: string; message?: string },
        )
      ) {
        return input.jsonResponse(503, {
          error:
            "Privileged verification controls unavailable. Run latest SQL setup.",
        });
      }
      throw error;
    }
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
  bulk_import_gear: handleBulkGearAction,
};

export const dispatchAdminOpsAction = (context: AdminOpsContext) => {
  const handler = ACTION_HANDLERS[context.action as AdminOpsAction];
  return handler
    ? handler(context)
    : Promise.resolve(context.jsonResponse(400, { error: "Invalid action" }));
};
