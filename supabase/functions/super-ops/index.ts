import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import {
  asRecord,
  requireText,
  ValidationError,
} from "../_shared/validation.ts";
import { enforcePreloginRateLimit } from "../_shared/preloginGuards.ts";
import { isSuperAdminTokenBlockedBySessionRevocation } from "../_shared/superAdminSessions.ts";
import { dispatchSuperOpsAction } from "./actions/index.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(
    Deno.env.get("ITX_ALLOWED_ORIGINS"),
  );

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin ||
    (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

  const headers = hasOrigin && originAllowed
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

  const ingressError = await requireTrustedEdgeIngress(
    req,
    "super-ops",
    jsonResponse,
  );
  if (ingressError) return ingressError;

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, {
      error: "Unfortunately ItemTraxx is currently unavailable.",
    });
  }

  try {
    const authHeader = req.headers.get("authorization") ??
      req.headers.get("x-itx-user-jwt");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    // Prefer ITX_* secrets, but fall back to Supabase default injected env vars.
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ??
      Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        experimental: { passkey: true },
      },
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
      .select("role, auth_email, is_active")
      .eq("id", user.id)
      .single();

    if (
      profileError || profile?.role !== "super_admin" ||
      profile.is_active === false
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const revocation = await isSuperAdminTokenBlockedBySessionRevocation(
      adminClient,
      { profileId: user.id, authToken: accessToken },
    );
    if (revocation.relationMissing) {
      return jsonResponse(503, {
        error: "Session controls unavailable. Run latest SQL setup.",
      });
    }
    if (revocation.blocked) {
      return jsonResponse(401, { error: "Session revoked." });
    }

    const parsedBody = asRecord(await readJsonBody(req));
    const action = requireText(parsedBody.action, { maxLen: 64 });
    const payload = asRecord(parsedBody.payload ?? {});

    const securitySettingsActions = new Set([
      "verify_password",
      "touch_session",
      "list_sessions",
      "list_passkeys",
      "revoke_session",
      "revoke_all_sessions",
    ]);

    if (!securitySettingsActions.has(action)) {
      try {
        const hasStepUp = await hasPrivilegedStepUp(adminClient, {
          userId: user.id,
          roleScope: "super_admin",
          authToken: accessToken,
        });
        if (!hasStepUp) {
          return jsonResponse(403, {
            error: "Super admin verification required.",
          });
        }
      } catch (error) {
        if (
          isMissingPrivilegedStepUpTable(
            error as { code?: string; message?: string },
          )
        ) {
          return jsonResponse(503, {
            error:
              "Privileged verification controls unavailable. Run latest SQL setup.",
          });
        }
        throw error;
      }
    }

    const rateLimit = await enforcePreloginRateLimit(
      adminClient,
      user.id,
      `super-admin-ops-${user.id}`,
      30,
      60,
    );

    if (!rateLimit.ok) {
      if (rateLimit.error) {
        console.error("super-ops rate limit rpc failed", {
          message: rateLimit.error.message,
        });
        return jsonResponse(503, { error: "Rate limit check failed." });
      }
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const writeAudit = async (
      actionType: string,
      targetType: string,
      targetId: string | null,
      metadata: Record<string, unknown>,
    ) => {
      const { error } = await adminClient.from("super_admin_audit_logs").insert(
        {
          actor_id: user.id,
          actor_email: profile.auth_email ?? user.email ?? null,
          action_type: actionType,
          target_type: targetType,
          target_id: targetId,
          metadata,
        },
      );
      if (error) throw new Error("Unable to write security audit log.");
    };

    return await dispatchSuperOpsAction({
      req,
      action,
      payload,
      adminClient,
      user,
      profile,
      accessToken,
      supabaseUrl,
      publishableKey: publishableKey ?? null,
      jsonResponse,
      writeAudit,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("super-ops function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
