import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import {
  BARCODE_PATTERN,
  optionalText,
  requireEnum,
  requireText,
  requireUuid,
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

const ALLOWED_GEAR_STATUSES = new Set([
  "available",
  "checked_out",
  "damaged",
  "lost",
  "in_repair",
  "retired",
  "in_studio_only",
] as const);

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

  const ingressError = await requireTrustedEdgeIngress(
    req,
    "super-gear-mutate",
    jsonResponse,
  );
  if (ingressError) return ingressError;

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

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

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
      return jsonResponse(500, { error: "Rate limit check failed" });
    }

    const rateLimitResult = rateLimit as RateLimitResult;
    if (!rateLimitResult.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const { action, payload } = await readJsonBody(req);
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
        .from("gear")
        .select("id, tenant_id, name, barcode, serial_number, status, notes")
        .order("created_at", { ascending: false })
        .limit(500);

      if (tenantId && tenantId !== "all") {
        query = query.eq("tenant_id", tenantId);
      }
      const { data, error } = await query;
      if (error) {
        return jsonResponse(400, { error: "Unable to load items." });
      }
      const rows = (data ?? []) as Array<{
        id: string;
        tenant_id: string;
        name: string;
        barcode: string;
        serial_number: string | null;
        status: string;
        notes: string | null;
      }>;
      if (!search) {
        return jsonResponse(200, { data: rows });
      }
      const normalized = search.toLowerCase();
      return jsonResponse(200, {
        data: rows.filter((row) => {
          const serial = row.serial_number?.toLowerCase() ?? "";
          return (
            row.name.toLowerCase().includes(normalized) ||
            row.barcode.toLowerCase().includes(normalized) ||
            serial.includes(normalized)
          );
        }),
      });
    }

    if (action === "create") {
      const tenantId = requireUuid(payloadRecord.tenant_id);
      const name = requireText(payloadRecord.name, { maxLen: 120 });
      const barcode = requireText(payloadRecord.barcode, { maxLen: 64, pattern: BARCODE_PATTERN });
      const serial = optionalText(payloadRecord.serial_number, { maxLen: 64 });
      const status = requireEnum(payloadRecord.status, ALLOWED_GEAR_STATUSES);
      const notes = optionalText(payloadRecord.notes, { maxLen: 500 });

      const { data, error } = await adminClient
        .from("gear")
        .insert({
          tenant_id: tenantId,
          name,
          barcode,
          serial_number: serial || null,
          status,
          notes: notes || null,
        })
        .select("id, tenant_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to create item." });
      }
      return jsonResponse(200, { data });
    }

    if (action === "update") {
      const id = requireUuid(payloadRecord.id);
      const name = requireText(payloadRecord.name, { maxLen: 120 });
      const barcode = requireText(payloadRecord.barcode, { maxLen: 64, pattern: BARCODE_PATTERN });
      const status = requireEnum(payloadRecord.status, ALLOWED_GEAR_STATUSES);
      const notes = optionalText(payloadRecord.notes, { maxLen: 500 });

      const needsStepUp = ["lost", "retired"].includes(status);
      if (needsStepUp) {
        const password =
          typeof payloadRecord.super_password === "string" && payloadRecord.super_password.length <= 1024
            ? payloadRecord.super_password
            : "";
        const phrase = optionalText(payloadRecord.confirm_phrase, { maxLen: 32 });
        if (!password || phrase.trim() !== "CONFIRM") {
          return jsonResponse(400, {
            error: "Super password and confirmation are required for this status change.",
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
      }

      const { data, error } = await adminClient
        .from("gear")
        .update({
          name,
          barcode,
          status,
          notes: notes || null,
        })
        .eq("id", id)
        .select("id, tenant_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to update item." });
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
          error: "Super password and confirmation are required to delete item.",
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

      const { error } = await adminClient.from("gear").delete().eq("id", id);
      if (error) {
        return jsonResponse(400, { error: "Unable to delete item." });
      }
      return jsonResponse(200, { data: { success: true } });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("super-gear-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
