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

const CODENAME_PREFIXES = [
  "Nova",
  "Echo",
  "Atlas",
  "Pixel",
  "Orbit",
  "Scout",
  "Comet",
  "Lumen",
  "Aster",
  "Vivid",
];

const CODENAME_SUFFIXES = [
  "Fox",
  "Pine",
  "Wave",
  "Maple",
  "River",
  "Spark",
  "Drift",
  "Cedar",
  "Birch",
  "Stone",
];

const secureRandomInt = (maxExclusive: number): number => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer");
  }
  const uint32Range = 0x1_0000_0000;
  const maxAllowed = Math.floor(uint32Range / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value < maxAllowed) {
      return value % maxExclusive;
    }
  }
};

const randomDigits = (len: number) =>
  Array.from({ length: len }, () => secureRandomInt(10)).join("");

const randomLetters = (len: number) =>
  Array.from({ length: len }, () =>
    String.fromCharCode(65 + secureRandomInt(26))
  ).join("");

const generateStudentId = () => `${randomDigits(4)}${randomLetters(2)}`;

const generateUsername = () => {
  const prefix =
    CODENAME_PREFIXES[secureRandomInt(CODENAME_PREFIXES.length)];
  const suffix =
    CODENAME_SUFFIXES[secureRandomInt(CODENAME_SUFFIXES.length)];
  return `${prefix}${suffix}${randomDigits(2)}`;
};

const buildUniqueStudentIdentity = async (
  adminClient: ReturnType<typeof createClient>,
  tenantId: string
) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const studentId = generateStudentId();
    const username = generateUsername();
    const { data: existingId } = await adminClient
      .from("students")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .limit(1)
      .maybeSingle();
    if (existingId?.id) continue;

    const { data: existingUsername } = await adminClient
      .from("students")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("username", username)
      .limit(1)
      .maybeSingle();
    if (existingUsername?.id) continue;

    return { studentId, username };
  }

  throw new Error("Unable to generate student identity.");
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

const verifySuperPassword = async (
  supabaseUrl: string,
  publishableKey: string,
  email: string,
  password: string
) => {
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
  });
  const { error } = await authClient.auth.signInWithPassword({ email, password });
  return !error;
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
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

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role, auth_email")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "super_admin",
        p_limit: 30,
        p_window_seconds: 60,
      }
    );

    if (!rateLimitError) {
      const rateLimitResult = rateLimit as RateLimitResult;
      if (!rateLimitResult.allowed) {
        return jsonResponse(429, {
          error: "Rate limit exceeded, please try again in a minute.",
        });
      }
    }

    const { action, payload } = await req.json();
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    if (action === "list") {
      const tenantId =
        typeof (payload as Record<string, unknown>).tenant_id === "string"
          ? ((payload as Record<string, unknown>).tenant_id as string).trim()
          : "all";
      const search =
        typeof (payload as Record<string, unknown>).search === "string"
          ? ((payload as Record<string, unknown>).search as string).trim()
          : "";

      let query = adminClient
        .from("students")
        .select("id, tenant_id, username, student_id, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (tenantId && tenantId !== "all") {
        query = query.eq("tenant_id", tenantId);
      }
      if (search) {
        query = query.or(
          `username.ilike.%${search}%,student_id.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) {
        return jsonResponse(400, { error: "Unable to load students." });
      }
      return jsonResponse(200, { data: data ?? [] });
    }

    if (action === "create") {
      const input = payload as Record<string, unknown>;
      const tenantId = typeof input.tenant_id === "string" ? input.tenant_id.trim() : "";
      const providedStudentId =
        typeof input.student_id === "string"
          ? input.student_id.trim().toUpperCase()
          : "";
      const providedUsername =
        typeof input.username === "string" ? input.username.trim() : "";

      if (!tenantId) {
        return jsonResponse(400, { error: "Invalid request" });
      }
      const hasValidProvidedId = /^[0-9]{4}[A-Z]{2}$/.test(providedStudentId);
      const hasValidProvidedUsername =
        providedUsername.length >= 4 && providedUsername.length <= 40;
      let studentId = hasValidProvidedId ? providedStudentId : "";
      let username = hasValidProvidedUsername ? providedUsername : "";

      if (studentId && username) {
        const { data: existingConflict } = await adminClient
          .from("students")
          .select("id")
          .eq("tenant_id", tenantId)
          .or(`student_id.eq.${studentId},username.eq.${username}`)
          .limit(1)
          .maybeSingle();
        if (existingConflict?.id) {
          studentId = "";
          username = "";
        }
      }

      if (!studentId || !username) {
        const generated = await buildUniqueStudentIdentity(adminClient, tenantId);
        studentId = generated.studentId;
        username = generated.username;
      }

      const { data, error } = await adminClient
        .from("students")
        .insert({
          tenant_id: tenantId,
          username,
          student_id: studentId,
        })
        .select("id, tenant_id, username, student_id, created_at")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to create student." });
      }
      return jsonResponse(200, { data });
    }

    if (action === "update") {
      const input = payload as Record<string, unknown>;
      const id = typeof input.id === "string" ? input.id.trim() : "";
      if (!id) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("students")
        .select("id, tenant_id, username, student_id, created_at")
        .eq("id", id)
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to update student." });
      }
      return jsonResponse(200, { data });
    }

    if (action === "delete") {
      const input = payload as Record<string, unknown>;
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const password = typeof input.super_password === "string" ? input.super_password : "";
      const phrase = typeof input.confirm_phrase === "string" ? input.confirm_phrase : "";

      if (!id || !password || phrase.trim() !== "CONFIRM") {
        return jsonResponse(400, {
          error: "Super password and confirmation are required to delete student.",
        });
      }

      const verified = await verifySuperPassword(
        supabaseUrl,
        publishableKey,
        profile.auth_email ?? user.email ?? "",
        password
      );
      if (!verified) {
        return jsonResponse(403, { error: "Super password verification failed." });
      }

      const { error } = await adminClient.from("students").delete().eq("id", id);
      if (error) {
        return jsonResponse(400, { error: "Unable to delete student." });
      }
      return jsonResponse(200, { data: { success: true } });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("super-student-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
