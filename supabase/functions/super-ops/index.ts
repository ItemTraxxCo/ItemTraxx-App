import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
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
    const authHeader =
      req.headers.get("x-itx-user-jwt") ?? req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    // Prefer ITX_* secrets, but fall back to Supabase default injected env vars.
    const supabaseUrl =
      Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(accessToken);

    if (authError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, auth_email")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await adminClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "super_admin",
        p_limit: 30,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.error("super-ops rate limit rpc failed", {
        code: rateLimitError.code,
        message: rateLimitError.message,
        details: rateLimitError.details,
      });
    } else {
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
        checkout_due_hours:
          typeof next.checkout_due_hours === "number"
            ? Math.min(720, Math.max(1, Math.round(next.checkout_due_hours)))
            : 72,
        barcode_pattern:
          typeof next.barcode_pattern === "string" && next.barcode_pattern.trim()
            ? next.barcode_pattern.trim()
            : null,
        feature_flags:
          next.feature_flags && typeof next.feature_flags === "object"
            ? (next.feature_flags as Record<string, unknown>)
            : {},
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await adminClient
        .from("tenant_policies")
        .upsert(row, { onConflict: "tenant_id" })
        .select(
          "tenant_id, max_admins, max_students, max_gear, checkout_due_hours, barcode_pattern, feature_flags"
        )
        .single();

      if (error || !data) {
        const message = (error?.message ?? "").toLowerCase();
        if (error?.code === "42703" && message.includes("feature_flags")) {
          const { data: fallbackData, error: fallbackError } = await adminClient
            .from("tenant_policies")
            .upsert(
              {
                tenant_id: tenantId,
                max_admins: row.max_admins,
                max_students: row.max_students,
                max_gear: row.max_gear,
                checkout_due_hours: row.checkout_due_hours,
                barcode_pattern: row.barcode_pattern,
                updated_by: row.updated_by,
                updated_at: row.updated_at,
              },
              { onConflict: "tenant_id" }
            )
            .select(
              "tenant_id, max_admins, max_students, max_gear, checkout_due_hours, barcode_pattern"
            )
            .single();
          if (fallbackError || !fallbackData) {
            return jsonResponse(400, { error: "Unable to save tenant policy." });
          }
          await writeAudit(
            "set_tenant_policy",
            "tenant_policy",
            tenantId,
            fallbackData as Record<string, unknown>
          );
          return jsonResponse(200, { data: fallbackData });
        }
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

    if (action === "list_sales_leads") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const search = typeof next.search === "string" ? next.search.trim() : "";
      const limitRaw = Number(next.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(200, Math.max(1, Math.round(limitRaw)))
        : 100;

      let query = adminClient
        .from("sales_leads")
        .select(
          "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at"
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,organization.ilike.%${search}%,reply_email.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) {
        return jsonResponse(400, { error: "Unable to load sales leads." });
      }

      return jsonResponse(200, {
        data: {
          leads: data ?? [],
        },
      });
    }

    if (action === "close_sales_lead") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const leadId = typeof next.lead_id === "string" ? next.lead_id.trim() : "";
      if (!leadId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("sales_leads")
        .update({
          lead_state: "closed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .select(
          "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at"
        )
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to close sales lead." });
      }

      await writeAudit("close_sales_lead", "sales_lead", leadId, {});
      return jsonResponse(200, { data: { lead: data } });
    }

    if (action === "move_sales_lead_to_customer") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const leadId = typeof next.lead_id === "string" ? next.lead_id.trim() : "";
      if (!leadId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("sales_leads")
        .update({
          lead_state: "converted_to_customer",
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .select(
          "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at"
        )
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to move lead to customers." });
      }

      await writeAudit("move_sales_lead_to_customer", "sales_lead", leadId, {});
      return jsonResponse(200, { data: { lead: data } });
    }

    if (action === "set_sales_lead_stage") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const leadId = typeof next.lead_id === "string" ? next.lead_id.trim() : "";
      const stage = typeof next.stage === "string" ? next.stage.trim() : "";
      const allowedStages = new Set([
        "waiting_for_quote",
        "quote_generated",
        "quote_sent",
        "quote_converted_to_invoice",
        "invoice_sent",
        "invoice_paid",
      ]);
      if (!leadId || !allowedStages.has(stage)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("sales_leads")
        .update({
          stage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .select(
          "id, plan, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at"
        )
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to update lead stage." });
      }

      await writeAudit("set_sales_lead_stage", "sales_lead", leadId, { stage });
      return jsonResponse(200, { data: { lead: data } });
    }

    if (action === "delete_sales_lead") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const leadId = typeof next.lead_id === "string" ? next.lead_id.trim() : "";
      if (!leadId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { error } = await adminClient
        .from("sales_leads")
        .delete()
        .eq("id", leadId);

      if (error) {
        return jsonResponse(400, { error: "Unable to delete sales lead." });
      }

      await writeAudit("delete_sales_lead", "sales_lead", leadId, {});
      return jsonResponse(200, { data: { deleted: true } });
    }

    if (action === "list_customers") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const search = typeof next.search === "string" ? next.search.trim() : "";
      const limitRaw = Number(next.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(300, Math.max(1, Math.round(limitRaw)))
        : 150;

      let leadQuery = adminClient
        .from("sales_leads")
        .select(
          "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, created_at, updated_at"
        )
        .eq("lead_state", "converted_to_customer")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (search) {
        leadQuery = leadQuery.or(
          `name.ilike.%${search}%,organization.ilike.%${search}%,reply_email.ilike.%${search}%`
        );
      }

      const { data: leads, error: leadError } = await leadQuery;
      if (leadError) {
        return jsonResponse(400, { error: "Unable to load customers." });
      }

      const leadIds = (leads ?? []).map((lead) => lead.id as string);
      const { data: statusLogs, error: statusError } = leadIds.length
        ? await adminClient
            .from("customer_status_logs")
            .select("id, lead_id, invoice_id, status, created_at, created_by")
            .in("lead_id", leadIds)
            .order("created_at", { ascending: false })
        : { data: [], error: null };

      if (statusError) {
        return jsonResponse(400, { error: "Unable to load customer status logs." });
      }

      const groupedLogs = new Map<
        string,
        Array<{
          id: string;
          lead_id: string;
          invoice_id: string;
          status: string;
          created_at: string;
          created_by: string | null;
        }>
      >();
      for (const row of (statusLogs ?? []) as Array<{
        id: string;
        lead_id: string;
        invoice_id: string;
        status: string;
        created_at: string;
        created_by: string | null;
      }>) {
        const list = groupedLogs.get(row.lead_id) ?? [];
        list.push(row);
        groupedLogs.set(row.lead_id, list);
      }

      const customers = (leads ?? []).map((lead) => {
        const logs = groupedLogs.get(lead.id as string) ?? [];
        const latest = logs[0] ?? null;
        return {
          ...lead,
          latest_status: latest?.status ?? null,
          latest_invoice_id: latest?.invoice_id ?? null,
          status_logs: logs,
        };
      });

      return jsonResponse(200, { data: { customers } });
    }

    if (action === "add_customer_status_entry") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const leadId = typeof next.lead_id === "string" ? next.lead_id.trim() : "";
      const invoiceId = typeof next.invoice_id === "string" ? next.invoice_id.trim() : "";
      const status = typeof next.status === "string" ? next.status.trim() : "";
      const allowedStatuses = new Set([
        "paid_on_time",
        "paid_late",
        "awaiting_payment",
        "canceling",
      ]);
      if (!leadId || !invoiceId || !allowedStatuses.has(status)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("customer_status_logs")
        .insert({
          lead_id: leadId,
          invoice_id: invoiceId,
          status,
          created_by: user.id,
        })
        .select("id, lead_id, invoice_id, status, created_at, created_by")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to add customer status entry." });
      }

      await writeAudit("add_customer_status_entry", "sales_lead", leadId, {
        invoice_id: invoiceId,
        status,
      });
      return jsonResponse(200, { data: { entry: data } });
    }

    if (action === "get_internal_ops_snapshot") {
      const nowIso = new Date().toISOString();
      const since15mIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [
        recentLogsResult,
        queueRowsResult,
        leadsResult,
        runtimeConfigResult,
        auditRowsResult,
        customerLeadRowsResult,
      ] = await Promise.all([
        adminClient
          .from("gear_logs")
          .select("tenant_id, gear_id, checked_out_by, action_type, action_time")
          .in("action_type", ["checkout", "return"])
          .gte("action_time", since24hIso)
          .order("action_time", { ascending: false })
          .limit(400),
        adminClient
          .from("async_jobs")
          .select("status, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        adminClient
          .from("sales_leads")
          .select("id, lead_state, stage, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        adminClient
          .from("app_runtime_config")
          .select("key, value")
          .in("key", ["maintenance_mode", "broadcast_message"]),
        adminClient
          .from("super_admin_audit_logs")
          .select("id, actor_email, action_type, target_type, target_id, metadata, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
        adminClient
          .from("sales_leads")
          .select("id, lead_state, created_at, updated_at")
          .eq("lead_state", "converted_to_customer")
          .order("created_at", { ascending: false })
          .limit(600),
      ]);

      if (recentLogsResult.error) {
        return jsonResponse(400, { error: "Unable to load recent traffic logs." });
      }
      if (queueRowsResult.error) {
        return jsonResponse(400, { error: "Unable to load async jobs." });
      }
      if (leadsResult.error) {
        return jsonResponse(400, { error: "Unable to load lead metrics." });
      }
      if (auditRowsResult.error) {
        return jsonResponse(400, { error: "Unable to load audit feed." });
      }
      if (customerLeadRowsResult.error) {
        return jsonResponse(400, { error: "Unable to load customer health metrics." });
      }

      const recentLogs = recentLogsResult.data ?? [];
      const logs15m = recentLogs.filter((row) => row.action_time >= since15mIso);
      const checkout15m = logs15m.filter((row) => row.action_type === "checkout").length;
      const return15m = logs15m.filter((row) => row.action_type === "return").length;
      const activeTenants15m = new Set(logs15m.map((row) => row.tenant_id)).size;

      const queueRows = queueRowsResult.data ?? [];
      const queueTotal = queueRows.length;
      const queueSummary = {
        queued: queueRows.filter((row) => row.status === "queued").length,
        processing: queueRows.filter((row) => row.status === "processing").length,
        completed: queueRows.filter((row) => row.status === "completed").length,
        failed: queueRows.filter((row) => row.status === "failed").length,
      };

      const leads = leadsResult.data ?? [];
      const leadSummary = {
        open: leads.filter((row) => row.lead_state === "open").length,
        closed: leads.filter((row) => row.lead_state === "closed").length,
        converted: leads.filter((row) => row.lead_state === "converted_to_customer").length,
        waiting_for_quote: leads.filter((row) => row.stage === "waiting_for_quote").length,
        quote_sent: leads.filter((row) => row.stage === "quote_sent").length,
        invoice_sent: leads.filter((row) => row.stage === "invoice_sent").length,
        invoice_paid: leads.filter((row) => row.stage === "invoice_paid").length,
      };

      const trafficHourKeys = Array.from({ length: 24 }, (_, offset) => {
        const date = new Date(Date.now() - (23 - offset) * 60 * 60 * 1000);
        date.setMinutes(0, 0, 0);
        return date.toISOString();
      });
      const trafficByHourMap = new Map(
        trafficHourKeys.map((iso) => [iso, { hour: iso, checkout: 0, return: 0 }])
      );
      for (const log of recentLogs) {
        const hourDate = new Date(log.action_time);
        hourDate.setMinutes(0, 0, 0);
        const hourKey = hourDate.toISOString();
        const bucket = trafficByHourMap.get(hourKey);
        if (!bucket) continue;
        if (log.action_type === "checkout") {
          bucket.checkout += 1;
        } else if (log.action_type === "return") {
          bucket.return += 1;
        }
      }

      const leadFunnel = {
        waiting_for_quote: leads.filter((row) => row.stage === "waiting_for_quote").length,
        quote_generated: leads.filter((row) => row.stage === "quote_generated").length,
        quote_sent: leads.filter((row) => row.stage === "quote_sent").length,
        quote_converted_to_invoice: leads.filter((row) => row.stage === "quote_converted_to_invoice").length,
        invoice_sent: leads.filter((row) => row.stage === "invoice_sent").length,
        invoice_paid: leads.filter((row) => row.stage === "invoice_paid").length,
      };

      const tenantIds = Array.from(
        new Set(recentLogs.map((row) => row.tenant_id).filter((value): value is string => !!value))
      );
      const gearIds = Array.from(
        new Set(recentLogs.map((row) => row.gear_id).filter((value): value is string => !!value))
      );
      const studentIds = Array.from(
        new Set(recentLogs.map((row) => row.checked_out_by).filter((value): value is string => !!value))
      );

      const [tenantRowsResult, gearRowsResult, studentRowsResult, allTenantsResult] = await Promise.all([
        tenantIds.length
          ? adminClient.from("tenants").select("id, name").in("id", tenantIds)
          : Promise.resolve({ data: [], error: null }),
        gearIds.length
          ? adminClient.from("gear").select("id, name, barcode").in("id", gearIds)
          : Promise.resolve({ data: [], error: null }),
        studentIds.length
          ? adminClient.from("students").select("id, username, student_id").in("id", studentIds)
          : Promise.resolve({ data: [], error: null }),
        adminClient
          .from("tenants")
          .select("id, name, active")
          .order("name", { ascending: true })
          .limit(300),
      ]);

      const tenantMap = new Map(
        (tenantRowsResult.data ?? []).map((tenant) => [tenant.id as string, tenant.name as string])
      );
      const gearMap = new Map(
        (gearRowsResult.data ?? []).map((gear) => [
          gear.id as string,
          { name: gear.name as string | null, barcode: gear.barcode as string | null },
        ])
      );
      const studentMap = new Map(
        (studentRowsResult.data ?? []).map((student) => [
          student.id as string,
          { username: student.username as string | null, student_id: student.student_id as string | null },
        ])
      );
      const allTenants = (allTenantsResult.data ?? []) as Array<{
        id: string;
        name: string;
        active: boolean | null;
      }>;

      const recentEvents = recentLogs.slice(0, 40).map((row) => {
        const gear = row.gear_id ? gearMap.get(row.gear_id) : null;
        const student = row.checked_out_by ? studentMap.get(row.checked_out_by) : null;
        return {
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_id ? tenantMap.get(row.tenant_id) ?? "Unknown tenant" : "Unknown tenant",
          action_type: row.action_type,
          action_time: row.action_time,
          gear_name: gear?.name ?? null,
          gear_barcode: gear?.barcode ?? null,
          student_username: student?.username ?? null,
          student_id: student?.student_id ?? null,
        };
      });

      const auditRows = (auditRowsResult.data ?? []) as Array<{
        id: string;
        actor_email: string | null;
        action_type: string;
        target_type: string | null;
        target_id: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>;

      const durationSamples = auditRows
        .map((row) => {
          const value = row.metadata?.duration_ms;
          return typeof value === "number" && Number.isFinite(value) ? value : null;
        })
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      const percentile = (values: number[], p: number) => {
        if (values.length === 0) return null;
        const idx = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * p)));
        return values[idx] ?? null;
      };
      const medianDuration = percentile(durationSamples, 0.5);
      const p95Duration = percentile(durationSamples, 0.95);

      const customerLeads = (customerLeadRowsResult.data ?? []) as Array<{
        id: string;
        lead_state: string;
        created_at: string;
        updated_at: string | null;
      }>;
      const customerLeadIds = customerLeads.map((row) => row.id);
      const { data: customerStatusRows, error: customerStatusError } = customerLeadIds.length
        ? await adminClient
            .from("customer_status_logs")
            .select("lead_id, status, created_at")
            .in("lead_id", customerLeadIds)
            .order("created_at", { ascending: false })
            .limit(2000)
        : { data: [], error: null };
      if (customerStatusError) {
        return jsonResponse(400, { error: "Unable to load customer status metrics." });
      }

      const latestStatusByLead = new Map<string, string>();
      for (const row of (customerStatusRows ?? []) as Array<{
        lead_id: string;
        status: string;
        created_at: string;
      }>) {
        if (!latestStatusByLead.has(row.lead_id)) {
          latestStatusByLead.set(row.lead_id, row.status);
        }
      }
      const customerHealth = {
        total_customers: customerLeads.length,
        awaiting_payment: 0,
        canceling: 0,
        paid_late: 0,
        paid_on_time: 0,
        no_status: 0,
      };
      for (const lead of customerLeads) {
        const status = latestStatusByLead.get(lead.id) ?? null;
        if (!status) {
          customerHealth.no_status += 1;
          continue;
        }
        if (status === "awaiting_payment") customerHealth.awaiting_payment += 1;
        if (status === "canceling") customerHealth.canceling += 1;
        if (status === "paid_late") customerHealth.paid_late += 1;
        if (status === "paid_on_time") customerHealth.paid_on_time += 1;
      }

      const staleOpenLeads = leads.filter((row) => {
        if (row.lead_state !== "open") return false;
        const createdAtMs = Date.parse(row.created_at);
        if (Number.isNaN(createdAtMs)) return false;
        return Date.now() - createdAtMs >= 48 * 60 * 60 * 1000;
      }).length;

      const needsAttention = [
        ...(queueSummary.failed > 0
          ? [{
              key: "failed_jobs",
              level: "high",
              title: "Failed async jobs",
              count: queueSummary.failed,
              route: "/super-admin/sales-leads",
            }]
          : []),
        ...(queueSummary.queued >= 15
          ? [{
              key: "queue_backlog",
              level: "medium",
              title: "Async queue backlog",
              count: queueSummary.queued,
              route: "/internal",
            }]
          : []),
        ...(staleOpenLeads > 0
          ? [{
              key: "stale_open_leads",
              level: "medium",
              title: "Open leads older than 48h",
              count: staleOpenLeads,
              route: "/super-admin/sales-leads",
            }]
          : []),
        ...(customerHealth.awaiting_payment + customerHealth.canceling > 0
          ? [{
              key: "customer_billing_risk",
              level: "high",
              title: "Customers requiring billing attention",
              count: customerHealth.awaiting_payment + customerHealth.canceling,
              route: "/super-admin/customers",
            }]
          : []),
      ];

      let statusProbeMs: number | null = null;
      try {
        const { data: statusData } = await adminClient.functions.invoke("system-status");
        if (statusData && typeof statusData === "object") {
          const durationMs = (statusData as Record<string, unknown>).duration_ms;
          if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
            statusProbeMs = durationMs;
          }
        }
      } catch (statusProbeError) {
        console.warn("super-ops status probe failed", statusProbeError);
      }

      const searchIndex = [
        { id: "cmd_internal_home", label: "Internal dashboard", type: "page", route: "/internal" },
        { id: "cmd_super_home", label: "Super admin home", type: "page", route: "/super-admin" },
        { id: "cmd_sales_leads", label: "Sales leads", type: "page", route: "/super-admin/sales-leads" },
        { id: "cmd_customers", label: "Customers", type: "page", route: "/super-admin/customers" },
        ...allTenants.slice(0, 40).map((tenant) => ({
          id: `tenant_${tenant.id}`,
          label: tenant.name,
          type: "tenant",
          route: "/super-admin/tenants",
        })),
      ];

      const runtimeConfig = Object.fromEntries(
        (runtimeConfigResult.data ?? []).map((item) => [item.key, item.value])
      );

      return jsonResponse(200, {
        data: {
          checked_at: nowIso,
          traffic: {
            checkout_15m: checkout15m,
            return_15m: return15m,
            active_tenants_15m: activeTenants15m,
            events_24h: recentLogs.length,
          },
          queue: queueSummary,
          leads: leadSummary,
          lead_funnel: leadFunnel,
          traffic_by_hour: Array.from(trafficByHourMap.values()),
          sla: {
            median_latency_ms: medianDuration ?? statusProbeMs,
            p95_latency_ms: p95Duration ?? statusProbeMs,
            error_rate_percent: queueTotal > 0 ? Number(((queueSummary.failed / queueTotal) * 100).toFixed(2)) : 0,
            probe_latency_ms: statusProbeMs,
          },
          needs_attention: needsAttention,
          customer_health: customerHealth,
          recent_audit: auditRows.slice(0, 25).map((row) => ({
            id: row.id,
            actor_email: row.actor_email,
            action_type: row.action_type,
            target_type: row.target_type,
            target_id: row.target_id,
            created_at: row.created_at,
          })),
          search_index: searchIndex,
          runtime: runtimeConfig,
          recent_events: recentEvents,
        },
      });
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
