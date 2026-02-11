import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && allowedOrigins.includes(origin as string));

  const headers =
    hasOrigin && originAllowed
      ? { ...corsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...corsHeaders };

  return { hasOrigin, originAllowed, headers };
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
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

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, {
      status: "down",
      checks: {
        config: "failed",
        db: "unknown",
      },
      duration_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { error } = await adminClient
      .from("profiles")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      return jsonResponse(503, {
        status: "down",
        checks: {
          config: "ok",
          db: "failed",
        },
        duration_ms: Date.now() - startedAt,
        checked_at: new Date().toISOString(),
      });
    }

    return jsonResponse(200, {
      status: "operational",
      checks: {
        config: "ok",
        db: "ok",
      },
      duration_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  } catch {
    return jsonResponse(503, {
      status: "down",
      checks: {
        config: "ok",
        db: "failed",
      },
      duration_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  }
});
