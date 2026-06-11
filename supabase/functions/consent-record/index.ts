import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import {
  enforcePreloginRateLimit,
  resolveClientFingerprint,
} from "../_shared/preloginGuards.ts";

const corsBase = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const jsonResponse = (
  status: number,
  body: unknown,
  headers: HeadersInit = corsBase,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(
    Deno.env.get("ITX_ALLOWED_ORIGINS"),
  );
  const originAllowed = !origin || isAllowedOrigin(origin, allowedOrigins);
  const headers = origin && originAllowed
    ? { ...corsBase, "Access-Control-Allow-Origin": origin }
    : corsBase;

  if (req.method === "OPTIONS") {
    return originAllowed
      ? new Response("ok", { headers })
      : new Response("Origin not allowed", { status: 403, headers });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, headers);
  }
  if (origin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" }, headers);
  }

  const ingressError = await requireTrustedEdgeIngress(
    req,
    "consent-record",
    (status, body) => jsonResponse(status, body, headers),
  );
  if (ingressError) return ingressError;

  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
  const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY");
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return jsonResponse(500, { error: "Server misconfiguration" }, headers);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const fingerprint = resolveClientFingerprint(req, origin);
  const rateLimit = await enforcePreloginRateLimit(
    adminClient,
    fingerprint,
    `consent-record-${fingerprint}`,
    30,
    60,
  );
  if (!rateLimit.ok) {
    return rateLimit.error
      ? jsonResponse(503, { error: "Rate limit check failed" }, headers)
      : jsonResponse(429, { error: "Too many requests" }, headers);
  }
  const body = await readJsonBody<Record<string, unknown>>(req, 16 * 1024);
  if (
    typeof body.subject_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.subject_id) ||
    body.consent_version !== 2 ||
    typeof body.analytics !== "boolean" ||
    typeof body.diagnostics !== "boolean" ||
    typeof body.consented_at !== "string" ||
    !Number.isFinite(Date.parse(body.consented_at))
  ) {
    return jsonResponse(400, { error: "Invalid request" }, headers);
  }

  let profileId: string | null = null;
  if (token) {
    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData } = await authClient.auth.getUser(token);
    profileId = userData.user?.id ?? null;
  }

  const { error: writeError } = await adminClient.from("cookie_consent_records")
    .upsert(
      {
        subject_id: body.subject_id,
        profile_id: profileId,
        consent_version: 2,
        analytics: body.analytics,
        diagnostics: body.diagnostics,
        consented_at: body.consented_at,
        recorded_at: new Date().toISOString(),
      },
      { onConflict: "subject_id,consent_version" },
    );
  if (writeError) {
    console.error("consent-record write failed", { message: writeError.message });
    return jsonResponse(503, { error: "Unable to record consent" }, headers);
  }

  return jsonResponse(200, { data: { recorded: true } }, headers);
});
