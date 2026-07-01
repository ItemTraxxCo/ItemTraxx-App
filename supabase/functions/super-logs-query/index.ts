import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import {
  optionalInteger,
  optionalIsoDate,
  optionalText,
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
    "super-logs-query",
    jsonResponse,
  );
  if (ingressError) return ingressError;

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
      .select("role, is_active")
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
        p_limit: 60,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.error("super-logs-query rate limit unavailable", {
        message: rateLimitError.message,
        code: (rateLimitError as { code?: string }).code,
      });
      return jsonResponse(500, { error: "Rate limit check failed" });
    }

    const rateLimitResult = Array.isArray(rateLimit)
      ? ((rateLimit[0] as RateLimitResult | undefined) ?? null)
      : ((rateLimit as RateLimitResult | null) ?? null);
    if (!rateLimitResult) {
      return jsonResponse(500, { error: "Rate limit check failed" });
    }
    if (!rateLimitResult.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const { payload } = await readJsonBody(req);
    if (typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }
    const payloadRecord = payload as Record<string, unknown>;

    const tenantId = optionalText(payloadRecord.tenant_id, { maxLen: 36 }) || "all";
    if (tenantId !== "all" && !UUID_PATTERN.test(tenantId)) {
      return jsonResponse(400, { error: "Invalid request" });
    }
    const search = optionalText(payloadRecord.search, { maxLen: 120, transform: "lowercase" });
    const actionType = optionalText(payloadRecord.action_type, { maxLen: 40 }) || "all";
    const page = optionalInteger(payloadRecord.page, 1, 10_000, 1);
    const startAt = optionalIsoDate(payloadRecord.start_at);
    const endAt = optionalIsoDate(payloadRecord.end_at);
    const pageSize = optionalInteger(payloadRecord.page_size, 10, 200, 50);

    let query = adminClient
      .from("gear_logs")
      .select(
        "id, tenant_id, gear_id, checked_out_by, action_type, action_time, performed_by"
      )
      .order("action_time", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (tenantId && tenantId !== "all") {
      query = query.eq("tenant_id", tenantId);
    }
    if (actionType && actionType !== "all") {
      query = query.eq("action_type", actionType);
    }
    if (startAt) {
      query = query.gte("action_time", startAt);
    }
    if (endAt) {
      query = query.lte("action_time", endAt);
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse(400, { error: "Unable to load logs." });
    }

    const rows = (data ?? []) as Array<{
      id: string;
      tenant_id: string;
      gear_id: string;
      checked_out_by: string | null;
      action_type: string;
      action_time: string;
      performed_by: string | null;
    }>;

    const gearIds = Array.from(new Set(rows.map((row) => row.gear_id)));
    const studentIds = Array.from(
      new Set(rows.map((row) => row.checked_out_by).filter(Boolean))
    ) as string[];
    const tenantIds = Array.from(new Set(rows.map((row) => row.tenant_id)));

    const [gearResult, studentResult, tenantResult] = await Promise.all([
      gearIds.length
        ? adminClient.from("gear").select("id, name, barcode").in("id", gearIds)
        : Promise.resolve({ data: [], error: null }),
      studentIds.length
        ? adminClient
            .from("students")
            .select("id, username, student_id")
            .in("id", studentIds)
        : Promise.resolve({ data: [], error: null }),
      tenantIds.length
        ? adminClient.from("tenants").select("id, name").in("id", tenantIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const gearById = new Map(
      ((gearResult.data ?? []) as Array<{ id: string; name: string; barcode: string }>).map(
        (item) => [item.id, item]
      )
    );
    const studentById = new Map(
      (
        (studentResult.data ?? []) as Array<{
          id: string;
          username: string;
          student_id: string;
        }>
      ).map((item) => [item.id, item])
    );
    const tenantById = new Map(
      ((tenantResult.data ?? []) as Array<{ id: string; name: string }>).map((item) => [
        item.id,
        item,
      ])
    );

    const mapped = rows
      .map((row) => ({
        ...row,
        gear: gearById.get(row.gear_id) ?? null,
        student: row.checked_out_by ? studentById.get(row.checked_out_by) ?? null : null,
        tenant: tenantById.get(row.tenant_id) ?? null,
      }))
      .filter((row) => {
        if (!search) return true;
        const haystack = [
          row.action_type,
          row.gear?.name,
          row.gear?.barcode,
          row.student?.username,
          row.student?.student_id,
          row.tenant?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      });

    return jsonResponse(200, {
      data: mapped,
      page,
      page_size: pageSize,
      count: mapped.length,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("super-logs-query function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
