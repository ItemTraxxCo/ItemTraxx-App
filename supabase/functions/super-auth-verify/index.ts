import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendLoggedResendEmail } from "../_shared/emailDeliveryLog.ts";
import { buildEmailBrandHeaderHtml } from "../_shared/emailBranding.ts";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { getRequestId, logError, logInfo } from "../_shared/observability.ts";
import {
  enforcePreloginRateLimit,
  hashString,
  resolveClientFingerprint,
  resolveClientIp,
  verifyTurnstileToken,
} from "../_shared/preloginGuards.ts";
import { registerPrivilegedStepUp } from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";

const EMAIL_LOGO_URL = Deno.env.get("ITX_EMAIL_LOGO_URL")?.trim() || null;
const PASSWORD_RESET_URL = "https://itemtraxx.com/forgot-password";
const CONTACT_SUPPORT_URL = "https://itemtraxx.com/contact-support";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, aikido-scan-agent",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

type StartPasswordLoginAction = {
  action: "start_password_login";
  payload?: { email?: string; password?: string; turnstile_token?: string };
};
type StartAction = { action: "start_email_challenge"; payload?: { challenge_token?: string } };
type VerifyAction = {
  action: "verify_email_challenge";
  payload?: { code?: string; challenge_token?: string };
};
type ResendAction = { action: "resend_email_challenge"; payload?: { challenge_token?: string } };
type RequestBody = StartPasswordLoginAction | StartAction | VerifyAction | ResendAction;

type ChallengeRow = {
  id: string;
  user_id: string;
  email: string;
  code_hash: string;
  purpose: string;
  expires_at: string;
  used_at: string | null;
  attempt_count: number;
  created_at: string;
};

type PendingSuperAdminSession = {
  user_id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  issued_at: string;
  purpose: "super_admin_login";
};

type SuperAdminContext = {
  userId: string;
  userEmail: string | null;
  authToken: string;
  pendingSession: PendingSuperAdminSession | null;
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

const normalizeText = (value: unknown, max = 500) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
};

const parseAuthToken = (req: Request) => {
  const raw = req.headers.get("authorization") ?? "";
  return raw.replace(/^Bearer\s+/i, "").trim();
};

const createCode = () => {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000)).padStart(6, "0");
};

const base64UrlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const raw = atob(`${normalized}${padding}`);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

const createChallengeKey = async (secret: string) => {
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`itemtraxx-super-admin-challenge:${secret}`)
  );
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
};

const sealChallengeToken = async (secret: string, payload: PendingSuperAdminSession) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await createChallengeKey(secret);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return base64UrlEncode(packed);
};

const openChallengeToken = async (secret: string, token: string) => {
  const packed = base64UrlDecode(token);
  if (packed.length <= 12) {
    throw new Error("Invalid challenge token");
  }
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const key = await createChallengeKey(secret);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as PendingSuperAdminSession;
  if (
    !payload?.user_id ||
    !payload?.email ||
    !payload?.access_token ||
    !payload?.refresh_token ||
    payload.purpose !== "super_admin_login"
  ) {
    throw new Error("Invalid challenge token");
  }
  if (Date.now() - Date.parse(payload.issued_at) > CHALLENGE_TTL_MS) {
    throw new Error("Expired challenge token");
  }
  return payload;
};

const digest = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildSuperAdminTwoFactorHtml = (payload: { code: string; support_email: string }) => {
  const supportEmail = escapeHtml(payload.support_email);
  const code = escapeHtml(payload.code);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f5f2;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d8d6d1;border-radius:0;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 14px 28px;background:#ffffff;border-bottom:1px solid #e7e5df;color:#171717;">
                ${buildEmailBrandHeaderHtml({ logoUrl: EMAIL_LOGO_URL, brandName: "ItemTraxx" })}
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h2 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:#171717;">Your Verification Code</h2>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#343330;">
                  Use the following 6-digit verification code to finish signing in to ItemTraxx super admin.
                </p>
                <div style="margin:0 0 18px 0;padding:16px 18px;border-radius:0;background:#fbfaf8;border:1px solid #d8d6d1;font-size:28px;line-height:1.2;font-weight:700;letter-spacing:0.22em;color:#171717;text-align:center;">
                  ${code}
                </div>
                <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#68645f;">
                  This code expires in 10 minutes and can only be used once.
                </p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#68645f;">
                  If this wasn't you,
                  <a href="${PASSWORD_RESET_URL}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">reset your password</a>
                  and
                  <a href="${CONTACT_SUPPORT_URL}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">contact support immediately</a>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e7e5df;background:#fbfaf8;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#68645f;">
                  Need help? Contact
                  <a href="mailto:${supportEmail}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">${supportEmail}</a>
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;color:#8b8680;">
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

const sendSuperAdminTwoFactorEmail = async (
  adminClient: SupabaseClient,
  resendApiKey: string,
  context: {
    requestId: string;
    triggeredByUserId: string;
    resend: boolean;
  },
  payload: { to_email: string; code: string; support_email: string; from_email: string },
) => {
  const subject = "Your ItemTraxx verification code";
  await sendLoggedResendEmail(adminClient, resendApiKey, {
    from: payload.from_email,
    to: payload.to_email,
    subject,
    html: buildSuperAdminTwoFactorHtml({ code: payload.code, support_email: payload.support_email }),
    text: `Your ItemTraxx verification code is ${payload.code}. It expires in 10 minutes. If this wasn't you, reset your password at ${PASSWORD_RESET_URL} and contact support immediately at ${CONTACT_SUPPORT_URL}.`,
  }, {
    emailType: "super_admin_2fa",
    recipientEmail: payload.to_email,
    subject,
    requestContext: {
      function_name: "super-auth-verify",
      request_id: context.requestId,
    },
    triggeredByUserId: context.triggeredByUserId,
    metadata: {
      purpose: "super_admin_login",
      resend: context.resend,
    },
  });
};

const resolveSuperAdminContext = async (params: {
  adminClient: SupabaseClient;
  supabaseUrl: string;
  publishableKey: string;
  serviceKey: string;
  authToken: string;
  challengeToken: string;
}) => {
  const { adminClient, supabaseUrl, publishableKey, serviceKey, authToken, challengeToken } = params;

  if (challengeToken) {
    const pendingSession = await openChallengeToken(serviceKey, challengeToken);
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role, auth_email")
      .eq("id", pendingSession.user_id)
      .single();

    if (profile?.role !== "super_admin") {
      throw new Error("Access denied");
    }

    return {
      userId: pendingSession.user_id,
      userEmail: profile.auth_email ?? pendingSession.email,
      authToken: pendingSession.access_token,
      pendingSession,
    } satisfies SuperAdminContext;
  }

  if (!authToken) {
    throw new Error("Unauthorized");
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    throw new Error("Unauthorized");
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role, auth_email")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "super_admin") {
    throw new Error("Access denied");
  }

  return {
    userId: user.id,
    userEmail: profile.auth_email ?? user.email ?? null,
    authToken,
    pendingSession: null,
  } satisfies SuperAdminContext;
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
    if (!originAllowed) return new Response("Origin not allowed", { status: 403, headers });
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

  const ingressError = await requireTrustedEdgeIngress(req, "super-auth-verify", jsonResponse);
  if (ingressError) return ingressError;

  try {
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    if (!body || typeof body !== "object" || typeof body.action !== "string") {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");
    const turnstileSecret = Deno.env.get("ITX_TURNSTILE_SECRET") ?? "";
    const supportEmail = Deno.env.get("ITX_SUPPORT_EMAIL") ?? "support@itemtraxx.com";
    const fromEmail =
      Deno.env.get("ITX_EMAIL_FROM") ??
      Deno.env.get("ITX_RESEND_FROM") ??
      "ItemTraxx Security <support@itemtraxx.com>";
    const resendApiKey = Deno.env.get("ITX_RESEND_API_KEY");

    if (!supabaseUrl || !publishableKey || !serviceKey || !resendApiKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    if (body.action === "start_password_login") {
      const email = normalizeText(body.payload?.email, 320).toLowerCase();
      const password = typeof body.payload?.password === "string" ? body.payload.password : "";
      const turnstileToken = normalizeText(body.payload?.turnstile_token, 4096);
      if (!email || !password || !turnstileToken) {
        return jsonResponse(400, { error: "Invalid request" });
      }
      if (!turnstileSecret) {
        return jsonResponse(500, { error: "Server misconfiguration" });
      }

      const origin = req.headers.get("Origin");
      const clientIp = resolveClientIp(req);
      const clientFingerprint = resolveClientFingerprint(req, origin);
      const emailHash = await hashString(email);

      const perClientLimit = await enforcePreloginRateLimit(
        adminClient,
        clientFingerprint,
        `super-admin-login-client-${clientFingerprint}`,
        10,
        600
      );
      if (!perClientLimit.ok) {
        if (perClientLimit.error) {
          logError("super-auth-verify prelogin rate limit failed", requestId, perClientLimit.error, {
            scope: `super-admin-login-client-${clientFingerprint}`,
          });
          return jsonResponse(503, { error: "Rate limit check failed" });
        }
        return jsonResponse(429, { error: "Too many requests. Please try again shortly." });
      }

      const perEmailLimit = await enforcePreloginRateLimit(
        adminClient,
        `${clientFingerprint}-${emailHash.slice(0, 16)}`,
        `super-admin-login-email-${emailHash.slice(0, 12)}`,
        5,
        600
      );
      if (!perEmailLimit.ok) {
        if (perEmailLimit.error) {
          logError("super-auth-verify prelogin rate limit failed", requestId, perEmailLimit.error, {
            scope: `super-admin-login-email-${emailHash.slice(0, 12)}`,
          });
          return jsonResponse(503, { error: "Rate limit check failed" });
        }
        return jsonResponse(429, { error: "Too many requests. Please try again shortly." });
      }

      const turnstileValid = await verifyTurnstileToken(
        turnstileSecret,
        turnstileToken,
        clientIp,
        "super-auth-verify start_password_login"
      );
      if (!turnstileValid) {
        return jsonResponse(403, { error: "Turnstile verification failed" });
      }

      const loginClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false },
      });
      const signIn = await loginClient.auth.signInWithPassword({ email, password });
      const session = signIn.data.session;
      const signedInUser = signIn.data.user ?? session?.user ?? null;
      if (signIn.error || !session?.access_token || !session.refresh_token || !signedInUser?.id) {
        return jsonResponse(401, { error: "Invalid credentials" });
      }

      const { data: profile } = await adminClient
        .from("profiles")
        .select("role, auth_email")
        .eq("id", signedInUser.id)
        .single();

      if (profile?.role !== "super_admin") {
        return jsonResponse(401, { error: "Invalid credentials" });
      }

      const recipientEmail = profile.auth_email ?? signedInUser.email ?? "";
      if (!recipientEmail) {
        return jsonResponse(400, { error: "Missing recipient email." });
      }

      const challengeToken = await sealChallengeToken(serviceKey, {
        user_id: signedInUser.id,
        email: recipientEmail,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        issued_at: new Date().toISOString(),
        purpose: "super_admin_login",
      });

      const code = createCode();
      const codeHash = await digest(`${signedInUser.id}:${code}`);
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

      await adminClient
        .from("super_admin_email_challenges")
        .update({ used_at: new Date().toISOString() })
        .eq("user_id", signedInUser.id)
        .eq("purpose", "super_admin_login")
        .is("used_at", null);

      const { error: insertError } = await adminClient
        .from("super_admin_email_challenges")
        .insert({
          user_id: signedInUser.id,
          email: recipientEmail,
          purpose: "super_admin_login",
          code_hash: codeHash,
          expires_at: expiresAt,
        });

      if (insertError) {
        logError("super-auth-verify challenge insert failed", requestId, insertError, { user_id: signedInUser.id });
        return jsonResponse(500, { error: "Unable to start verification." });
      }

      await sendSuperAdminTwoFactorEmail(adminClient, resendApiKey, {
        requestId,
        triggeredByUserId: signedInUser.id,
        resend: false,
      }, {
        to_email: recipientEmail,
        code,
        support_email: supportEmail,
        from_email: fromEmail,
      });

      await adminClient.from("super_admin_audit_logs").insert({
        actor_id: signedInUser.id,
        actor_email: recipientEmail,
        action_type: "super_admin_2fa_started",
        target_type: "super_admin_auth",
        target_id: signedInUser.id,
        metadata: { expires_at: expiresAt, via: "password_login" },
      });

      logInfo("super-auth-verify password login challenge started", requestId, { user_id: signedInUser.id });
      return jsonResponse(200, {
        challenge_started: true,
        email: recipientEmail,
        expires_at: expiresAt,
        challenge_token: challengeToken,
      });
    }

    const authToken = parseAuthToken(req);
    const challengeToken = normalizeText((body.payload as { challenge_token?: string } | undefined)?.challenge_token, 8192);

    let context: SuperAdminContext;
    try {
      context = await resolveSuperAdminContext({
        adminClient,
        supabaseUrl,
        publishableKey,
        serviceKey,
        authToken,
        challengeToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      if (message === "Access denied") {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (message === "Expired challenge token" || message === "Invalid challenge token") {
        return jsonResponse(401, { error: "Verification session expired. Sign in again." });
      }
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: rateLimit, error: rateLimitError } = await adminClient.rpc("consume_rate_limit", {
      p_scope: "super_admin_2fa",
      p_limit: 10,
      p_window_seconds: 600,
    });
    if (!rateLimitError) {
      const rateLimitResult = rateLimit as RateLimitResult;
      if (!rateLimitResult.allowed) {
        return jsonResponse(429, { error: "Too many requests. Please try again shortly." });
      }
    }

    const writeAudit = async (actionType: string, metadata: Record<string, unknown>) => {
      await adminClient.from("super_admin_audit_logs").insert({
        actor_id: context.userId,
        actor_email: context.userEmail,
        action_type: actionType,
        target_type: "super_admin_auth",
        target_id: context.userId,
        metadata,
      });
    };

    if (body.action === "start_email_challenge" || body.action === "resend_email_challenge") {
      const { data: latestChallenge } = await adminClient
        .from("super_admin_email_challenges")
        .select("id, created_at, used_at, expires_at")
        .eq("user_id", context.userId)
        .eq("purpose", "super_admin_login")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        latestChallenge?.created_at &&
        !latestChallenge.used_at &&
        Date.now() - Date.parse(latestChallenge.created_at) < RESEND_COOLDOWN_MS
      ) {
        return jsonResponse(429, { error: "A code was just sent. Please wait before requesting another." });
      }

      const recipientEmail = context.userEmail ?? "";
      if (!recipientEmail) {
        return jsonResponse(400, { error: "Missing recipient email." });
      }

      const code = createCode();
      const codeHash = await digest(`${context.userId}:${code}`);
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

      await adminClient
        .from("super_admin_email_challenges")
        .update({ used_at: new Date().toISOString() })
        .eq("user_id", context.userId)
        .eq("purpose", "super_admin_login")
        .is("used_at", null);

      const { error: insertError } = await adminClient
        .from("super_admin_email_challenges")
        .insert({
          user_id: context.userId,
          email: recipientEmail,
          purpose: "super_admin_login",
          code_hash: codeHash,
          expires_at: expiresAt,
        });

      if (insertError) {
        logError("super-auth-verify challenge insert failed", requestId, insertError, { user_id: context.userId });
        return jsonResponse(500, { error: "Unable to start verification." });
      }

      await sendSuperAdminTwoFactorEmail(adminClient, resendApiKey, {
        requestId,
        triggeredByUserId: context.userId,
        resend: body.action === "resend_email_challenge",
      }, {
        to_email: recipientEmail,
        code,
        support_email: supportEmail,
        from_email: fromEmail,
      });

      await writeAudit(
        body.action === "resend_email_challenge" ? "super_admin_2fa_resent" : "super_admin_2fa_started",
        { expires_at: expiresAt },
      );
      logInfo("super-auth-verify challenge started", requestId, { user_id: context.userId });
      return jsonResponse(200, {
        challenge_started: true,
        email: recipientEmail,
        expires_at: expiresAt,
        ...(challengeToken ? { challenge_token: challengeToken } : {}),
      });
    }

    if (body.action === "verify_email_challenge") {
      const code = normalizeText(body.payload?.code, 12).replace(/\s+/g, "");
      if (!/^\d{6}$/.test(code)) {
        return jsonResponse(400, { error: "Enter a valid 6-digit code." });
      }

      const { data: challenge, error: challengeError } = await adminClient
        .from("super_admin_email_challenges")
        .select("id, user_id, email, code_hash, purpose, expires_at, used_at, attempt_count, created_at")
        .eq("user_id", context.userId)
        .eq("purpose", "super_admin_login")
        .is("used_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (challengeError) {
        logError("super-auth-verify challenge lookup failed", requestId, challengeError, { user_id: context.userId });
        return jsonResponse(500, { error: "Unable to verify code." });
      }

      const activeChallenge = challenge as ChallengeRow | null;
      if (!activeChallenge) {
        return jsonResponse(400, { error: "No active verification code. Request a new code." });
      }
      if (Date.parse(activeChallenge.expires_at) <= Date.now()) {
        await adminClient
          .from("super_admin_email_challenges")
          .update({ used_at: new Date().toISOString() })
          .eq("id", activeChallenge.id);
        return jsonResponse(400, { error: "Verification code expired. Request a new code." });
      }
      if (activeChallenge.attempt_count >= MAX_ATTEMPTS) {
        await adminClient
          .from("super_admin_email_challenges")
          .update({ used_at: new Date().toISOString() })
          .eq("id", activeChallenge.id);
        return jsonResponse(400, { error: "Verification code locked. Request a new code." });
      }

      const submittedHash = await digest(`${context.userId}:${code}`);
      if (submittedHash !== activeChallenge.code_hash) {
        const nextAttempts = activeChallenge.attempt_count + 1;
        await adminClient
          .from("super_admin_email_challenges")
          .update({
            attempt_count: nextAttempts,
            last_attempt_at: new Date().toISOString(),
            ...(nextAttempts >= MAX_ATTEMPTS ? { used_at: new Date().toISOString() } : {}),
          })
          .eq("id", activeChallenge.id);
        await writeAudit("super_admin_2fa_failed", { attempt_count: nextAttempts });
        return jsonResponse(400, {
          error: nextAttempts >= MAX_ATTEMPTS
            ? "Verification code locked. Request a new code."
            : "Invalid verification code.",
        });
      }

      await adminClient
        .from("super_admin_email_challenges")
        .update({
          used_at: new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", activeChallenge.id);

      await registerPrivilegedStepUp(adminClient, {
        userId: context.userId,
        roleScope: "super_admin",
        authToken: context.authToken,
        source: "super_admin_email_challenge",
      });

      await writeAudit("super_admin_2fa_verified", {});
      logInfo("super-auth-verify challenge verified", requestId, { user_id: context.userId });
      return jsonResponse(200, {
        verified: true,
        access_token: context.pendingSession?.access_token ?? null,
        refresh_token: context.pendingSession?.refresh_token ?? null,
      });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    logError("super-auth-verify error", requestId, error);
    return new Response(JSON.stringify({ ok: false, error: "Request failed." }), {
      status: 500,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
    });
  }
});
