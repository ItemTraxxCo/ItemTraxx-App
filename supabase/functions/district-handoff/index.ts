import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const encodeBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const randomCode = () => encodeBase64Url(crypto.getRandomValues(new Uint8Array(24)));

const sha256 = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

    if (action === "create") {
      const authEmail =
        typeof body?.auth_email === "string" ? body.auth_email.trim().toLowerCase() : "";
      const password =
        typeof body?.password === "string" ? body.password : "";
      const districtSlug =
        typeof body?.district_slug === "string" ? body.district_slug.trim().toLowerCase() : "";

      if (!authEmail || !password || !districtSlug) {
        return jsonResponse(400, { error: "Invalid request" }, headers);
      }

      const userClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false },
      });

      const signIn = await userClient.auth.signInWithPassword({
        email: authEmail,
        password,
      });

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

      const { data: district, error: districtError } = await adminClient
        .from("districts")
        .select("slug, is_active")
        .eq("slug", districtSlug)
        .single();

      if (districtError || !district?.slug || district.is_active === false) {
        return jsonResponse(404, { error: "District not found" }, headers);
      }

      const code = randomCode();
      const codeHash = await sha256(code);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      await adminClient
        .from("district_session_handoffs")
        .delete()
        .eq("user_id", user.id);

      const { error: insertError } = await adminClient.from("district_session_handoffs").insert({
        code_hash: codeHash,
        user_id: user.id,
        district_slug: districtSlug,
        auth_email: authEmail,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: expiresAt,
      });

      if (insertError) {
        return jsonResponse(500, { error: "Unable to create handoff" }, headers);
      }

      return jsonResponse(200, { code, expires_at: expiresAt }, headers);
    }

    if (action === "create_admin") {
      const email =
        typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const password =
        typeof body?.password === "string" ? body.password : "";

      if (!email || !password) {
        return jsonResponse(400, { error: "Invalid request" }, headers);
      }

      const userClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false },
      });

      const signIn = await userClient.auth.signInWithPassword({
        email,
        password,
      });

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
        .single();

      const role = profile?.role;
      if ((role !== "tenant_admin" && role !== "district_admin") || profile?.is_active === false) {
        return jsonResponse(403, { error: "Access denied" }, headers);
      }

      let districtSlug = typeof profile?.district_id === "string" ? "" : "";
      if (typeof profile?.district_id === "string" && profile.district_id) {
        const { data: district } = await adminClient
          .from("districts")
          .select("slug, is_active")
          .eq("id", profile.district_id)
          .single();
        if (district?.slug && district.is_active !== false) {
          districtSlug = district.slug;
        }
      }

      if (!districtSlug && typeof profile?.tenant_id === "string" && profile.tenant_id) {
        const { data: tenant } = await adminClient
          .from("tenants")
          .select("district_id, status")
          .eq("id", profile.tenant_id)
          .single();
        if (tenant?.status && tenant.status !== "active") {
          return jsonResponse(403, { error: "Tenant disabled" }, headers);
        }
        if (tenant?.district_id) {
          const { data: district } = await adminClient
            .from("districts")
            .select("slug, is_active")
            .eq("id", tenant.district_id)
            .single();
          if (district?.slug && district.is_active !== false) {
            districtSlug = district.slug;
          }
        }
      }

      if (!districtSlug) {
        return jsonResponse(
          200,
          {
            code: null,
            district_slug: null,
            role,
            root_only: true,
          },
          headers
        );
      }

      const code = randomCode();
      const codeHash = await sha256(code);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      await adminClient
        .from("district_session_handoffs")
        .delete()
        .eq("user_id", user.id);

      const { error: insertError } = await adminClient.from("district_session_handoffs").insert({
        code_hash: codeHash,
        user_id: user.id,
        district_slug: districtSlug,
        auth_email: email,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: expiresAt,
      });

      if (insertError) {
        return jsonResponse(500, { error: "Unable to create handoff" }, headers);
      }

      return jsonResponse(200, {
        code,
        district_slug: districtSlug,
        role,
        expires_at: expiresAt,
      }, headers);
    }

    if (action === "consume") {
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      if (!code) {
        return jsonResponse(400, { error: "Invalid request" }, headers);
      }

      const codeHash = await sha256(code);
      const { data: row, error: selectError } = await adminClient
        .from("district_session_handoffs")
        .select("id, district_slug, access_token, refresh_token, expires_at")
        .eq("code_hash", codeHash)
        .single();

      if (
        selectError ||
        !row?.id ||
        !row.access_token ||
        !row.refresh_token ||
        !row.expires_at ||
        new Date(row.expires_at).getTime() <= Date.now()
      ) {
        return jsonResponse(410, { error: "Handoff expired" }, headers);
      }

      await adminClient.from("district_session_handoffs").delete().eq("id", row.id);

      return jsonResponse(
        200,
        {
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          district_slug: row.district_slug,
        },
        headers
      );
    }

    return jsonResponse(400, { error: "Invalid action" }, headers);
  } catch (error) {
    console.error("district-handoff error", error);
    return jsonResponse(500, { error: "Unexpected server error" }, headers);
  }
});
