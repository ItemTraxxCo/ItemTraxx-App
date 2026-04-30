import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendLoggedResendEmail } from "../_shared/emailDeliveryLog.ts";
import { buildEmailBrandHeaderHtml } from "../_shared/emailBranding.ts";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { getRequestId, logError, logInfo } from "../_shared/observability.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { hashString, resolveClientIp } from "../_shared/preloginGuards.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";

const EMAIL_LOGO_URL = Deno.env.get("ITX_EMAIL_LOGO_URL")?.trim() || null;

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
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin || (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

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

const normalizeIp = (req: Request) => resolveClientIp(req) || null;

const TITLE_CASE_SKIP_WORDS = new Set(["and", "or", "of", "the", "in"]);

const toTitleCase = (value: string) =>
  value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => {
      if (part.length <= 3) return part.toUpperCase();
      if (index > 0 && TITLE_CASE_SKIP_WORDS.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");

const sanitizeGeoHeader = (value: string | null, maxLen: number) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};

const resolveGeneralLocation = (req: Request) => {
  const city = sanitizeGeoHeader(req.headers.get("x-itx-geo-city"), 80);
  const region = sanitizeGeoHeader(req.headers.get("x-itx-geo-region"), 80);
  const country = sanitizeGeoHeader(req.headers.get("x-itx-geo-country"), 80);

  if (!city && !region && !country) return null;

  const locationParts = city && region
    ? [city, region]
    : city && country
      ? [city, country]
      : region && country
        ? [region, country]
        : [city ?? region ?? country ?? ""];

  const formatted = locationParts
    .map((part) => toTitleCase(part))
    .filter(Boolean)
    .join(", ");

  return formatted || null;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildLoginNotificationHtml = (payload: {
  accountName: string;
  accountLabel: string;
  supportEmail: string;
  loginTimeLabel: string;
  deviceBrowser: string;
  ipAddress: string | null;
  generalLocation: string | null;
}) => {
  const accountName = escapeHtml(payload.accountName);
  const accountLabel = escapeHtml(payload.accountLabel);
  const supportEmail = escapeHtml(payload.supportEmail);
  const deviceBrowser = escapeHtml(payload.deviceBrowser || "Unknown");
  const ipAddress = escapeHtml(payload.ipAddress ?? "Unavailable");
  const generalLocation = escapeHtml(payload.generalLocation ?? "Unavailable");
  const loginTime = escapeHtml(payload.loginTimeLabel);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(180deg,#1f4ca3 0%,#38d0b1 100%);color:#ffffff;">
                ${buildEmailBrandHeaderHtml({ logoUrl: EMAIL_LOGO_URL, brandName: "ItemTraxx" })}
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h2 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:#111827;">New Login Detected</h2>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">
                  A new login to your ItemTraxx account was detected.
                </p>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;color:#374151;">
                  <strong>${accountLabel}:</strong> ${accountName}<br />
                  <strong>Login time:</strong> ${loginTime}<br />
                  <strong>Device/Browser:</strong> ${deviceBrowser}<br />
                  <strong>Approximate location:</strong> ${generalLocation}<br />
                  <strong>IP Address:</strong> ${ipAddress}
                </p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">
                  If this wasn't you, please contact support immediately.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">
                  Contact support:
                  <a href="mailto:${supportEmail}" style="color:#19439b;text-decoration:none;">${supportEmail}</a>
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  &copy; 2026 ItemTraxx Co. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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

  const ingressError = await requireTrustedEdgeIngress(req, "login-notify", jsonResponse);
  if (ingressError) return ingressError;

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
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
    const resendApiKey = Deno.env.get("ITX_RESEND_API_KEY");
    const supportEmail = Deno.env.get("ITX_SUPPORT_EMAIL") ?? "support@itemtraxx.com";
    const fromEmail = Deno.env.get("ITX_EMAIL_FROM") ?? "ItemTraxx <noreply@itemtraxx.com>";

    if (!supabaseUrl || !serviceKey || !resendApiKey) {
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

    const clientIp = normalizeIp(req);
    const rateLimitKey = await hashString(
      `${user.id}|${clientIp ?? ""}|${req.headers.get("user-agent") ?? ""}`
    );
    const { data: rateLimit, error: rateLimitError } = await adminClient.rpc(
      "consume_rate_limit_prelogin",
      {
        p_key: rateLimitKey,
        p_scope: "login_notify",
        p_limit: 3,
        p_window_seconds: 600,
      },
    );
    if (rateLimitError) {
      logError("login-notify rate limit failed", requestId, rateLimitError);
      return jsonResponse(500, { error: "Rate limit check failed" });
    }
    const rateLimitResult = rateLimit as RateLimitResult;
    if (!rateLimitResult.allowed) {
      const retryAfter = rateLimitResult.retry_after_seconds ?? 600;
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Too many login notifications. Please try again later.",
        }),
        {
          status: 429,
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "x-request-id": requestId,
            "Retry-After": String(Math.max(1, retryAfter)),
          },
        },
      );
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("tenant_id, district_id, role, auth_email")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.role) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (
      profile.role !== "tenant_user" &&
      profile.role !== "tenant_admin" &&
      profile.role !== "district_admin" &&
      profile.role !== "super_admin"
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    let accountName: string;
    let accountLabel: string;
    let accountId: string;

    if ((profile.role === "tenant_user" || profile.role === "tenant_admin") && profile.tenant_id) {
      const { data: tenant, error: tenantError } = await adminClient
        .from("tenants")
        .select("id, name")
        .eq("id", profile.tenant_id)
        .single();

      if (tenantError || !tenant?.id) {
        return jsonResponse(400, { error: "Unable to resolve tenant" });
      }
      accountName = tenant.name;
      accountLabel = "Tenant";
      accountId = tenant.id;
    } else if (profile.role === "district_admin" && profile.district_id) {
      const { data: district, error: districtError } = await adminClient
        .from("districts")
        .select("id, name")
        .eq("id", profile.district_id)
        .single();
      if (districtError || !district?.id) {
        return jsonResponse(400, { error: "Unable to resolve district" });
      }
      accountName = district.name;
      accountLabel = "District";
      accountId = district.id;
    } else if (profile.role === "super_admin") {
      accountName = "Super Admin Control Center";
      accountLabel = "Workspace";
      accountId = user.id;
    } else {
      return jsonResponse(403, { error: "Access denied" });
    }

    const recipientEmail = profile.auth_email ?? user.email ?? "";
    if (!recipientEmail) {
      return jsonResponse(200, { data: { queued: false, skipped: true, reason: "missing_recipient" } });
    }

    const cooldownSince = new Date(Date.now() - 60_000).toISOString();
    const { data: recentNotification, error: recentNotificationError } = await adminClient
      .from("email_delivery_logs")
      .select("id")
      .eq("email_type", "login_notification")
      .eq("triggered_by_user_id", user.id)
      .gte("created_at", cooldownSince)
      .in("status", ["queued", "sent"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentNotificationError) {
      logError("login-notify cooldown check failed", requestId, recentNotificationError);
      return jsonResponse(500, { error: "Rate limit check failed" });
    }
    if (recentNotification?.id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Too many login notifications. Please try again later.",
        }),
        {
          status: 429,
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "x-request-id": requestId,
            "Retry-After": "60",
          },
        },
      );
    }

    const now = Date.now();
    const loginTimeIso = new Date(now).toISOString();
    const loginTime = new Date(loginTimeIso);
    const loginTimeLabel = Number.isNaN(loginTime.getTime())
      ? loginTimeIso
      : `${loginTime.toISOString()} (UTC)`;
    const deviceInfo = req.headers.get("user-agent") ?? "Unknown device/browser";
    const generalLocation = resolveGeneralLocation(req);

    const subject = `New ItemTraxx Login - ${accountName}`;
    await sendLoggedResendEmail(adminClient, resendApiKey, {
      from: fromEmail,
      to: [recipientEmail],
      subject,
      html: buildLoginNotificationHtml({
        accountName,
        accountLabel,
        supportEmail,
        loginTimeLabel,
        deviceBrowser: deviceInfo,
        ipAddress: clientIp,
        generalLocation,
      }),
      text:
        `A new login to your ItemTraxx account was detected.\n\n` +
        `${accountLabel}: ${accountName}\n` +
        `Login time: ${loginTimeLabel}\n` +
        `Device/Browser: ${deviceInfo || "Unknown"}\n` +
        `IP Address: ${clientIp ?? "Unavailable"}\n\n` +
        `If this wasn't you, contact support immediately at ${supportEmail}.`,
    }, {
      emailType: "login_notification",
      recipientEmail,
      subject,
      requestContext: {
        function_name: "login-notify",
        request_id: requestId,
      },
      triggeredByUserId: user.id,
      tenantId: profile.tenant_id ?? null,
      districtId: profile.district_id ?? null,
      metadata: {
        role: profile.role,
        account_id: accountId,
        account_name: accountName,
        account_label: accountLabel,
      },
    });

    logInfo("login-notify sent", requestId, {
      user_id: user.id,
      account_id: accountId,
      account_name: accountName,
      role: profile.role,
    });

    return jsonResponse(200, {
      data: {
        sent: true,
      },
    });
  } catch (error) {
    logError("login-notify error", requestId, error);
    return jsonResponse(500, { error: "Request failed" });
  }
});
