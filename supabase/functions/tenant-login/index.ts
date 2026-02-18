import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

type TurnstileVerifyResult = {
  success: boolean;
  "error-codes"?: string[];
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hashString = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(new Uint8Array(digest));
};

const normalizeScopePart = (value: string, fallback: string, maxLen = 32) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, maxLen);
};

const resolveClientFingerprint = (req: Request, origin: string | null) => {
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim() ?? "";
  const connectingIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  const realIp = req.headers.get("x-real-ip")?.trim() ?? "";
  const ipCandidate = firstForwardedIp || connectingIp || realIp;

  if (ipCandidate) {
    return `ip-${normalizeScopePart(ipCandidate, "unknown-ip", 24)}`;
  }

  if (origin) {
    return `origin-${normalizeScopePart(origin, "unknown-origin", 24)}`;
  }

  return "unknown-client";
};

const enforceRateLimit = async (
  client: ReturnType<typeof createClient>,
  key: string,
  scope: string,
  limit: number,
  windowSeconds: number
) => {
  const { data, error } = await client.rpc("consume_rate_limit_prelogin", {
    p_key: key,
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    return { ok: false as const, error };
  }

  const result = data as RateLimitResult;
  if (!result.allowed) {
    return { ok: false as const, error: null };
  }

  return { ok: true as const, error: null };
};

const resolveClientIp = (req: Request) => {
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim() ?? "";
  const connectingIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  const realIp = req.headers.get("x-real-ip")?.trim() ?? "";
  return firstForwardedIp || connectingIp || realIp || "";
};

const verifyTurnstileToken = async (
  secret: string,
  token: string,
  remoteIp: string
) => {
  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", token);
  if (remoteIp) {
    params.set("remoteip", remoteIp);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    return false;
  }

  const result = (await response.json()) as TurnstileVerifyResult;
  if (!result.success) {
    console.error("tenant-login turnstile verification failed", {
      errorCodes: result["error-codes"] ?? [],
    });
  }
  return !!result.success;
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOriginsEnv = Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "";
  const allowedOrigins = allowedOriginsEnv
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

  return { origin, hasOrigin, originAllowed, headers };
};

serve(async (req) => {
  const { origin, hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    if (originAllowed) {
      return new Response("ok", { headers });
    }
    return new Response("Origin not allowed", {
      status: 403,
      headers,
    });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  try {
    const { access_code, turnstile_token } = await req.json();
    if (
      typeof access_code !== "string" ||
      !access_code.trim() ||
      access_code.trim().length > 64
    ) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const turnstileSecret = Deno.env.get("ITX_TURNSTILE_SECRET") ?? "";
    if (turnstileSecret) {
      if (
        typeof turnstile_token !== "string" ||
        !turnstile_token.trim() ||
        turnstile_token.trim().length > 4096
      ) {
        return jsonResponse(400, { error: "Turnstile verification required" });
      }
      const isTurnstileValid = await verifyTurnstileToken(
        turnstileSecret,
        turnstile_token.trim(),
        resolveClientIp(req)
      );
      if (!isTurnstileValid) {
        return jsonResponse(403, { error: "Turnstile verification failed" });
      }
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: maintenanceRow } = await adminClient
      .from("app_runtime_config")
      .select("value")
      .eq("key", "maintenance_mode")
      .maybeSingle();
    const maintenanceValue =
      maintenanceRow?.value && typeof maintenanceRow.value === "object"
        ? (maintenanceRow.value as Record<string, unknown>)
        : {};
    if (maintenanceValue.enabled === true) {
      return jsonResponse(503, {
        error:
          typeof maintenanceValue.message === "string" && maintenanceValue.message.trim()
            ? maintenanceValue.message.trim()
            : "Maintenance mode enabled.",
      });
    }

    const normalizedAccessCode = access_code.trim();
    const clientFingerprint = resolveClientFingerprint(req, origin);
    const accessCodeHash = await hashString(normalizedAccessCode);
    const perClientScope = `tenant-login-client-${clientFingerprint}`;
    const perClientAccessScope = `tenant-login-client-access-${clientFingerprint}-${accessCodeHash.slice(
      0,
      12
    )}`;

    // Two throttles:
    // 1) per-client to prevent one actor exhausting global login capacity
    // 2) per-client-per-access-code to slow targeted brute force attempts
    const perClientLimit = await enforceRateLimit(
      adminClient,
      clientFingerprint,
      perClientScope,
      20,
      60
    );
    if (!perClientLimit.ok) {
      if (perClientLimit.error) {
        console.error("tenant-login rate limit check failed", {
          message: perClientLimit.error.message,
          scope: perClientScope,
          origin: origin ?? null,
        });
        return jsonResponse(503, { error: "Rate limit check failed" });
      }
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const perAccessLimit = await enforceRateLimit(
      adminClient,
      `${clientFingerprint}-${accessCodeHash.slice(0, 16)}`,
      perClientAccessScope,
      10,
      60
    );
    if (!perAccessLimit.ok) {
      if (perAccessLimit.error) {
        console.error("tenant-login rate limit check failed", {
          message: perAccessLimit.error.message,
          scope: perClientAccessScope,
          origin: origin ?? null,
        });
        return jsonResponse(503, { error: "Rate limit check failed" });
      }
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const { data: tenant, error: tenantError } = await adminClient
      .from("tenants")
      .select("id, status")
      .eq("access_code", normalizedAccessCode)
      .single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(401, { error: "Invalid access code" });
    }

    if (tenant.status === "suspended") {
      return jsonResponse(403, { error: "Tenant disabled" });
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
