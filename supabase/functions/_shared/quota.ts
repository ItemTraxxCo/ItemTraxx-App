type QuotaError = {
  message?: string | null;
  details?: string | null;
};

export type QuotaLimit = {
  resource: "items" | "borrowers";
  current: number;
  maximum: number;
};

// The shared helper intentionally accepts either Supabase client flavor used
// by the Edge Functions. Keeping this boundary structural would recursively
// instantiate the full generated PostgREST query-builder type.
type QuotaClient = any;

export const preflightQuota = async (
  client: QuotaClient,
  workspaceId: string,
  resource: "items" | "borrowers",
  requested: number,
): Promise<QuotaLimit | null> => {
  if (requested <= 0) return null;
  const policyColumn = resource === "items" ? "max_items" : "max_borrowers";
  const usageColumn = resource === "items" ? "active_items" : "active_borrowers";
  const [policyResult, usageResult] = await Promise.all([
    client.from("workspace_policies").select(policyColumn).eq("workspace_id", workspaceId).maybeSingle(),
    client.from("workspace_usage").select(usageColumn).eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  if (policyResult.error || usageResult.error) {
    throw new Error("Unable to verify plan capacity.");
  }
  const maximum = policyResult.data?.[policyColumn];
  const current = usageResult.data?.[usageColumn];
  if (typeof maximum !== "number") return null;
  const currentCount = typeof current === "number" ? current : 0;
  return currentCount + requested > maximum
    ? { resource, current: currentCount, maximum }
    : null;
};

export const quotaPreflightResponse = (
  limit: QuotaLimit,
  jsonResponse: (status: number, body: Record<string, unknown>) => Response,
) => {
  const label = limit.resource === "items" ? "item" : "borrower";
  return jsonResponse(409, {
    error: `This import would exceed your plan's active ${label} limit. Archive existing ${label}s, reduce the import, or contact support to change plans.`,
    code: "plan_limit_reached",
    ...limit,
  });
};

export const readQuotaLimit = (error: QuotaError | null | undefined): QuotaLimit | null => {
  const message = error?.message ?? "";
  if (message !== "ITEMS_LIMIT_REACHED" && message !== "BORROWERS_LIMIT_REACHED") {
    return null;
  }
  try {
    const detail = JSON.parse(error?.details ?? "{}") as Partial<QuotaLimit>;
    if (
      (detail.resource === "items" || detail.resource === "borrowers") &&
      typeof detail.current === "number" &&
      typeof detail.maximum === "number"
    ) {
      return detail as QuotaLimit;
    }
  } catch {
    // Fall through to a safe resource-specific response.
  }
  return {
    resource: message.startsWith("ITEMS") ? "items" : "borrowers",
    current: 0,
    maximum: 0,
  };
};

export const quotaLimitResponse = (
  error: QuotaError | null | undefined,
  jsonResponse: (status: number, body: Record<string, unknown>) => Response,
) => {
  const limit = readQuotaLimit(error);
  if (!limit) return null;
  const label = limit.resource === "items" ? "item" : "borrower";
  return jsonResponse(409, {
    error: `Your plan's active ${label} limit has been reached. Archive an existing ${label} or contact support to change plans.`,
    code: "plan_limit_reached",
    resource: limit.resource,
    current: limit.current,
    maximum: limit.maximum,
  });
};
