import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { resolveRateLimitResult } from "../_shared/preloginGuards.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { sha256Hex } from "../_shared/sha256.ts";
import { resolveTenantAdminAuthSessionBinding } from "../_shared/tenantAdminSessions.ts";
import {
  asRecord,
  requireText,
  ValidationError,
} from "../_shared/validation.ts";
import {
  authorizeAdminOpsAction,
  dispatchAdminOpsAction,
} from "./actions/index.ts";
import {
  normalizeTenantUpdates,
  resolveMaintenance,
} from "./actions/notifications.ts";
import {
  findActiveSession,
  resolveDeviceSessionContext,
} from "./actions/sessions.ts";
import { resolveTenantPolicyState } from "./actions/settings.ts";
import type { AdminOpsContext } from "./context.ts";

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
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
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

  const ingressError = await requireTrustedEdgeIngress(
    req,
    "admin-ops",
    jsonResponse,
  );
  if (ingressError) return ingressError;

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, {
      error: "Unfortunately ItemTraxx is currently unavailable.",
    });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const authToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const authSessionBinding = await resolveTenantAdminAuthSessionBinding(
      adminClient,
      authToken,
    );
    const authTokenBindingKey = authSessionBinding.sessionId
      ? `session:${authSessionBinding.sessionId}`
      : `token:${await sha256Hex(authToken)}`;

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("tenant_id, role, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (profile.role !== "tenant_admin" && profile.role !== "tenant_user") {
      return jsonResponse(403, { error: "Access denied" });
    }
    if (profile.is_active === false) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: profile.role === "tenant_admin" ? "admin" : "tenant",
        p_limit: profile.role === "tenant_admin" ? 30 : 25,
        p_window_seconds: 60,
      },
    );

    const { result: rateLimitResult, response: rateLimitFailure } =
      resolveRateLimitResult({
        data: rateLimit,
        error: rateLimitError,
        jsonResponse,
      });
    if (rateLimitFailure) return rateLimitFailure;
    if (!rateLimitResult?.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const requestBody = asRecord(await readJsonBody(req));
    const normalizedAction = requireText(requestBody.action, { maxLen: 64 });
    const payloadRecord = asRecord(requestBody.payload ?? {});
    const isSessionAction = normalizedAction === "touch_session" ||
      normalizedAction === "validate_session" ||
      normalizedAction === "list_sessions" ||
      normalizedAction === "revoke_current_session" ||
      normalizedAction === "revoke_session" ||
      normalizedAction === "revoke_all_sessions";

    const tenantId = profile.tenant_id as string;
    const { data: tenantStatus } = await userClient
      .from("tenants")
      .select("status")
      .eq("id", tenantId)
      .maybeSingle();
    const isTenantSuspended = !!tenantStatus?.status &&
      tenantStatus.status !== "active";
    const deviceSession = resolveDeviceSessionContext(payloadRecord, req);

    const sessionSecurityContext = {
      adminClient,
      tenantId,
      user: { id: user.id },
      authToken,
      authSessionBinding,
      authTokenBindingKey,
      deviceSession,
      requestId,
    };

    if (profile.role === "tenant_admin" && !isSessionAction) {
      const activeSession = await findActiveSession(sessionSecurityContext);
      if (activeSession.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeSession.exists) {
        if (activeSession.revoked) {
          return jsonResponse(401, { error: "Session revoked" });
        }
        return jsonResponse(401, { error: "Session revoked" });
      }
    }

    if (
      profile.role === "tenant_admin" &&
      (normalizedAction === "list_sessions" ||
        normalizedAction === "revoke_current_session" ||
        normalizedAction === "revoke_session" ||
        normalizedAction === "revoke_all_sessions")
    ) {
      const activeSession = await findActiveSession(sessionSecurityContext);
      if (activeSession.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeSession.exists) {
        return jsonResponse(401, { error: "Session revoked" });
      }
    }

    const [maintenanceRuntimeResult, updateRuntimeResult] = await Promise.all([
      adminClient
        .from("app_runtime_config")
        .select("value")
        .eq("key", "maintenance_mode")
        .maybeSingle(),
      adminClient
        .from("app_runtime_config")
        .select("value")
        .eq("key", "tenant_updates")
        .maybeSingle(),
    ]);
    const maintenance = resolveMaintenance(
      maintenanceRuntimeResult.data?.value,
    );

    const { tenantPolicy, checkoutDueHours, featureFlags } =
      await resolveTenantPolicyState(adminClient, tenantId);

    const updateRuntimeValue = updateRuntimeResult.data?.value;
    const tenantUpdates = normalizeTenantUpdates(updateRuntimeValue);

    const actionAuthorizationFailure = await authorizeAdminOpsAction({
      action: normalizedAction,
      profileRole: profile.role,
      isTenantSuspended,
      adminClient,
      userId: user.id,
      authToken,
      jsonResponse,
    });
    if (actionAuthorizationFailure) return actionAuthorizationFailure;

    const context: AdminOpsContext = {
      requestId,
      action: normalizedAction,
      payload: payloadRecord,
      adminClient,
      user: { id: user.id },
      tenantId,
      authToken,
      authSessionBinding,
      authTokenBindingKey,
      deviceSession,
      tenantPolicy,
      checkoutDueHours,
      featureFlags,
      maintenance,
      tenantUpdates,
      jsonResponse,
    };
    return dispatchAdminOpsAction(context);
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("admin-ops function error", {
      request_id: requestId,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
