import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getRequestId, logError, logInfo } from "../_shared/observability.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin || (hasOrigin && allowedOrigins.includes(origin as string));

  const headers =
    hasOrigin && originAllowed
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const parseAuthToken = (req: Request) => {
  const raw = req.headers.get("authorization") ?? "";
  const token = raw.replace(/^Bearer\s+/i, "").trim();
  return token;
};

const normalizeIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const forwardedFirst = forwarded.split(",")[0]?.trim() ?? "";
  const cfIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  return forwardedFirst || cfIp || null;
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);
  const requestId = getRequestId(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
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

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const notifyEnabled = (Deno.env.get("ITX_LOGIN_NOTIFY_ENABLED") ?? "true").toLowerCase() !== "false";
  if (!notifyEnabled) {
    return jsonResponse(200, { data: { queued: false, skipped: true, reason: "disabled" } });
  }

  try {
    const accessToken = parseAuthToken(req);
    if (!accessToken) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supportEmail = Deno.env.get("ITX_SUPPORT_EMAIL") ?? "support@itemtraxx.com";
    const fromEmail = Deno.env.get("ITX_EMAIL_FROM") ?? "ItemTraxx <noreply@itemtraxx.com>";

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(accessToken);

    if (userError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("tenant_id, role, auth_email")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (profile.role !== "tenant_user" && profile.role !== "tenant_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: tenant, error: tenantError } = await adminClient
      .from("tenants")
      .select("id, name")
      .eq("id", profile.tenant_id)
      .single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(400, { error: "Unable to resolve tenant" });
    }

    const recipientEmail = profile.auth_email ?? user.email ?? "";
    if (!recipientEmail) {
      return jsonResponse(200, { data: { queued: false, skipped: true, reason: "missing_recipient" } });
    }

    const now = Date.now();
    const throttleCutoffIso = new Date(now - 15 * 60_000).toISOString();
    const { count: recentCount, error: recentError } = await adminClient
      .from("async_jobs")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "login_notification_email")
      .gte("created_at", throttleCutoffIso)
      .in("status", ["queued", "processing", "completed"])
      .filter("payload->>user_id", "eq", user.id);

    if (recentError) {
      logError("login-notify throttle lookup failed", requestId, recentError, {
        user_id: user.id,
      });
      return jsonResponse(500, { error: "Unable to process notification" });
    }

    if ((recentCount ?? 0) > 0) {
      return jsonResponse(200, {
        data: {
          queued: false,
          skipped: true,
          reason: "throttled",
        },
      });
    }

    const loginTimeIso = new Date(now).toISOString();
    const deviceInfo = req.headers.get("user-agent") ?? "Unknown device/browser";
    const clientIp = normalizeIp(req);

    const { error: enqueueError } = await adminClient.rpc("enqueue_async_job", {
      p_job_type: "login_notification_email",
      p_payload: {
        user_id: user.id,
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        to_email: recipientEmail,
        from_email: fromEmail,
        support_email: supportEmail,
        login_time_iso: loginTimeIso,
        device_browser: deviceInfo,
        ip_address: clientIp,
      },
      p_priority: 40,
      p_max_attempts: 5,
    });

    if (enqueueError) {
      logError("login-notify enqueue failed", requestId, enqueueError, {
        user_id: user.id,
        tenant_id: tenant.id,
      });
      return jsonResponse(500, { error: "Unable to queue login notification" });
    }

    logInfo("login-notify queued", requestId, {
      user_id: user.id,
      tenant_id: tenant.id,
      tenant_name: tenant.name,
    });

    return jsonResponse(200, {
      data: {
        queued: true,
        throttled: false,
      },
    });
  } catch (error) {
    logError("login-notify error", requestId, error);
    return jsonResponse(500, { error: "Request failed" });
  }
});
