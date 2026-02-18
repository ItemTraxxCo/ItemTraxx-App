import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PostgrestError } from "https://esm.sh/@supabase/supabase-js@2";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
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

    const isMissingColumn = (error: PostgrestError | null, column: string) =>
      !!error &&
      error.code === "42703" &&
      error.message.toLowerCase().includes(column.toLowerCase());
    const isMissingRelation = (error: PostgrestError | null, relation: string) =>
      !!error &&
      error.code === "42P01" &&
      error.message.toLowerCase().includes(relation.toLowerCase());

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
      // Keep dashboard available even when tenant status metrics cannot be loaded.
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
    } else {
      tenantAdminsCount = 0;
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
    } else if (!isMissingRelation(recentActionsResult.error, "super_admin_audit_logs")) {
      recentActions = [];
    }

    return jsonResponse(200, {
      data: {
        total_tenants: totalTenants,
        active_tenants: activeTenants,
        suspended_tenants: suspendedTenants,
        tenant_admins_count: tenantAdminsCount,
        recent_actions: recentActions,
      },
    });
  } catch (error) {
    console.error("super-dashboard function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
