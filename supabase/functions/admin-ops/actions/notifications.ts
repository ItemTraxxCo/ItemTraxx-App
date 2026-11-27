import type { AdminOpsContext, RuntimeUpdateItem } from "../context.ts";
import { isMissingPostgrestRelation } from "../../_shared/postgrestErrors.ts";

/**
 * Item statuses that need an admin to act on them. Terminal or intentional
 * states such as `retired` and `in_studio_only` are deliberately excluded so
 * the notification count can reach zero once real follow-ups are resolved.
 */
export const FOLLOW_UP_STATUSES = ["damaged", "lost", "in_repair"] as const;

type QueryError = { code?: string; message?: string } | null | undefined;

export const handleNotificationAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
  const dueCutoffIso = new Date(
    Date.now() - context.checkoutDueHours * 60 * 60 * 1000,
  ).toISOString();

  const [statusCountResult, recentStatusResult, overdueCountResult] =
    await Promise.all([
      context.adminClient
        .from("items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", context.workspaceId)
        .is("deleted_at", null)
        .in("status", [...FOLLOW_UP_STATUSES]),
      context.adminClient
        .from("item_status_history")
        .select(
          "id, item_id, status, note, changed_at, changed_by, item:item_id!inner(name, barcode, deleted_at)",
        )
        .eq("workspace_id", context.workspaceId)
        .is("item.deleted_at", null)
        .order("changed_at", { ascending: false })
        .limit(8),
      context.adminClient
        .from("items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", context.workspaceId)
        .is("deleted_at", null)
        .eq("status", "checked_out")
        .not("checked_out_by", "is", null)
        .lte("checked_out_at", dueCutoffIso),
    ]);

  // Report failures instead of masking them as "no notifications": a zeroed
  // payload is indistinguishable from an all-clear workspace.
  const failures: Array<[string, QueryError]> = [
    ["flagged_count", statusCountResult.error],
    ["recent_status_events", recentStatusResult.error],
    ["overdue_count", overdueCountResult.error],
  ];
  const failed = failures.find(([query, error]) => {
    if (!error) return false;
    // Older supported schemas may not have status history yet. Keep the
    // counts that did load instead of failing the entire notification feed.
    if (
      query === "recent_status_events" &&
      isMissingPostgrestRelation(error, "item_status_history")
    ) return false;
    return true;
  });
  if (failed) {
    console.error("admin-ops get_notifications query failed", {
      requestId: context.requestId,
      query: failed[0],
      code: failed[1]?.code ?? null,
    });
    return context.jsonResponse(500, {
      error: "Unable to load notifications.",
    });
  }

  const recentEvents = (recentStatusResult.data ?? []).map((row) => {
    const event = row as Record<string, unknown>;
    const item = event.item as Record<string, unknown> | null | undefined;
    return {
      id: event.id,
      item_id: event.item_id,
      status: event.status,
      note: event.note ?? null,
      changed_at: event.changed_at,
      changed_by: event.changed_by ?? null,
      item: item
        ? {
          name: typeof item.name === "string" ? item.name : "",
          barcode: typeof item.barcode === "string" ? item.barcode : "",
        }
        : null,
    };
  });

  return context.jsonResponse(200, {
    data: {
      overdue_count: overdueCountResult.count ?? 0,
      flagged_count: statusCountResult.count ?? 0,
      recent_status_events: recentEvents,
      updates: context.workspaceUpdates,
      checkout_due_hours: context.checkoutDueHours,
      feature_flags: context.featureFlags,
    },
  });
};

/**
 * Deterministic FNV-1a hash so updates stored without an explicit id keep the
 * same id across requests (a time-based fallback changed on every poll and
 * made the notification badge reappear).
 */
const stableHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const normalizeWorkspaceUpdates = (value: unknown): RuntimeUpdateItem[] => {
  if (!value || typeof value !== "object") return [];
  const payload = value as Record<string, unknown>;
  if (payload.enabled === false || !Array.isArray(payload.items)) return [];
  const fallbackCreatedAt = typeof payload.updated_at === "string" && payload.updated_at
    ? payload.updated_at
    : new Date(0).toISOString();
  return payload.items
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const row = item as Record<string, unknown>;
      const message = typeof row.message === "string" ? row.message.trim() : "";
      const title = typeof row.title === "string" ? row.title.trim() : "";
      if (!message) return null;
      const level = row.level === "warning" || row.level === "critical"
        ? row.level
        : "info";
      const createdAt = typeof row.created_at === "string" && row.created_at
        ? row.created_at
        : fallbackCreatedAt;
      const id = typeof row.id === "string" && row.id
        ? row.id
        : `update-${stableHash(`${index}|${title}|${message}`)}`;
      // Only https links are rendered as clickable in the workspace UI.
      const rawLink = typeof row.link_url === "string" ? row.link_url.trim() : "";
      return {
        id,
        title: title || "Product update",
        message,
        level,
        created_at: createdAt,
        link_url: /^https:\/\/\S+$/i.test(rawLink) ? rawLink : null,
      } as RuntimeUpdateItem;
    })
    .filter((item): item is RuntimeUpdateItem => !!item)
    .slice(0, 5);
};
