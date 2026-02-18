import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
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
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
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
      .select("role, auth_email")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "super_admin",
        p_limit: 30,
        p_window_seconds: 60,
      }
    );

    if (!rateLimitError) {
      const rateLimitResult = rateLimit as RateLimitResult;
      if (!rateLimitResult.allowed) {
        return jsonResponse(429, {
          error: "Rate limit exceeded, please try again in a minute.",
        });
      }
    }

    const { action, payload } = await req.json();
    if (typeof action !== "string") {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const writeAudit = async (
      actionType: string,
      targetType: string,
      targetId: string | null,
      metadata: Record<string, unknown>
    ) => {
      await adminClient.from("super_admin_audit_logs").insert({
        actor_id: user.id,
        actor_email: profile.auth_email ?? user.email ?? null,
        action_type: actionType,
        target_type: targetType,
        target_id: targetId,
        metadata,
      });
    };

    if (action === "get_control_center") {
      const [
        runtimeConfigResult,
        alertRulesResult,
        approvalsResult,
        jobsResult,
      ] = await Promise.all([
        adminClient.from("app_runtime_config").select("key, value"),
        adminClient
          .from("super_alert_rules")
          .select("id, name, metric_key, threshold, is_enabled, created_at")
          .order("created_at", { ascending: false }),
        adminClient
          .from("super_approvals")
          .select("id, action_type, payload, requested_by, approved_by, status, created_at, decided_at")
          .order("created_at", { ascending: false })
          .limit(50),
        adminClient
          .from("super_jobs")
          .select("id, job_type, status, details, created_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(50),
      ]);

      if (runtimeConfigResult.error || alertRulesResult.error || approvalsResult.error || jobsResult.error) {
        return jsonResponse(400, { error: "Unable to load control center." });
      }

      const runtimeConfig = Object.fromEntries(
        (runtimeConfigResult.data ?? []).map((item) => [item.key, item.value])
      );

      return jsonResponse(200, {
        data: {
          runtime_config: runtimeConfig,
          alert_rules: alertRulesResult.data ?? [],
          approvals: approvalsResult.data ?? [],
          jobs: jobsResult.data ?? [],
        },
      });
    }

    if (action === "set_runtime_config") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const key = typeof next.key === "string" ? next.key.trim() : "";
      const value = next.value ?? {};
      if (!key) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("app_runtime_config")
        .upsert({ key, value, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "key" })
        .select("key, value")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to save runtime config." });
      }

      await writeAudit("set_runtime_config", "config", key, { key });

      return jsonResponse(200, { data });
    }

    if (action === "upsert_alert_rule") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const id = typeof next.id === "string" ? next.id.trim() : "";
      const name = typeof next.name === "string" ? next.name.trim() : "";
      const metricKey = typeof next.metric_key === "string" ? next.metric_key.trim() : "";
      const threshold = Number(next.threshold);
      const isEnabled = next.is_enabled !== false;
      if (!name || !metricKey || !Number.isFinite(threshold)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const payloadRow = {
        ...(id ? { id } : {}),
        name,
        metric_key: metricKey,
        threshold,
        is_enabled: isEnabled,
        created_by: user.id,
      };

      const { data, error } = await adminClient
        .from("super_alert_rules")
        .upsert(payloadRow)
        .select("id, name, metric_key, threshold, is_enabled, created_at")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to save alert rule." });
      }

      await writeAudit("upsert_alert_rule", "alert_rule", data.id, {
        metric_key: data.metric_key,
        threshold: data.threshold,
      });

      return jsonResponse(200, { data });
    }

    if (action === "set_tenant_policy") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const tenantId = typeof next.tenant_id === "string" ? next.tenant_id.trim() : "";
      if (!tenantId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const row = {
        tenant_id: tenantId,
        max_admins: typeof next.max_admins === "number" ? next.max_admins : null,
        max_students: typeof next.max_students === "number" ? next.max_students : null,
        max_gear: typeof next.max_gear === "number" ? next.max_gear : null,
        barcode_pattern:
          typeof next.barcode_pattern === "string" && next.barcode_pattern.trim()
            ? next.barcode_pattern.trim()
            : null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await adminClient
        .from("tenant_policies")
        .upsert(row, { onConflict: "tenant_id" })
        .select("tenant_id, max_admins, max_students, max_gear, barcode_pattern")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to save tenant policy." });
      }

      await writeAudit("set_tenant_policy", "tenant_policy", tenantId, data as Record<string, unknown>);
      return jsonResponse(200, { data });
    }

    if (action === "set_tenant_force_reauth") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const tenantId = typeof next.tenant_id === "string" ? next.tenant_id.trim() : "";
      if (!tenantId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const forceAt = new Date().toISOString();
      const { error } = await adminClient
        .from("tenant_security_controls")
        .upsert({
          tenant_id: tenantId,
          force_reauth_after: forceAt,
          updated_by: user.id,
          updated_at: forceAt,
        }, { onConflict: "tenant_id" });

      if (error) {
        return jsonResponse(400, { error: "Unable to force tenant re-login." });
      }

      const { data: job } = await adminClient
        .from("super_jobs")
        .insert({
          job_type: "force_tenant_reauth",
          status: "completed",
          details: { tenant_id: tenantId, force_reauth_after: forceAt },
          created_by: user.id,
        })
        .select("id, job_type, status, details, created_at, updated_at")
        .single();

      await writeAudit("force_tenant_reauth", "tenant", tenantId, {
        force_reauth_after: forceAt,
      });

      return jsonResponse(200, { data: { success: true, job } });
    }

    if (action === "create_approval") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const actionType = typeof next.action_type === "string" ? next.action_type.trim() : "";
      const approvalPayload = (next.payload ?? {}) as Record<string, unknown>;
      if (!actionType) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("super_approvals")
        .insert({
          action_type: actionType,
          payload: approvalPayload,
          requested_by: user.id,
          status: "pending",
        })
        .select("id, action_type, payload, requested_by, status, created_at")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to create approval request." });
      }

      await writeAudit("create_approval", "approval", data.id, {
        action_type: actionType,
      });

      return jsonResponse(200, { data });
    }

    if (action === "approve_request") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const id = typeof next.id === "string" ? next.id.trim() : "";
      if (!id) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data: approval, error: approvalError } = await adminClient
        .from("super_approvals")
        .select("id, requested_by, status")
        .eq("id", id)
        .single();

      if (approvalError || !approval?.id) {
        return jsonResponse(400, { error: "Approval request not found." });
      }
      if (approval.requested_by === user.id) {
        return jsonResponse(403, { error: "Requester cannot self-approve." });
      }
      if (approval.status !== "pending") {
        return jsonResponse(400, { error: "Approval request is already resolved." });
      }

      const { data, error } = await adminClient
        .from("super_approvals")
        .update({
          status: "approved",
          approved_by: user.id,
          decided_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id, action_type, payload, requested_by, approved_by, status, created_at, decided_at")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to approve request." });
      }

      await writeAudit("approve_request", "approval", id, {});
      return jsonResponse(200, { data });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("super-ops function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
