import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import {
  canRegisterAdminStepUp,
  isMissingPrivilegedStepUpTable,
  registerPrivilegedStepUp,
} from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin || isAllowedOrigin(origin as string, allowedOrigins);
  const headers =
    hasOrigin && originAllowed
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

  try {
    const rawAuthHeader = req.headers.get("authorization") ?? "";
    const authToken = rawAuthHeader.replace(/^Bearer\s+/i, "").trim();
    if (!authToken) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");
    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${authToken}` } },
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
      .select("id, role, tenant_id, district_id, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.role) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (profile.role !== "tenant_admin" && profile.role !== "district_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (profile.role === "tenant_admin" && (!profile.tenant_id || profile.is_active === false)) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (profile.role === "district_admin" && !profile.district_id) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (!canRegisterAdminStepUp(authToken)) {
      return jsonResponse(403, { error: "Admin verification required." });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { expiresAt } = await registerPrivilegedStepUp(adminClient, {
      userId: user.id,
      roleScope: profile.role,
      authToken,
      source: "admin_login",
    });

    return jsonResponse(200, { data: { registered: true, expires_at: expiresAt } });
  } catch (error) {
    if (isMissingPrivilegedStepUpTable(error as { code?: string; message?: string })) {
      return jsonResponse(503, {
        error: "Privileged verification controls unavailable. Run latest SQL setup.",
      });
    }
    const message = error instanceof Error ? error.message : "Request failed.";
    return jsonResponse(500, { error: message || "Request failed." });
  }
});
