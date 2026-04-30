import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  enforcePreloginRateLimit,
  hashString,
  resolveClientFingerprint,
  resolveClientIp,
} from "../_shared/preloginGuards.ts";
import { getRequestId, logError, logInfo } from "../_shared/observability.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type ConsoleEntry = {
  level?: string;
  message?: string;
  timestamp?: string;
};

type NetworkEntry = {
  method?: string;
  url?: string;
  status?: number | null;
  ok?: boolean;
  duration_ms?: number;
  request_id?: string | null;
  timestamp?: string;
  error?: string;
};

type ReportPayload = {
  title?: string;
  message?: string;
  reason?: string;
  error_name?: string;
  stack?: string;
  context?: string;
  page?: {
    url?: string;
    user_agent?: string;
    environment?: string;
    release?: string;
  };
  auth?: {
    is_authenticated?: boolean;
    role?: string | null;
    tenant_context_id?: string | null;
    district_context_id?: string | null;
  };
  district?: {
    is_district_host?: boolean;
    district_id?: string | null;
  };
  diagnostics?: {
    console?: ConsoleEntry[];
    network?: NetworkEntry[];
  };
};

type StoredReportRow = {
  id: string;
};

const normalizeText = (value: unknown, max = 5000) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

  const headers =
    hasOrigin && originAllowed
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const formatConsoleLines = (entries: ConsoleEntry[]) =>
  entries
    .slice(-20)
    .map((entry) =>
      `[${normalizeText(entry.timestamp, 32) || "unknown"}] ${normalizeText(entry.level, 10) || "log"} ${normalizeText(entry.message, 240)}`
    )
    .join("\n");

const formatNetworkLines = (entries: NetworkEntry[]) =>
  entries
    .slice(-15)
    .map((entry) => {
      const status = entry.status == null ? "ERR" : String(entry.status);
      const requestId = normalizeText(entry.request_id, 80);
      const error = normalizeText(entry.error, 120);
      return [
        `[${normalizeText(entry.timestamp, 32) || "unknown"}]`,
        normalizeText(entry.method, 12) || "GET",
        status,
        `${Math.max(0, Math.round(Number(entry.duration_ms) || 0))}ms`,
        normalizeText(entry.url, 220),
        requestId ? `(request_id=${requestId})` : "",
        error ? `error=${error}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join("\n");

const sendSlackWebhook = async (webhookUrl: string, text: string) => {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Slack webhook failed (${response.status}): ${body}`);
  }
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

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  const ingressError = await requireTrustedEdgeIngress(req, "client-error-report", jsonResponse);
  if (ingressError) return ingressError;

  try {
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");
    const slackWebhookUrl =
      Deno.env.get("ITX_CLIENT_ERROR_SLACK_WEBHOOK_URL")?.trim() ||
      Deno.env.get("ITX_SUPPORT_SLACK_WEBHOOK_URL")?.trim() ||
      Deno.env.get("ITX_SLACK_WEBHOOK_URL")?.trim() ||
      "";

    if (!supabaseUrl || !serviceKey || !slackWebhookUrl) {
      return jsonResponse(500, { error: "Server misconfiguration." });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const origin = req.headers.get("origin");
    const fingerprint = resolveClientFingerprint(req, origin);
    const ip = resolveClientIp(req);
    const requestHash = await hashString(
      `${fingerprint}|${normalizeText(req.headers.get("user-agent"), 255)}`
    );

    const rateLimit = await enforcePreloginRateLimit(
      adminClient,
      requestHash,
      "client_error_report",
      6,
      3600
    );
    if (!rateLimit.ok) {
      if (rateLimit.error) {
        logError("client-error-report rate limit failed", requestId, rateLimit.error);
        return jsonResponse(500, { error: "Rate limit check failed." });
      }
      return jsonResponse(429, { error: "Too many reports. Please try again later." });
    }

    const body = (await req.json()) as ReportPayload;
    const title = normalizeText(body.title, 160) || "Unexpected frontend error";
    const message = normalizeText(body.message, 1200) || "Unknown error";
    const reason = normalizeText(body.reason, 400) || "No reason provided.";
    const errorName = normalizeText(body.error_name, 120) || "Error";
    const stack = normalizeText(body.stack, 5000);
    const context = normalizeText(body.context, 300);
    const pageUrl = normalizeText(body.page?.url, 255);
    const environment = normalizeText(body.page?.environment, 40) || "unknown";
    const release = normalizeText(body.page?.release, 80) || "n/a";
    const userAgent = normalizeText(body.page?.user_agent, 255);
    let isVerifiedAuthenticated = false;
    let authRole = "none";
    let tenantContextId = "-";
    let districtContextId = "-";
    const authHeader = req.headers.get("authorization");
    if (authHeader && publishableKey) {
      const userClient = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (user?.id) {
        const { data: profile } = await userClient
          .from("profiles")
          .select("role, tenant_id, district_id")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.role) {
          isVerifiedAuthenticated = true;
          authRole = normalizeText(profile.role, 40) || "authenticated";
          tenantContextId = normalizeText(profile.tenant_id, 80) || "-";
          districtContextId = normalizeText(profile.district_id, 80) || "-";
        }
      }
    }
    const consoleLines = formatConsoleLines(Array.isArray(body.diagnostics?.console) ? body.diagnostics?.console : []);
    const networkLines = formatNetworkLines(Array.isArray(body.diagnostics?.network) ? body.diagnostics?.network : []);
    const ipHash = ip ? await hashString(ip) : null;

    const { data: reportRow, error: insertError } = await adminClient
      .from("client_error_reports")
      .insert({
        title,
        message,
        reason,
        error_name: errorName || null,
        stack: stack || null,
        context: context || null,
        page_url: pageUrl || null,
        environment: environment || null,
        release: release || null,
        user_agent: userAgent || null,
        is_authenticated: isVerifiedAuthenticated,
        auth_role: authRole === "none" ? null : authRole,
        tenant_context_id: tenantContextId === "-" ? null : tenantContextId,
        district_context_id: districtContextId === "-" ? null : districtContextId,
        is_district_host: !!body.district?.is_district_host,
        district_id: normalizeText(body.district?.district_id, 80) || null,
        request_id: requestId,
        client_fingerprint_hash: requestHash,
        ip_hash: ipHash,
        diagnostics: body.diagnostics ?? {},
      })
      .select("id")
      .single<StoredReportRow>();

    if (insertError || !reportRow) {
      logError("client-error-report insert failed", requestId, insertError ?? "missing report row");
      return jsonResponse(500, { error: "Unable to store error report." });
    }

    const slackText =
      `Client error report submitted\n` +
      `Report ID: ${reportRow.id}\n` +
      `Title: ${title}\n` +
      `Error: ${errorName}\n` +
      `Message: ${message}\n` +
      `Reason: ${reason}\n` +
      `Context: ${context || "-"}\n` +
      `Environment: ${environment}\n` +
      `Release: ${release}\n` +
      `Page: ${pageUrl || "-"}\n` +
      `Role: ${authRole}${isVerifiedAuthenticated ? "" : " (unverified)"}\n` +
      `Tenant Context: ${tenantContextId}\n` +
      `District Context: ${districtContextId}\n` +
      `Client Fingerprint: ${fingerprint}\n` +
      `IP Present: ${ip ? "yes" : "no"}\n` +
      `User Agent: ${userAgent || "-"}\n` +
      `Stack:\n${stack || "(none)"}\n\n` +
      `Recent Console:\n${consoleLines || "(none)"}\n\n` +
      `Recent Network:\n${networkLines || "(none)"}`;

    try {
      await sendSlackWebhook(slackWebhookUrl, slackText.slice(0, 35_000));
      await adminClient
        .from("client_error_reports")
        .update({
          slack_notified_at: new Date().toISOString(),
          slack_delivery_error: null,
        })
        .eq("id", reportRow.id);
    } catch (slackError) {
      await adminClient
        .from("client_error_reports")
        .update({
          slack_delivery_error: slackError instanceof Error ? slackError.message : "Slack delivery failed.",
        })
        .eq("id", reportRow.id);
      throw slackError;
    }
    logInfo("client-error-report sent", requestId, {
      report_id: reportRow.id,
      environment,
      release,
      page_url: pageUrl,
    });

    return jsonResponse(200, { data: { accepted: true, report_id: reportRow.id } });
  } catch (error) {
    logError("client-error-report failed", requestId, error);
    return jsonResponse(500, { error: "Unable to send error report. Please contact support directly." });
  }
});
