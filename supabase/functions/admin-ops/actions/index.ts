import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../../_shared/privilegedStepUp.ts";
import type {
  AdminOpsContext,
  JsonResponse,
  SupabaseClient,
} from "../context.ts";
import { handleNotificationAction } from "./notifications.ts";

export const ADMIN_OPS_ACTIONS = [
  "get_notifications",
  "get_tenant_settings",
  "update_tenant_settings",
  "get_status_tracking",
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
  get_tenant_settings: "settings",
  update_tenant_settings: "settings",
  get_status_tracking: "statusTracking",
  touch_session: "sessions",
  validate_session: "sessions",
  list_sessions: "sessions",
  revoke_session: "sessions",
  revoke_current_session: "sessions",
  revoke_all_sessions: "sessions",
  bulk_import_gear: "bulkGear",
};

const TENANT_ADMIN_ACTIONS = new Set<AdminOpsAction>(
  ADMIN_OPS_ACTIONS.filter((action) => action !== "get_notifications"),
);

const SUSPENDED_TENANT_WRITE_ACTIONS = new Set<AdminOpsAction>([
  "update_tenant_settings",
  "revoke_session",
  "revoke_current_session",
  "revoke_all_sessions",
  "bulk_import_gear",
]);

const isAdminOpsAction = (action: string): action is AdminOpsAction =>
  (ADMIN_OPS_ACTIONS as readonly string[]).includes(action);

export const authorizeAdminOpsAction = async (input: {
  action: string;
  profileRole: "tenant_admin" | "tenant_user";
  isTenantSuspended: boolean;
  adminClient: SupabaseClient;
  userId: string;
  authToken: string;
  jsonResponse: JsonResponse;
}): Promise<Response | null> => {
  if (!isAdminOpsAction(input.action)) return null;
  if (
    TENANT_ADMIN_ACTIONS.has(input.action) &&
    input.profileRole !== "tenant_admin"
  ) {
    return input.jsonResponse(403, { error: "Access denied" });
  }
  if (
    SUSPENDED_TENANT_WRITE_ACTIONS.has(input.action) &&
    input.isTenantSuspended
  ) {
    return input.jsonResponse(403, { error: "Tenant disabled" });
  }
  if (input.action === "update_tenant_settings") {
    try {
      const hasStepUp = await hasPrivilegedStepUp(input.adminClient, {
        userId: input.userId,
        roleScope: "tenant_admin",
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
};

export const dispatchAdminOpsAction = (context: AdminOpsContext) => {
  const handler = ACTION_HANDLERS[context.action as AdminOpsAction];
  return handler
    ? handler(context)
    : Promise.resolve(context.jsonResponse(400, { error: "Invalid action" }));
};
