import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { resolveClientFingerprint, resolveClientIp } from "../_shared/preloginGuards.ts";
import { isAikidoPentestTurnstileBypassRequest } from "../_shared/aikidoPentest.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, aikido-scan-agent",
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

const enforceRateLimit = async (
  client: any,
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

const isLocalhostMaintenanceBypassRequest = (req: Request) => {
  if ((Deno.env.get("ITX_ALLOW_LOCALHOST_MAINTENANCE_BYPASS") ?? "").toLowerCase() !== "true") {
    return false;
  }
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
      return true;
    }
    if (hostname.startsWith("192.168.") || hostname.startsWith("10.")) {
      return true;
    }
    const match172 = hostname.match(/^172\.(\d{1,3})\./);
    if (!match172) return false;
    const secondOctet = Number(match172[1]);
    return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
  } catch {
    return false;
  }
};

const verifyTurnstileToken = async (
  secret: string,
  token: string,
  remoteIp: string
) => {
  const submitVerification = async (ip?: string) => {
    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", token);
    if (ip) {
      params.set("remoteip", ip);
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
      console.error("tenant-login turnstile verification request failed", {
        status: response.status,
        usedRemoteIp: Boolean(ip),
      });
      return null;
    }

    return (await response.json()) as TurnstileVerifyResult;
  };

  const initialResult = await submitVerification(remoteIp || undefined);
  if (initialResult?.success) {
    return true;
  }

  if (remoteIp) {
    const fallbackResult = await submitVerification();
    if (fallbackResult?.success) {
      console.warn("tenant-login turnstile verification succeeded after retry without remote IP");
      return true;
    }
    if (fallbackResult) {
      console.error("tenant-login turnstile verification failed", {
        errorCodes: fallbackResult["error-codes"] ?? [],
        retriedWithoutRemoteIp: true,
      });
      return false;
    }
  }

  if (initialResult) {
    console.error("tenant-login turnstile verification failed", {
      errorCodes: initialResult["error-codes"] ?? [],
      retriedWithoutRemoteIp: false,
    });
  }
  return false;
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOriginsEnv = Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "";
  const allowedOrigins = parseAllowedOrigins(allowedOriginsEnv);

  const hasOrigin = !!origin;
  const originAllowed =
    hasOrigin && isAllowedOrigin(origin as string, allowedOrigins);

  const headers =
    hasOrigin && originAllowed
      ? { ...corsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...corsHeaders };

  return { origin, hasOrigin, originAllowed, headers };
};

serve(async (req) => {
  const { origin, hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);
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
    const { access_code, turnstile_token, district_slug } = await req.json();
    if (
      typeof access_code !== "string" ||
      !access_code.trim() ||
      access_code.trim().length > 64
    ) {
      return jsonResponse(400, { error: "Invalid request" });
    }
    const normalizedDistrictSlug =
      typeof district_slug === "string" &&
      district_slug.trim() &&
      district_slug.trim().length <= 63
        ? district_slug.trim().toLowerCase()
        : null;

    const turnstileSecret = Deno.env.get("ITX_TURNSTILE_SECRET") ?? "";
    const turnstileToken =
      typeof turnstile_token === "string" ? turnstile_token.trim() : "";
    const bypassTurnstileForAikido = isAikidoPentestTurnstileBypassRequest(req, turnstileToken);
    if (turnstileSecret) {
      if (!bypassTurnstileForAikido) {
        if (
          !turnstileToken ||
          turnstileToken.length > 4096
        ) {
          return jsonResponse(400, { error: "Turnstile verification required" });
        }
        const isTurnstileValid = await verifyTurnstileToken(
          turnstileSecret,
          turnstileToken,
          resolveClientIp(req)
        );
        if (!isTurnstileValid) {
          return jsonResponse(403, { error: "Turnstile verification failed" });
        }
      } else {
        console.info("tenant-login bypassed turnstile for vetted Aikido scan traffic", {
          request_id: requestId,
          client_ip: resolveClientIp(req) || "unknown",
        });
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
    if (maintenanceValue.enabled === true && !isLocalhostMaintenanceBypassRequest(req)) {
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
          message: (perClientLimit.error as { message?: string } | null)?.message ?? null,
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
          message: (perAccessLimit.error as { message?: string } | null)?.message ?? null,
          scope: perClientAccessScope,
          origin: origin ?? null,
        });
        return jsonResponse(503, { error: "Rate limit check failed" });
      }
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    let districtId: string | null = null;
    if (normalizedDistrictSlug) {
      const { data: district, error: districtError } = await adminClient
        .from("districts")
        .select("id, is_active")
        .eq("slug", normalizedDistrictSlug)
        .maybeSingle();

      if (districtError || !district?.id || district.is_active === false) {
        return jsonResponse(401, { error: "Invalid access code" });
      }
      districtId = district.id;
    }

    let tenantQuery = adminClient
      .from("tenants")
      .select("id, status, district_id")
      .eq("access_code", normalizedAccessCode);

    if (districtId) {
      tenantQuery = tenantQuery.eq("district_id", districtId);
    }

    const { data: tenant, error: tenantError } = await tenantQuery.single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(401, { error: "Invalid access code" });
    }

    if (tenant.status !== "active") {
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

    let resolvedDistrictSlug = normalizedDistrictSlug;
    if (!resolvedDistrictSlug && tenant.district_id) {
      const { data: district } = await adminClient
        .from("districts")
        .select("slug")
        .eq("id", tenant.district_id)
        .maybeSingle();
      resolvedDistrictSlug =
        typeof district?.slug === "string" && district.slug.trim()
          ? district.slug.trim().toLowerCase()
          : null;
    }

    return jsonResponse(200, {
      auth_email: selectedProfile.auth_email,
      district_slug: resolvedDistrictSlug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("tenant-login function error", {
      request_id: requestId,
      message,
      stack,
      origin: origin ?? null,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
