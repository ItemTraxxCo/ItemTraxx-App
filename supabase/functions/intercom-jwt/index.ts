import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import {
  createIntercomJwt,
  INTERCOM_JWT_TTL_SECONDS,
} from "../_shared/intercomJwt.ts";
import { getRequestId } from "../_shared/observability.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));
  const originAllowed = !origin || isAllowedOrigin(origin, allowedOrigins);
  const headers = origin && originAllowed
    ? { ...corsHeaders, "Access-Control-Allow-Origin": origin }
    : corsHeaders;
  return { originAllowed, headers };
};

const parseAuthToken = (req: Request) =>
  req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() ?? "";

serve(async (req) => {
  const { originAllowed, headers } = resolveCorsHeaders(req);
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
    return originAllowed
      ? new Response("ok", { headers })
      : new Response("Origin not allowed", { status: 403, headers });
  }
  if (!originAllowed) return jsonResponse(403, { error: "Origin not allowed" });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const ingressError = await requireTrustedEdgeIngress(req, "intercom-jwt", jsonResponse);
  if (ingressError) return ingressError;

  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL")?.trim();
  const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY")?.trim();
  // ITX_ is the documented canonical prefix. Keep the previously provisioned
  // TX_ name as a server-side fallback so an existing deployment keeps working
  // while the secret is migrated without exposing either value to the client.
  const intercomSecret = (
    Deno.env.get("ITX_INTERCOM_MESSENGER_SECRET") ??
    Deno.env.get("TX_INTERCOM_MESSENGER_SECRET")
  )?.trim();
  if (!supabaseUrl || !publishableKey || !intercomSecret) {
    return jsonResponse(500, { error: "Server misconfiguration." });
  }

  const accessToken = parseAuthToken(req);
  if (!accessToken) return jsonResponse(401, { error: "Authentication required." });

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user?.id) {
    return jsonResponse(401, { error: "Authentication required." });
  }

  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await createIntercomJwt(
      { id: data.user.id, email: data.user.email },
      intercomSecret,
      nowSeconds,
    );
    return jsonResponse(200, {
      data: {
        token,
        expires_at: nowSeconds + INTERCOM_JWT_TTL_SECONDS,
      },
    });
  } catch {
    return jsonResponse(500, { error: "Unable to create Messenger token." });
  }
});
