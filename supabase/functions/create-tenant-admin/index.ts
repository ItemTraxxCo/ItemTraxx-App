import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
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
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

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

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { new_email, new_password, current_password } = await req.json();
    if (
      typeof new_email !== "string" ||
      typeof new_password !== "string" ||
      typeof current_password !== "string"
    ) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const normalizedEmail = new_email.trim().toLowerCase();
    if (
      !normalizedEmail ||
      normalizedEmail.length > 120 ||
      !new_password ||
      new_password.length > 200 ||
      !current_password ||
      current_password.length > 200
    ) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !profile?.tenant_id || profile.role !== "tenant_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "admin",
        p_limit: 20,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      return jsonResponse(500, { error: "Rate limit check failed" });
    }

    const rateLimitResult = rateLimit as RateLimitResult;
    if (!rateLimitResult.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    if (!authData.user.email) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const verifyClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false },
    });

    const { data: verifyData, error: verifyError } =
      await verifyClient.auth.signInWithPassword({
        email: authData.user.email,
        password: current_password,
      });

    if (verifyError || !verifyData?.user || verifyData.user.id !== authData.user.id) {
      return jsonResponse(401, { error: "Invalid credentials" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: created, error: createError } =
      await adminClient.auth.admin.createUser({
        email: normalizedEmail,
        password: new_password,
        email_confirm: true,
      });

    if (createError || !created?.user) {
      return jsonResponse(400, { error: "Unable to create admin" });
    }

    const createdUserId = created.user.id;
    const { error: profileInsertError } = await adminClient
      .from("profiles")
      .insert({
        id: createdUserId,
        tenant_id: profile.tenant_id,
        role: "tenant_admin",
        auth_email: normalizedEmail,
      });

    if (profileInsertError) {
      console.error("create-tenant-admin profile insert failed", {
        message: profileInsertError.message,
        createdUserId,
        tenantId: profile.tenant_id,
      });

      const { error: rollbackError } =
        await adminClient.auth.admin.deleteUser(createdUserId);
      if (rollbackError) {
        console.error("create-tenant-admin rollback delete failed", {
          message: rollbackError.message,
          createdUserId,
        });
        return jsonResponse(500, { error: "Unable to create admin" });
      }

      return jsonResponse(500, { error: "Unable to create admin" });
    }

    return jsonResponse(200, { success: true, user_id: createdUserId });
  } catch (error) {
    console.error("create-tenant-admin function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
