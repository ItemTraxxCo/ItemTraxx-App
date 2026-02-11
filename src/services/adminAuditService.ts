import { supabase } from "./supabaseClient";

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
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select(
      `
        id,
        tenant_id,
        actor_id,
        action_type,
        entity_type,
        entity_id,
        metadata,
        created_at
      `
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error("Unable to load admin audit logs.");
  }

  const logs = (data ?? []) as AdminAuditLog[];

  const actorIds = Array.from(new Set(logs.map((log) => log.actor_id)));
  if (actorIds.length === 0) return logs;

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, auth_email")
    .in("id", actorIds);

  if (profileError) {
    return logs;
  }

  const profileRows = (profiles ?? []) as ActorProfileRow[];
  const emailById = new Map<string, string | null>(
    profileRows.map((row) => [row.id, row.auth_email])
  );

  return logs.map((log) => ({
    ...log,
    actor_profile: { auth_email: emailById.get(log.actor_id) ?? null },
  }));
};
