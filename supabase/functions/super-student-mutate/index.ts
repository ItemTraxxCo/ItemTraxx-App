import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import {
  optionalText,
  requireUuid,
  STUDENT_ID_PATTERN,
  USERNAME_PATTERN,
  UUID_PATTERN,
  ValidationError,
} from "../_shared/validation.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

type StudentRow = {
  id: string;
  tenant_id: string;
  username: string;
  student_id: string;
  created_at: string;
};

type SuperStudentDatabase = {
  public: {
    Tables: {
      students: {
        Row: StudentRow;
        Insert: {
          tenant_id: string;
          username: string;
          student_id: string;
        };
        Update: Partial<Pick<StudentRow, "username" | "student_id">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type SupabaseAdminClient = SupabaseClient<SuperStudentDatabase>;

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

const normalizeNameToken = (token: string) => token.slice(0, 6);

const generateUsername = () => {
  const prefix =
    CODENAME_PREFIXES[secureRandomInt(CODENAME_PREFIXES.length)] ?? "Nova";
  const suffix =
    CODENAME_SUFFIXES[secureRandomInt(CODENAME_SUFFIXES.length)] ?? "Fox";
  // Keep usernames short and readable: NameNameNNN
  return `${normalizeNameToken(prefix)}${normalizeNameToken(suffix)}${randomDigits(3)}`;
};

const buildUniqueStudentIdentity = async (
  adminClient: SupabaseAdminClient,
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

  throw new Error("Unable to generate borrower identity.");
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

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

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const authToken = authHeader.replace(/^Bearer\s+/i, "").trim();

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
      .select("role, auth_email, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin" || profile.is_active === false) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const adminClient: SupabaseAdminClient = createClient<SuperStudentDatabase>(
      supabaseUrl,
      serviceKey,
      {
        auth: { persistSession: false },
      }
    );

    try {
      const hasStepUp = await hasPrivilegedStepUp(adminClient, {
        userId: user.id,
        roleScope: "super_admin",
        authToken,
      });
      if (!hasStepUp) {
        return jsonResponse(403, { error: "Super admin verification required." });
      }
    } catch (error) {
      if (isMissingPrivilegedStepUpTable(error as { code?: string; message?: string })) {
        return jsonResponse(503, {
          error: "Privileged verification controls unavailable. Run latest SQL setup.",
        });
      }
      throw error;
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "super_admin",
        p_limit: 30,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.warn("super-student-mutate rate limit unavailable", {
        message: rateLimitError.message,
        code: (rateLimitError as { code?: string }).code,
      });
    } else {
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
    const payloadRecord = payload as Record<string, unknown>;

    if (action === "list") {
      const tenantId = optionalText(payloadRecord.tenant_id, { maxLen: 36 }) || "all";
      if (tenantId !== "all" && !UUID_PATTERN.test(tenantId)) {
        return jsonResponse(400, { error: "Invalid request" });
      }
      const search = optionalText(payloadRecord.search, { maxLen: 120 });

      let query = adminClient
        .from("students")
        .select("id, tenant_id, username, student_id, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (tenantId && tenantId !== "all") {
        query = query.eq("tenant_id", tenantId);
      }
      const { data, error } = await query;
      if (error) {
        return jsonResponse(400, { error: "Unable to load students." });
      }
      const rows = (data ?? []) as Array<{
        id: string;
        tenant_id: string;
        username: string;
        student_id: string;
        created_at: string;
      }>;
      if (!search) {
        return jsonResponse(200, { data: rows });
      }
      const normalized = search.toLowerCase();
      return jsonResponse(200, {
        data: rows.filter(
          (row) =>
            row.username.toLowerCase().includes(normalized) ||
            row.student_id.toLowerCase().includes(normalized)
        ),
      });
    }

    if (action === "create") {
      const tenantId = requireUuid(payloadRecord.tenant_id);
      const providedStudentId = optionalText(payloadRecord.student_id, {
        maxLen: 6,
        transform: "uppercase",
      });
      const providedUsername = optionalText(payloadRecord.username, { maxLen: 40 });

      const hasValidProvidedId = STUDENT_ID_PATTERN.test(providedStudentId);
      const hasValidProvidedUsername =
        providedUsername.length >= 4 && USERNAME_PATTERN.test(providedUsername);
      let studentId = hasValidProvidedId ? providedStudentId : "";
      let username = hasValidProvidedUsername ? providedUsername : "";

      if (studentId && username) {
        const [idConflictResult, usernameConflictResult] = await Promise.all([
          adminClient
            .from("students")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("student_id", studentId)
            .limit(1)
            .maybeSingle(),
          adminClient
            .from("students")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("username", username)
            .limit(1)
            .maybeSingle(),
        ]);
        if (idConflictResult.data?.id || usernameConflictResult.data?.id) {
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
      const id = requireUuid(payloadRecord.id);

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
      const id = requireUuid(payloadRecord.id);
      const password =
        typeof payloadRecord.super_password === "string" && payloadRecord.super_password.length <= 1024
          ? payloadRecord.super_password
          : "";
      const phrase = optionalText(payloadRecord.confirm_phrase, { maxLen: 32 });

      if (!password || phrase !== "CONFIRM") {
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
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("super-student-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
