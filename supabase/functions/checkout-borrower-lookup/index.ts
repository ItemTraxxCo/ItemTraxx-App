import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { resolveRateLimitResult } from "../_shared/preloginGuards.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { validateAccountDeviceSession } from "../_shared/accountSessions.ts";
import {
  requireText,
  STUDENT_ID_PATTERN,
  ValidationError,
} from "../_shared/validation.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(
    Deno.env.get("ITX_ALLOWED_ORIGINS"),
  );
  const originAllowed = !origin || isAllowedOrigin(origin, allowedOrigins);
  const headers = origin && originAllowed
    ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin }
    : { ...baseCorsHeaders };
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return originAllowed
      ? new Response("ok", { headers })
      : new Response("Origin not allowed", { status: 403, headers });
  }
  if (origin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  const ingressError = await requireTrustedEdgeIngress(
    req,
    "checkout-borrower-lookup",
    jsonResponse,
  );
  if (ingressError) return ingressError;

  try {
    const authHeader = req.headers.get("authorization");
    const authToken = authHeader?.replace(/^Bearer\s+/i, "").trim() ?? "";
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");
    if (!authHeader) return jsonResponse(401, { error: "Unauthorized" });
    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth
      .getUser();
    if (authError || !authData.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("workspace_id, role, is_active")
      .eq("id", authData.user.id)
      .single();
    if (
      profileError || !profile?.workspace_id || profile.is_active === false ||
      !["tenant_account", "workspace_admin"].includes(profile.role)
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      { p_scope: "workspace", p_limit: 20, p_window_seconds: 30 },
    );
    const { result: limit, response: rateLimitFailure } = resolveRateLimitResult({
      data: rateLimit,
      error: rateLimitError,
      jsonResponse,
      failureStatus: 503,
    });
    if (rateLimitFailure) return rateLimitFailure;
    if (!limit?.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again shortly.",
        retry_after_seconds: limit?.retry_after_seconds ?? null,
      });
    }

    const body = await readJsonBody(req, 8 * 1024);
    const deviceId = typeof body.device_id === "string" ? body.device_id.trim() : "";
    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const activeSession = await validateAccountDeviceSession(adminClient,{workspaceId:profile.workspace_id,profileId:authData.user.id,deviceId,authToken});
    if(activeSession.relationMissing)return jsonResponse(503,{error:"Session controls unavailable"});
    if(!activeSession.valid)return jsonResponse(401,{error:"Session revoked"});
    const studentId = requireText(body.student_id, {
      maxLen: 6,
      pattern: STUDENT_ID_PATTERN,
      transform: "uppercase",
    });
    const { data: student, error: studentError } = await adminClient
      .from("students")
      .select("id, username, student_id, access_mode")
      .eq("workspace_id", profile.workspace_id)
      .eq("student_id", studentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (studentError) {
      return jsonResponse(500, { error: "Borrower lookup failed" });
    }
    if (!student) return jsonResponse(404, { error: "Borrower not found" });
    if (profile.role === "tenant_account" && student.access_mode === "restricted") {
      const { data: grant } = await adminClient.from("borrower_access_grants").select("student_id").eq("student_id", student.id).eq("profile_id", authData.user.id).maybeSingle();
      if (!grant) return jsonResponse(404, { error: "Borrower not found" });
    }
    return jsonResponse(200, { data: student });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: "Invalid request" });
    }
    console.error("checkout-borrower-lookup failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
