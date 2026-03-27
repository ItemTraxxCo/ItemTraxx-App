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
  if (!auth.tenantContextId) {
    throw new Error("Missing tenant context.");
  }

  await authenticatedInsert("admin_audit_logs", {
    tenant_id: auth.tenantContextId,
    actor_id: auth.userId,
    action_type: payload.action_type,
    entity_type: payload.entity_type ?? null,
    entity_id: payload.entity_id ?? null,
    metadata: payload.metadata ?? null,
  });
};
