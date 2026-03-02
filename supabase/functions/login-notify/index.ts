import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
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

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildLoginNotificationHtml = (payload: {
  tenantName: string;
  supportEmail: string;
  loginTimeLabel: string;
  deviceBrowser: string;
  ipAddress: string | null;
}) => {
  const tenantName = escapeHtml(payload.tenantName);
  const supportEmail = escapeHtml(payload.supportEmail);
  const deviceBrowser = escapeHtml(payload.deviceBrowser || "Unknown");
  const ipAddress = escapeHtml(payload.ipAddress ?? "Unavailable");
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
                <h1 style="margin:0;font-size:20px;line-height:1.3;">ItemTraxx</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h2 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:#111827;">New Login Detected</h2>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">
                  A new login to your ItemTraxx account was detected.
                </p>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;color:#374151;">
                  <strong>Tenant:</strong> ${tenantName}<br />
                  <strong>Login time:</strong> ${loginTime}<br />
                  <strong>Device/Browser:</strong> ${deviceBrowser}<br />
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
    const loginTimeIso = new Date(now).toISOString();
    const loginTime = new Date(loginTimeIso);
    const loginTimeLabel = Number.isNaN(loginTime.getTime())
      ? loginTimeIso
      : `${loginTime.toISOString()} (UTC)`;
    const deviceInfo = req.headers.get("user-agent") ?? "Unknown device/browser";
    const clientIp = normalizeIp(req);

    await sendResendEmail(resendApiKey, {
      from: fromEmail,
      to: [recipientEmail],
      subject: `New ItemTraxx Login - ${tenant.name}`,
      html: buildLoginNotificationHtml({
        tenantName: tenant.name,
        supportEmail,
        loginTimeLabel,
        deviceBrowser: deviceInfo,
        ipAddress: clientIp,
      }),
      text:
        `A new login to your ItemTraxx account was detected.\n\n` +
        `Tenant: ${tenant.name}\n` +
        `Login time: ${loginTimeLabel}\n` +
        `Device/Browser: ${deviceInfo || "Unknown"}\n` +
        `IP Address: ${clientIp ?? "Unavailable"}\n\n` +
        `If this wasn't you, contact support immediately at ${supportEmail}.`,
    });

    logInfo("login-notify sent", requestId, {
      user_id: user.id,
      tenant_id: tenant.id,
      tenant_name: tenant.name,
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
