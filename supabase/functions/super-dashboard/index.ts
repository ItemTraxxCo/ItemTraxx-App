import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PostgrestError } from "https://esm.sh/@supabase/supabase-js@2";
import { getRequestId, logError } from "../_shared/observability.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && allowedOrigins.includes(origin as string));

  const headers =
    hasOrigin && originAllowed
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const isMissingColumn = (error: PostgrestError | null, column: string) =>
  !!error &&
  error.code === "42703" &&
  error.message.toLowerCase().includes(column.toLowerCase());
const isMissingRelation = (error: PostgrestError | null, relation: string) =>
  !!error &&
  error.code === "42P01" &&
  error.message.toLowerCase().includes(relation.toLowerCase());

type TenantMetricRow = {
  tenant_id: string;
  tenant_name: string;
  gear_total: number;
  students_total: number;
  active_checkouts: number;
  overdue_items: number;
  transactions_7d: number;
  computed_at?: string;
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);
  const requestId = getRequestId(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
    });

  if (req.method === "OPTIONS") {
    if (!originAllowed) {
      return new Response("Origin not allowed", { status: 403, headers });
    }
    return new Response("ok", { headers });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const totalTenantsResult = await adminClient
      .from("tenants")
      .select("id", { count: "exact", head: true });
    const totalTenants =
      totalTenantsResult.error === null ? totalTenantsResult.count ?? 0 : 0;

    let activeTenants = totalTenants;
    let suspendedTenants = 0;
    const activeResult = await adminClient
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    const suspendedResult = await adminClient
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .eq("status", "suspended");
    if (!activeResult.error && !suspendedResult.error) {
      activeTenants = activeResult.count ?? 0;
      suspendedTenants = suspendedResult.count ?? 0;
    } else if (
      !isMissingColumn(activeResult.error, "status") ||
      !isMissingColumn(suspendedResult.error, "status")
    ) {
      activeTenants = 0;
      suspendedTenants = 0;
    }

    let tenantAdminsCount = 0;
    const activeAdminsResult = await adminClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "tenant_admin")
      .neq("is_active", false);
    if (!activeAdminsResult.error) {
      tenantAdminsCount = activeAdminsResult.count ?? 0;
    } else if (isMissingColumn(activeAdminsResult.error, "is_active")) {
      const adminsFallbackResult = await adminClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "tenant_admin");
      if (!adminsFallbackResult.error) {
        tenantAdminsCount = adminsFallbackResult.count ?? 0;
      }
    }

    let recentActions: unknown[] = [];
    const recentActionsResult = await adminClient
      .from("super_admin_audit_logs")
      .select(
        "id, actor_id, actor_email, action_type, target_type, target_id, metadata, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(20);
    if (!recentActionsResult.error) {
      recentActions = recentActionsResult.data ?? [];
    }

    const [runtimeResult, alertRulesResult, approvalsResult, jobsResult] =
      await Promise.all([
        adminClient.from("app_runtime_config").select("key, value"),
        adminClient
          .from("super_alert_rules")
          .select("id, name, metric_key, threshold, is_enabled")
          .eq("is_enabled", true),
        adminClient
          .from("super_approvals")
          .select("id, action_type, status, created_at, requested_by")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(20),
        adminClient
          .from("super_jobs")
          .select("id, job_type, status, details, created_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(20),
      ]);

    const runtimeConfig = runtimeResult.error
      ? {}
      : Object.fromEntries((runtimeResult.data ?? []).map((item) => [item.key, item.value]));

    let tenantMetrics: TenantMetricRow[] = [];

    const tenantMetricsResult = await adminClient
      .from("super_reporting_tenant_metrics")
      .select(
        "tenant_id, tenant_name, gear_total, students_total, active_checkouts, overdue_items, transactions_7d, computed_at"
      )
      .order("tenant_name", { ascending: true });
    if (!tenantMetricsResult.error) {
      tenantMetrics = (tenantMetricsResult.data ?? []) as TenantMetricRow[];
    } else if (
      !isMissingRelation(tenantMetricsResult.error, "super_reporting_tenant_metrics")
    ) {
      logError(
        "super-dashboard tenant metrics query failed",
        requestId,
        tenantMetricsResult.error
      );
    }

    const alerts: Array<{ id: string; name: string; metric_key: string; threshold: number; current: number; severity: "warn" | "critical" }> = [];
    const aggregate = {
      suspended_tenants: suspendedTenants,
      overdue_items: tenantMetrics.reduce(
        (acc, metric) => acc + Number(metric.overdue_items ?? 0),
        0
      ),
      active_checkouts: tenantMetrics.reduce(
        (acc, metric) => acc + Number(metric.active_checkouts ?? 0),
        0
      ),
      transactions_7d: tenantMetrics.reduce(
        (acc, metric) => acc + Number(metric.transactions_7d ?? 0),
        0
      ),
    };

    if (!alertRulesResult.error) {
      for (const rule of (alertRulesResult.data ?? []) as Array<{ id: string; name: string; metric_key: keyof typeof aggregate; threshold: number }>) {
        const current = Number(aggregate[rule.metric_key] ?? 0);
        if (current >= Number(rule.threshold)) {
          alerts.push({
            id: rule.id,
            name: rule.name,
            metric_key: rule.metric_key,
            threshold: Number(rule.threshold),
            current,
            severity: current >= Number(rule.threshold) * 1.5 ? "critical" : "warn",
          });
        }
      }
    }

    return jsonResponse(200, {
      data: {
        total_tenants: totalTenants,
        active_tenants: activeTenants,
        suspended_tenants: suspendedTenants,
        tenant_admins_count: tenantAdminsCount,
        recent_actions: recentActions,
        tenant_metrics: tenantMetrics,
        alert_events: alerts,
        runtime_config: runtimeConfig,
        pending_approvals: approvalsResult.error ? [] : approvalsResult.data ?? [],
        jobs: jobsResult.error ? [] : jobsResult.data ?? [],
      },
    });
  } catch (error) {
    logError("super-dashboard function error", requestId, error);
    return jsonResponse(500, { error: "Request failed" });
  }
});
