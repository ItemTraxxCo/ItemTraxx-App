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
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        return jsonResponse(401, { error: "Unauthorized" }, headers);
      }

      const refreshToken =
        typeof body?.refresh_token === "string" ? body.refresh_token.trim() : "";
      const districtSlug =
        typeof body?.district_slug === "string" ? body.district_slug.trim().toLowerCase() : "";

      if (!refreshToken || !districtSlug) {
        return jsonResponse(400, { error: "Invalid request" }, headers);
      }

      const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!accessToken) {
        return jsonResponse(401, { error: "Unauthorized" }, headers);
      }

      const userClient = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });

      const {
        data: { user },
        error: authError,
      } = await userClient.auth.getUser();

      if (authError || !user) {
        return jsonResponse(401, { error: "Unauthorized" }, headers);
      }

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
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      });

      if (insertError) {
        return jsonResponse(500, { error: "Unable to create handoff" }, headers);
      }

      return jsonResponse(200, { code, expires_at: expiresAt }, headers);
    }

    if (action === "consume") {
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      if (!code) {
        return jsonResponse(400, { error: "Invalid request" }, headers);
      }

      const codeHash = await sha256(code);
      const nowIso = new Date().toISOString();
      const { data: row, error: selectError } = await adminClient
        .from("district_session_handoffs")
        .select("id, district_slug, access_token, refresh_token, expires_at, consumed_at")
        .eq("code_hash", codeHash)
        .is("consumed_at", null)
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

      const { error: consumeError } = await adminClient
        .from("district_session_handoffs")
        .update({ consumed_at: nowIso })
        .eq("id", row.id)
        .is("consumed_at", null);

      if (consumeError) {
        return jsonResponse(409, { error: "Handoff already used" }, headers);
      }

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
