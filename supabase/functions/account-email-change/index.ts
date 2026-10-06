import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { getExternalAuthUser } from "../_shared/externalAuth.ts";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { callBetterAuthAdmin } from "../_shared/betterAuthAdmin.ts";
import { sha256Hex } from "../_shared/sha256.ts";
import { requireEmail } from "../_shared/validation.ts";
import { ValidationError } from "../_shared/validation.ts";
import {
  enforcePreloginRateLimit,
  resolveClientFingerprint,
} from "../_shared/preloginGuards.ts";
import { buildPublicRateLimitHeaders } from "../_shared/publicRateLimit.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const buildFlowURL = (step: "approve" | "verify", token: string) => {
  const configured = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "").trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    url.pathname = "/account/email-change";
    url.search = "";
    const fragment = new URLSearchParams();
    fragment.set("step", step);
    fragment.set("token", token);
    url.hash = fragment.toString();
    return url.toString();
  } catch {
    return null;
  }
};

const publicError = "This email change could not be completed. Request a new change from Account Security.";

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));
  const originAllowed = !origin || isAllowedOrigin(origin, allowedOrigins);
  const headers = origin && originAllowed
    ? { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin }
    : BASE_CORS_HEADERS;
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...headers,
        ...buildPublicRateLimitHeaders({
          limit: 8,
          windowSeconds: 3600,
          retryAfterSeconds: status === 429 ? 3600 : null,
          remaining: status === 429 ? 0 : null,
        }),
        "Content-Type": "application/json",
      },
    });

  if (req.method === "OPTIONS") {
    return originAllowed
      ? new Response("ok", { headers })
      : new Response("Origin not allowed", { status: 403, headers });
  }
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  if (!originAllowed) return jsonResponse(403, { error: "Origin not allowed" });

  const ingressError = await requireTrustedEdgeIngress(req, "account-email-change", jsonResponse);
  if (ingressError) return ingressError;
  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return jsonResponse(503, { error: "Email change is unavailable." });
  }

  const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const fingerprint = resolveClientFingerprint(req, origin, { trustProxyHeader: true });
  const rateLimit = await enforcePreloginRateLimit(
    adminClient,
    fingerprint,
    `account-email-change-${fingerprint}`,
    8,
    3600,
  );
  if (!rateLimit.ok) {
    return rateLimit.error
      ? jsonResponse(503, { error: "Email change is unavailable." })
      : jsonResponse(429, { error: "Too many attempts. Try again later." });
  }

  try {
    const body = await readJsonBody<Record<string, unknown>>(req, 16 * 1024);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "request") {
      const authorization = req.headers.get("Authorization") ?? "";
      if (!/^Bearer\s+\S+/i.test(authorization)) return jsonResponse(401, { error: "Unauthorized" });
      const userClient = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      });
      const {
        data: { user },
        error: authError,
      } = await getExternalAuthUser(userClient, authorization);
      if (authError || !user?.id) return jsonResponse(401, { error: "Unauthorized" });

      const newEmail = requireEmail(body.new_email);
      const approvalToken = randomToken();
      const { data, error } = await adminClient.rpc("create_better_auth_email_change_request", {
        p_profile_id: user.id,
        p_new_email: newEmail,
        p_approval_token_hash: await sha256Hex(approvalToken),
        p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      if (error || !data || typeof data.current_email !== "string") {
        return jsonResponse(400, { error: "Unable to start this email change. Check the address and try again." });
      }

      const url = buildFlowURL("approve", approvalToken);
      if (!url) return jsonResponse(503, { error: "Email change is unavailable." });
      try {
        await callBetterAuthAdmin({
          action: "send_email_change_approval",
          email: data.current_email,
          newEmail,
          url,
        });
      } catch {
        return jsonResponse(503, { error: "Unable to send approval instructions. Try again." });
      }
      return jsonResponse(200, {
        success: true,
        message: "Approval instructions were sent to your current email address.",
      });
    }

    const token = typeof body.token === "string" ? body.token : "";
    if (!/^[0-9a-f]{64}$/.test(token)) return jsonResponse(400, { error: publicError });
    const tokenHash = await sha256Hex(token);

    if (action === "approve") {
      const verificationToken = randomToken();
      const { data, error } = await adminClient.rpc("approve_better_auth_email_change", {
        p_approval_token_hash: tokenHash,
        p_verification_token_hash: await sha256Hex(verificationToken),
      });
      if (error || !data || typeof data.new_email !== "string") {
        return jsonResponse(400, { error: publicError });
      }
      const url = buildFlowURL("verify", verificationToken);
      if (!url) return jsonResponse(503, { error: "Email change is unavailable." });
      try {
        await callBetterAuthAdmin({
          action: "send_email_change_verification",
          email: data.new_email,
          url,
        });
      } catch {
        // The approval token has been consumed. The account owner can start a
        // fresh request from Account Security if delivery fails transiently.
        return jsonResponse(503, { error: "Unable to send verification instructions. Start a new request from Account Security." });
      }
      return jsonResponse(200, {
        success: true,
        message: "Approval confirmed. Check the new email address to finish the change.",
      });
    }

    if (action === "verify") {
      const { data, error } = await adminClient.rpc("complete_better_auth_email_change", {
        p_verification_token_hash: tokenHash,
      });
      if (error || !data?.success) return jsonResponse(400, { error: publicError });
      return jsonResponse(200, {
        success: true,
        message: "Your sign-in email has been updated. Your current session remains active.",
      });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) return jsonResponse(400, { error: error.message });
    return jsonResponse(500, { error: "Email change could not be completed." });
  }
});
