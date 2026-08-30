type AuditClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{
      error: { message?: string } | null;
    }>;
  };
};

export type SuperAdminAuditInput = {
  actorId: string;
  actorEmail?: string | null;
  actionType: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Persist a privileged mutation in the dedicated security audit feed.
 * Callers intentionally receive an exception when the write fails so a
 * successful mutation is never reported without its audit record.
 */
export const writeSuperAdminAudit = async (
  adminClient: AuditClient,
  input: SuperAdminAuditInput,
) => {
  const { error } = await adminClient.from("super_admin_audit_logs").insert({
    actor_id: input.actorId,
    actor_email: input.actorEmail ?? null,
    action_type: input.actionType,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) {
    throw new Error("Unable to write Super Admin audit log.");
  }
};
