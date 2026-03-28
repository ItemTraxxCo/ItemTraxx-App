import { authenticatedSelect } from "./authenticatedDataClient";
import { getAuthState } from "../store/authState";

export type AdminAuditLog = {
  id: string;
  tenant_id: string;
  actor_id: string;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_profile?: { auth_email: string | null } | null;
};

type ActorProfileRow = {
  id: string;
  auth_email: string | null;
};

export const fetchAdminAuditLogs = async (): Promise<AdminAuditLog[]> => {
  const tenantId = getAuthState().tenantContextId;
  if (!tenantId) {
    throw new Error("Missing tenant context.");
  }

  const data = await authenticatedSelect<AdminAuditLog[]>("admin_audit_logs", {
    select: "id,tenant_id,actor_id,action_type,entity_type,entity_id,metadata,created_at",
    tenant_id: `eq.${tenantId}`,
    order: "created_at.desc",
    limit: "200",
  }).catch(() => null);

  if (!data) {
    throw new Error("Unable to load admin audit logs.");
  }

  const logs = data ?? [];

  const actorIds = Array.from(new Set(logs.map((log) => log.actor_id)));
  if (actorIds.length === 0) return logs;

  const profiles = await authenticatedSelect<ActorProfileRow[]>("profiles", {
    select: "id,auth_email",
    id: `in.(${actorIds.join(",")})`,
  }).catch(() => null);

  if (!profiles) {
    return logs;
  }

  const profileRows = profiles ?? [];
  const emailById = new Map<string, string | null>(
    profileRows.map((row) => [row.id, row.auth_email])
  );

  return logs.map((log) => ({
    ...log,
    actor_profile: { auth_email: emailById.get(log.actor_id) ?? null },
  }));
};
