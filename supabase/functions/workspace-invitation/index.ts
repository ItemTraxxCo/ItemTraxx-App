import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { callBetterAuthAdmin } from "../_shared/betterAuthAdmin.ts";
import { sha256Hex } from "../_shared/sha256.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import {
  enforcePreloginRateLimit,
  resolveClientFingerprint,
} from "../_shared/preloginGuards.ts";
import { buildPublicRateLimitHeaders } from "../_shared/publicRateLimit.ts";
import {
  isWorkspaceInvitationToken,
  meetsWorkspaceInvitePasswordPolicy,
} from "./invitationPolicy.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

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
          limit: 10,
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

  const ingressError = await requireTrustedEdgeIngress(req, "workspace-invitation", jsonResponse);
  if (ingressError) return ingressError;
  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return jsonResponse(503, { error: "Invitation acceptance is unavailable." });

  const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const fingerprint = resolveClientFingerprint(req, origin, { trustProxyHeader: true });
  const limit = await enforcePreloginRateLimit(
    adminClient,
    fingerprint,
    `workspace-invitation-${fingerprint}`,
    10,
    3600,
  );
  if (!limit.ok) {
    return limit.error
      ? jsonResponse(503, { error: "Invitation acceptance is unavailable." })
      : jsonResponse(429, { error: "Too many attempts. Try again later." });
  }

  try {
    const body = await readJsonBody<Record<string, unknown>>(req, 16 * 1024);
    const token = body.token;
    const password = typeof body.password === "string" ? body.password : "";
    if (!isWorkspaceInvitationToken(token) || !meetsWorkspaceInvitePasswordPolicy(password)) {
      return jsonResponse(400, { error: "This invitation cannot be accepted. Request a new invitation or contact the workspace admin." });
    }

    await callBetterAuthAdmin({
      action: "accept_workspace_account_invitation",
      tokenHash: await sha256Hex(token),
      password,
    });
    return jsonResponse(200, { success: true });
  } catch {
    // A used, expired, revoked, or ineligible address all have the same
    // response. No account or session is created unless the token is valid.
    return jsonResponse(400, { error: "This invitation cannot be accepted. Request a new invitation or contact the workspace admin." });
  }
});
