import { authenticatedInsert } from "./authenticatedDataClient";
import { getAuthState } from "../store/authState";

export type AuditLogPayload = {
  action_type: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
};

export const logAdminAction = async (payload: AuditLogPayload) => {
  const auth = getAuthState();
  if (!auth.workspaceContextId || !auth.userId) {
    throw new Error("Missing required authenticated audit context. Please try signing out and in again. If error persists, please contact support.");
  }

  await authenticatedInsert("admin_audit_logs", {
    workspace_id: auth.workspaceContextId,
    actor_id: auth.userId,
    action_type: payload.action_type,
    entity_type: payload.entity_type ?? null,
    entity_id: payload.entity_id ?? null,
    metadata: payload.metadata ?? null,
  });
};
