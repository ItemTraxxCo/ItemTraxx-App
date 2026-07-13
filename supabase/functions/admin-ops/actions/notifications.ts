import type { AdminOpsContext, RuntimeUpdateItem } from "../context.ts";

export const handleNotificationAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
  const dueCutoffIso = new Date(
    Date.now() - context.checkoutDueHours * 60 * 60 * 1000,
  ).toISOString();

  const [statusCountResult, recentStatusResult, overdueCountResult] =
    await Promise.all([
      context.adminClient
        .from("gear")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .is("deleted_at", null)
        .not("status", "in", "(available,checked_out)"),
      context.adminClient
        .from("gear_status_history")
        .select("id, status, changed_at, gear:gear_id(name, barcode)")
        .eq("tenant_id", context.tenantId)
        .order("changed_at", { ascending: false })
        .limit(8),
      context.adminClient
        .from("gear")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .is("deleted_at", null)
        .not("checked_out_by", "is", null)
        .lte("checked_out_at", dueCutoffIso),
    ]);

  return context.jsonResponse(200, {
    data: {
      overdue_count: overdueCountResult.error
        ? 0
        : overdueCountResult.count ?? 0,
      flagged_count: statusCountResult.error ? 0 : statusCountResult.count ?? 0,
      maintenance: context.maintenance,
      recent_status_events: recentStatusResult.error
        ? []
        : recentStatusResult.data ?? [],
      updates: context.tenantUpdates,
      checkout_due_hours: context.checkoutDueHours,
      feature_flags: context.featureFlags,
    },
  });
};

export const normalizeTenantUpdates = (value: unknown): RuntimeUpdateItem[] => {
  if (!value || typeof value !== "object") return [];
  const payload = value as Record<string, unknown>;
  if (payload.enabled === false || !Array.isArray(payload.items)) return [];
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
        : new Date().toISOString();
      const id = typeof row.id === "string" && row.id
        ? row.id
        : `${createdAt}-${index}`;
      return {
        id,
        title: title || "Product update",
        message,
        level,
        created_at: createdAt,
        link_url: typeof row.link_url === "string" && row.link_url.trim()
          ? row.link_url.trim()
          : null,
      } as RuntimeUpdateItem;
    })
    .filter((item): item is RuntimeUpdateItem => !!item)
    .slice(0, 5);
};

export const resolveMaintenance = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return { enabled: false, message: "" };
  }
  const payload = value as Record<string, unknown>;
  return {
    enabled: payload.enabled === true,
    message: typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "Maintenance in progress.",
  };
};
