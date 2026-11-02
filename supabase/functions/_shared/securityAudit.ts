import { emitAuditEvents, emitEnumerationTripwire } from "./observability.ts";

export type SecurityAuditEntry = {
  actor_id: string;
  workspace_id: string;
  action: string;
  target_type: string;
  target_resource_id: string;
  route: string;
  method: string;
  request_id: string;
};

export type SecurityAuditWriteOptions = {
  request?: Request;
  httpStatus?: number;
};

export const classifySecurityAuditTargets = (
  itemIds: string[],
  returnedItemIds: string[],
  visibleIds: Set<string>,
  actorWorkspaceId: string,
  targetWorkspaceById: Map<string, string>,
) => {
  const itemIdSet = new Set(itemIds);
  const returnedIds = new Set(returnedItemIds.filter((id) => itemIdSet.has(id)));
  const visibleTargetIds = itemIds.filter((id) => visibleIds.has(id));
  const deniedTargetIds = itemIds.filter((id) => !visibleIds.has(id));
  const confirmedUnauthorizedTargetIds = [...returnedIds].filter((id) =>
    !visibleIds.has(id) &&
    targetWorkspaceById.has(id) &&
    targetWorkspaceById.get(id) !== actorWorkspaceId
  );
  return {
    visibleTargetIds,
    deniedTargetIds,
    confirmedUnauthorizedTargetIds,
  };
};

type AuditClient = {
  rpc?: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data?: unknown;
    error: { code?: string } | null;
  }>;
  from: (table: string) => {
    insert: (rows: SecurityAuditEntry[]) => PromiseLike<{
      error: { code?: string } | null;
    }>;
  };
};

/**
 * Store immutable, server-authored audit rows and emit a privacy-preserving
 * PostHog signal. PostHog receives keyed hashes; the database row keeps the
 * actor, workspace, and resource UUIDs needed for an investigation.
 */
export const writeSecurityAuditEntries = async (
  rawClient: unknown,
  entries: SecurityAuditEntry[],
  options: SecurityAuditWriteOptions = {},
) => {
  if (!entries.length) return true;
  const client = rawClient as AuditClient;
  let succeeded = true;
  for (let offset = 0; offset < entries.length; offset += 250) {
    const batch = entries.slice(offset, offset + 250);
    let error: { code?: string } | null = null;
    let tripwireCount = 0;
    try {
      if (client.rpc) {
        const result = await client.rpc("append_security_audit_entries", {
          p_entries: batch,
        });
        error = result.error;
        const firstResult = Array.isArray(result.data)
          ? result.data[0]
          : result.data;
        if (
          firstResult && typeof firstResult === "object" &&
          (firstResult as Record<string, unknown>).enumeration_tripwire === true &&
          typeof (firstResult as Record<string, unknown>).distinct_target_count === "number"
        ) {
          tripwireCount = (firstResult as Record<string, unknown>).distinct_target_count as number;
        }
      } else {
        const result = await client.from("security_audit_logs").insert(batch);
        error = result.error;
      }
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause &&
          typeof cause.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(cause.code)
        ? cause.code
        : "audit_insert_failed";
      error = { code };
    }
    if (error) {
      succeeded = false;
      const code = typeof error.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code)
        ? error.code
        : "audit_insert_failed";
      console.error(JSON.stringify({
        event: "security_audit.write_failed",
        level: "error",
        error_code: code,
        request_id: batch[0]?.request_id,
        service: "itemtraxx-supabase-functions",
      }));
      continue;
    }
    emitAuditEvents(batch.map((entry) => ({
        actorId: entry.actor_id,
        workspaceId: entry.workspace_id,
        targetResourceId: entry.target_resource_id,
        targetType: entry.target_type,
        action: entry.action,
        requestId: entry.request_id,
        route: entry.route,
        method: entry.method,
      })));
    if (tripwireCount > 15 && batch[0]) {
      emitEnumerationTripwire({
        actorId: batch[0].actor_id,
        workspaceId: batch[0].workspace_id,
        requestId: batch[0].request_id,
        route: batch[0].route,
        distinctTargetCount: tripwireCount,
        request: options.request,
        httpStatus: options.httpStatus,
      });
    }
  }
  return succeeded;
};
