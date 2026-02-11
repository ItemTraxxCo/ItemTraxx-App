import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const allowedOriginsEnv = Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "";
  const allowedOrigins = allowedOriginsEnv
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const isAllowedOrigin = !!origin && allowedOrigins.includes(origin);
  const responseHeaders = isAllowedOrigin
    ? { ...corsHeaders, "Access-Control-Allow-Origin": origin }
    : { ...corsHeaders };

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...responseHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    if (isAllowedOrigin) {
      return new Response("ok", { headers: responseHeaders });
    }
    return new Response("Origin not allowed", {
      status: 403,
      headers: responseHeaders,
    });
  }

  if (origin && !isAllowedOrigin) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  try {
    const { access_code } = await req.json();
    if (!access_code || typeof access_code !== "string") {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: tenant, error: tenantError } = await adminClient
      .from("tenants")
      .select("id")
      .eq("access_code", access_code)
      .single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(401, { error: "Invalid access code" });
    }

    const { data: profiles, error: profileError } = await adminClient
      .from("profiles")
      .select("auth_email, role")
      .eq("tenant_id", tenant.id)
      .in("role", ["tenant_user", "tenant_admin"]);

    if (profileError || !profiles?.length) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const selectedProfile =
      profiles.find((profile) => profile.role === "tenant_user") ?? profiles[0];

    if (!selectedProfile?.auth_email) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    return jsonResponse(200, { auth_email: selectedProfile.auth_email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("tenant-login function error", {
      message,
      stack,
      origin: origin ?? null,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
