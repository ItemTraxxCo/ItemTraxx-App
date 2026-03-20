import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  enforcePreloginRateLimit,
  hashString,
  resolveClientFingerprint,
  resolveClientIp,
  verifyTurnstileToken,
} from "../_shared/preloginGuards.ts";

type ProfileRow = {
  role: string | null;
  tenant_id: string | null;
  district_id: string | null;
  is_active: boolean | null;
};

type DistrictLookupRow = {
  slug: string | null;
  is_active: boolean | null;
};

type TenantLookupRow = {
  district_id: string | null;
  status: string | null;
};

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const jsonResponse = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string>
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

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

  if (req.method === "OPTIONS") {
    if (!originAllowed) {
      return new Response("Origin not allowed", { status: 403, headers });
    }
    return new Response(null, { headers });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" }, headers);
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, headers);
  }

  try {
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" }, headers);
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action.trim() : "";
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const resolveDistrictSlugForProfile = async (
      profile: ProfileRow | null,
    ): Promise<string | { error: "Tenant disabled" } | null> => {
      if (typeof profile?.district_id === "string" && profile.district_id) {
        const { data: district } = await adminClient
          .from("districts")
          .select("slug, is_active")
          .eq("id", profile.district_id)
          .single<DistrictLookupRow>();
        if (district?.slug && district.is_active !== false) {
          return district.slug;
        }
      }

      if (typeof profile?.tenant_id === "string" && profile.tenant_id) {
        const { data: tenant } = await adminClient
          .from("tenants")
          .select("district_id, status")
          .eq("id", profile.tenant_id)
          .single<TenantLookupRow>();

        if (tenant?.status && tenant.status !== "active") {
          return { error: "Tenant disabled" };
        }

        if (tenant?.district_id) {
          const { data: district } = await adminClient
            .from("districts")
            .select("slug, is_active")
            .eq("id", tenant.district_id)
            .single<DistrictLookupRow>();
          if (district?.slug && district.is_active !== false) {
            return district.slug;
          }
        }
      }

      return null;
    };

    if (action === "create") {
      const districtSlug =
        typeof body?.district_slug === "string"
          ? body.district_slug.trim().toLowerCase()
          : "";
      const authHeader = req.headers.get("authorization") ?? "";
      const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!accessToken || !districtSlug) {
        return jsonResponse(400, { error: "Invalid request" }, headers);
      }

      const userClient = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false },
      });
      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();

      if (userError || !user?.id || !user.email) {
        return jsonResponse(401, { error: "Unauthorized" }, headers);
      }

      const { data: profile } = await adminClient
        .from("profiles")
        .select("role, tenant_id, district_id, is_active")
        .eq("id", user.id)
        .single<ProfileRow>();

      if (
        (profile?.role !== "tenant_user" && profile?.role !== "tenant_admin") ||
        profile?.is_active === false
      ) {
        return jsonResponse(403, { error: "Access denied" }, headers);
      }

      const resolvedDistrictSlug = await resolveDistrictSlugForProfile(profile ?? null);
      if (
        typeof resolvedDistrictSlug === "object" &&
        resolvedDistrictSlug?.error === "Tenant disabled"
      ) {
        return jsonResponse(403, { error: "Tenant disabled" }, headers);
      }
      if (!resolvedDistrictSlug || resolvedDistrictSlug !== districtSlug) {
        return jsonResponse(404, { error: "District not found" }, headers);
      }

      const magicLink = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: user.email,
      });

      if (magicLink.error || !magicLink.data.properties.email_otp) {
        return jsonResponse(500, { error: "Unable to create handoff" }, headers);
      }

      return jsonResponse(
        200,
        {
          hashed_token: magicLink.data.properties.hashed_token,
        },
        headers,
      );
    }

    if (action === "create_admin") {
      const email =
        typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const turnstileToken =
        typeof body?.turnstile_token === "string"
          ? body.turnstile_token.trim()
          : "";

      if (!email || !password || !turnstileToken) {
        return jsonResponse(400, { error: "Invalid request" }, headers);
      }

      const turnstileSecret = Deno.env.get("ITX_TURNSTILE_SECRET") ?? "";
      if (!turnstileSecret) {
        return jsonResponse(500, { error: "Server misconfiguration" }, headers);
      }

      const origin = req.headers.get("Origin");
      const clientIp = resolveClientIp(req);
      const emailHash = await hashString(email);
      const clientFingerprint = resolveClientFingerprint(req, origin);

      const perClientLimit = await enforcePreloginRateLimit(
        adminClient,
        clientFingerprint,
        `district-admin-login-client-${clientFingerprint}`,
        15,
        60,
      );
      if (!perClientLimit.ok) {
        if (perClientLimit.error) {
          console.error("district-handoff create_admin rate limit failed", {
            scope: `district-admin-login-client-${clientFingerprint}`,
            message: perClientLimit.error.message,
          });
          return jsonResponse(503, { error: "Rate limit check failed" }, headers);
        }
        return jsonResponse(
          429,
          { error: "Rate limit exceeded, please try again in a minute." },
          headers,
        );
      }

      const perEmailLimit = await enforcePreloginRateLimit(
        adminClient,
        `${clientFingerprint}-${emailHash.slice(0, 16)}`,
        `district-admin-login-email-${emailHash.slice(0, 12)}`,
        8,
        60,
      );
      if (!perEmailLimit.ok) {
        if (perEmailLimit.error) {
          console.error("district-handoff create_admin rate limit failed", {
            scope: `district-admin-login-email-${emailHash.slice(0, 12)}`,
            message: perEmailLimit.error.message,
          });
          return jsonResponse(503, { error: "Rate limit check failed" }, headers);
        }
        return jsonResponse(
          429,
          { error: "Rate limit exceeded, please try again in a minute." },
          headers,
        );
      }

      const turnstileValid = await verifyTurnstileToken(
        turnstileSecret,
        turnstileToken,
        clientIp,
        "district-handoff create_admin",
      );
      if (!turnstileValid) {
        return jsonResponse(403, { error: "Turnstile verification failed" }, headers);
      }

      const userClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false },
      });
      const signIn = await userClient.auth.signInWithPassword({ email, password });

      if (
        signIn.error ||
        !signIn.data.user?.id ||
        !signIn.data.session?.access_token ||
        !signIn.data.session?.refresh_token
      ) {
        return jsonResponse(401, { error: "Invalid credentials" }, headers);
      }

      const user = signIn.data.user;
      const session = signIn.data.session;
      const { data: profile } = await adminClient
        .from("profiles")
        .select("role, tenant_id, district_id, is_active")
        .eq("id", user.id)
        .single<ProfileRow>();

      const role = profile?.role;
      if (
        (role !== "tenant_admin" && role !== "district_admin") ||
        profile?.is_active === false
      ) {
        return jsonResponse(403, { error: "Access denied" }, headers);
      }

      const resolvedDistrictSlug = await resolveDistrictSlugForProfile(profile ?? null);
      if (
        typeof resolvedDistrictSlug === "object" &&
        resolvedDistrictSlug?.error === "Tenant disabled"
      ) {
        return jsonResponse(403, { error: "Tenant disabled" }, headers);
      }

      if (!resolvedDistrictSlug) {
        return jsonResponse(
          200,
          {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            role,
            root_only: true,
          },
          headers,
        );
      }

      const magicLink = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (magicLink.error || !magicLink.data.properties.email_otp) {
        return jsonResponse(500, { error: "Unable to create handoff" }, headers);
      }

      return jsonResponse(
        200,
        {
          hashed_token: magicLink.data.properties.hashed_token,
          district_slug: resolvedDistrictSlug,
          role,
        },
        headers,
      );
    }

    if (action === "consume") {
      return jsonResponse(410, { error: "Handoff expired" }, headers);
    }

    return jsonResponse(400, { error: "Invalid action" }, headers);
  } catch (error) {
    console.error("district-handoff error", error);
    return jsonResponse(500, { error: "Unexpected server error" }, headers);
  }
});
