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
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "super_admin",
        p_limit: 60,
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

    const { payload } = await req.json();
    if (typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const tenantId =
      typeof (payload as Record<string, unknown>).tenant_id === "string"
        ? ((payload as Record<string, unknown>).tenant_id as string).trim()
        : "all";
    const search =
      typeof (payload as Record<string, unknown>).search === "string"
        ? ((payload as Record<string, unknown>).search as string).trim().toLowerCase()
        : "";
    const actionType =
      typeof (payload as Record<string, unknown>).action_type === "string"
        ? ((payload as Record<string, unknown>).action_type as string).trim()
        : "all";
    const page = Math.max(
      1,
      Number((payload as Record<string, unknown>).page ?? 1) || 1
    );
    const startAt =
      typeof (payload as Record<string, unknown>).start_at === "string"
        ? ((payload as Record<string, unknown>).start_at as string).trim()
        : "";
    const endAt =
      typeof (payload as Record<string, unknown>).end_at === "string"
        ? ((payload as Record<string, unknown>).end_at as string).trim()
        : "";
    const pageSize = Math.min(
      200,
      Math.max(10, Number((payload as Record<string, unknown>).page_size ?? 50) || 50)
    );

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

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
    console.error("super-logs-query function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
