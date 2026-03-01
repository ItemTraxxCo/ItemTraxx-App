import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { getRequestId, logError, logInfo } from "../_shared/observability.ts";

type AsyncJobRow = {
  id: string;
  job_type: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
};

type ContactSalesPayload = {
  lead_id: string;
  plan_label: string;
  plan_key: "core" | "growth" | "enterprise";
  schools_count: number | null;
  name: string;
  organization: string;
  reply_email: string;
  details: string | null;
  support_email: string;
  from_email: string;
};

type LoginNotificationPayload = {
  user_id: string;
  tenant_id: string;
  tenant_name: string;
  to_email: string;
  from_email: string;
  support_email: string;
  login_time_iso: string;
  device_browser: string;
  ip_address: string | null;
};

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
  const originAllowed =
    !hasOrigin || (hasOrigin && allowedOrigins.includes(origin as string));

  const headers =
    hasOrigin && originAllowed
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const sendResendEmail = async (
  apiKey: string,
  payload: Record<string, unknown>,
) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Email send failed: ${response.status} ${text}`);
  }
};

const processContactSalesEmail = async (
  resendApiKey: string,
  payload: ContactSalesPayload,
) => {
  const schoolsLine =
    payload.plan_key === "enterprise" && payload.schools_count
      ? `\nNumber of schools: ${payload.schools_count}`
      : "";

  await sendResendEmail(resendApiKey, {
    from: payload.from_email,
    to: [payload.support_email],
    subject: `Contact Sales Request - ${payload.organization}`,
    reply_to: payload.reply_email,
    text:
      `A new sales request was submitted.\n\nPlan: ${payload.plan_label}\nName: ${payload.name}\nOrganization: ${payload.organization}\nReply email: ${payload.reply_email}${schoolsLine}\n\nDetails:\n${payload.details ?? "(none provided)"}\n\nLead ID: ${payload.lead_id}`,
  });

  await sendResendEmail(resendApiKey, {
    from: payload.from_email,
    to: [payload.reply_email],
    subject: "We received your ItemTraxx sales request.",
    text:
      `Hi ${payload.name},\n\nThanks for contacting the ItemTraxx Sales Team. We've received your request and will follow up with a quote for your selected plan within 2 business days.\n\nRequest summary:\nPlan: ${payload.plan_label}${schoolsLine}\nOrganization: ${payload.organization}\n\nIf you need to add anything else, feel free to reply to this email.\nHave a great day,\n\n- ItemTraxx Sales\n${payload.support_email}\n\nIf you don't hear from us within 2 business days, please check your spam folder or contact us at ${payload.support_email}`,
  });
};

const processLoginNotificationEmail = async (
  resendApiKey: string,
  payload: LoginNotificationPayload,
) => {
  const loginTime = new Date(payload.login_time_iso);
  const loginTimeLabel = Number.isNaN(loginTime.getTime())
    ? payload.login_time_iso
    : `${loginTime.toISOString()} (UTC)`;

  await sendResendEmail(resendApiKey, {
    from: payload.from_email,
    to: [payload.to_email],
    subject: `New ItemTraxx Login - ${payload.tenant_name}`,
    text:
      `A new login to your ItemTraxx account was detected.\n\n` +
      `Tenant: ${payload.tenant_name}\n` +
      `Login time: ${loginTimeLabel}\n` +
      `Device/Browser: ${payload.device_browser || "Unknown"}\n` +
      `IP Address: ${payload.ip_address ?? "Unavailable"}\n\n` +
      `If this wasn't you, contact support immediately at ${payload.support_email}.`,
  });
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

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");
    const workerSecret = Deno.env.get("ITX_JOB_WORKER_SECRET");
    const resendApiKey = Deno.env.get("ITX_RESEND_API_KEY");
    const workerAuth = req.headers.get("authorization") ?? "";

    if (!supabaseUrl || !serviceKey || !workerSecret || !resendApiKey) {
      return jsonResponse(500, { error: "Server misconfiguration." });
    }
    if (workerAuth !== `Bearer ${workerSecret}`) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const body = await req.json().catch(() => ({})) as {
      limit?: number;
      run_reporting_refresh?: boolean;
    };
    const limit = Math.max(1, Math.min(50, Number(body.limit ?? 20) || 20));
    const workerId = crypto.randomUUID();

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: claimed, error: claimError } = await adminClient.rpc("claim_async_jobs", {
      p_worker_id: workerId,
      p_limit: limit,
    });

    if (claimError) {
      return jsonResponse(500, { error: "Unable to claim jobs." });
    }

    const jobs = (claimed ?? []) as AsyncJobRow[];
    let completed = 0;
    let failed = 0;
    let reportingRefreshed = false;

    for (const job of jobs) {
      try {
        if (job.job_type === "contact_sales_email") {
          await processContactSalesEmail(
            resendApiKey,
            job.payload as ContactSalesPayload,
          );
        } else if (job.job_type === "login_notification_email") {
          await processLoginNotificationEmail(
            resendApiKey,
            job.payload as LoginNotificationPayload,
          );
        } else if (job.job_type === "refresh_reporting_views") {
          await adminClient.rpc("refresh_super_reporting_views");
        }

        const { error: completeError } = await adminClient
          .from("async_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", job.id);

        if (completeError) {
          throw completeError;
        }
        completed += 1;
      } catch (error) {
        const hitMaxAttempts = job.attempts >= job.max_attempts;
        const { error: failError } = await adminClient
          .from("async_jobs")
          .update({
            status: hitMaxAttempts ? "failed" : "queued",
            run_after: hitMaxAttempts
              ? new Date().toISOString()
              : new Date(Date.now() + Math.min(5 * 60_000, job.attempts * 30_000)).toISOString(),
            completed_at: hitMaxAttempts ? new Date().toISOString() : null,
            last_error: error instanceof Error ? error.message.slice(0, 1000) : "Unknown error",
          })
          .eq("id", job.id);

        if (failError) {
          logError("job-worker failed to persist job error", requestId, failError, {
            job_id: job.id,
          });
        }
        failed += 1;
      }
    }

    if (body.run_reporting_refresh === true) {
      const { error: refreshError } = await adminClient.rpc("refresh_super_reporting_views");
      if (refreshError) {
        failed += 1;
      } else {
        reportingRefreshed = true;
      }
    }

    logInfo("job-worker completed", requestId, {
      claimed: jobs.length,
      completed,
      failed,
      reporting_refreshed: reportingRefreshed,
    });
    return jsonResponse(200, {
      data: {
        claimed: jobs.length,
        completed,
        failed,
        reporting_refreshed: reportingRefreshed,
      },
    });
  } catch (error) {
    logError("job-worker error", requestId, error);
    return jsonResponse(500, { error: "Request failed." });
  }
});
