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
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    if (!originAllowed) {
      return new Response("Origin not allowed", { status: 403, headers });
    }
    return new Response(null, { headers });
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

    const { data: callerProfile, error: profileError } = await userClient
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    const callerRole = callerProfile?.role;
    if (
      profileError ||
      !callerProfile?.tenant_id ||
      !callerRole ||
      !["tenant_user", "tenant_admin"].includes(callerRole)
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: tenantStatusRow } = await userClient
      .from("tenants")
      .select("status")
      .eq("id", callerProfile.tenant_id)
      .single();

    if (tenantStatusRow?.status === "suspended") {
      return jsonResponse(403, { error: "Tenant disabled" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "tenant",
        p_limit: 10,
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

    const { student_id, gear_barcodes, action_type } = await req.json();
    if (!Array.isArray(gear_barcodes) || gear_barcodes.length === 0 || gear_barcodes.length > 100) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    if (!["checkout", "return", "auto", "admin_return"].includes(action_type)) {
      return jsonResponse(400, { error: "Invalid action type" });
    }

    const isAdminReturn = action_type === "admin_return";
    if (isAdminReturn && callerRole !== "tenant_admin") {
      return jsonResponse(403, { error: "Access denied" });
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

    let student: { id: string; tenant_id: string } | null = null;

    if (!isAdminReturn) {
      if (typeof student_id !== "string" || !student_id.trim()) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data: studentData, error: studentError } = await adminClient
        .from("students")
        .select("id, tenant_id")
        .eq("student_id", student_id.trim())
        .eq("tenant_id", callerProfile.tenant_id)
        .single();

      if (studentError || !studentData?.id || !studentData.tenant_id) {
        return jsonResponse(404, { error: "Student not found." });
      }

      student = studentData;
    }

    let processed = 0;

    for (const rawBarcode of gear_barcodes) {
      if (typeof rawBarcode !== "string") continue;
      const barcode = rawBarcode.trim();
      if (!barcode || barcode.length > 64) continue;

      const { data: gear } = await adminClient
        .from("gear")
        .select("id, tenant_id, checked_out_by")
        .eq("barcode", barcode)
        .eq("tenant_id", callerProfile.tenant_id)
        .single();

      if (!gear) continue;

      if (isAdminReturn) {
        if (!gear.checked_out_by) continue;

        await adminClient
          .from("gear")
          .update({
            checked_out_by: null,
            checked_out_at: null,
            status: "available",
          })
          .eq("id", gear.id)
          .eq("tenant_id", callerProfile.tenant_id);

        await adminClient.from("gear_logs").insert({
          gear_id: gear.id,
          action_type: "admin_return",
          checked_out_by: gear.checked_out_by,
          tenant_id: callerProfile.tenant_id,
        });

        processed += 1;
        continue;
      }

      const isCheckout = !gear.checked_out_by;
      const isReturn = gear.checked_out_by === student!.id;

      if (!isCheckout && !isReturn) continue;

      await adminClient
        .from("gear")
        .update({
          checked_out_by: isCheckout ? student!.id : null,
          checked_out_at: isCheckout ? new Date().toISOString() : null,
          status: isCheckout ? "checked_out" : "available",
        })
        .eq("id", gear.id)
        .eq("tenant_id", callerProfile.tenant_id);

      await adminClient.from("gear_logs").insert({
        gear_id: gear.id,
        action_type: isCheckout ? "checkout" : "return",
        checked_out_by: student!.id,
        tenant_id: callerProfile.tenant_id,
      });

      processed += 1;
    }

    return jsonResponse(200, { success: true, processed });
  } catch (error) {
    console.error("checkoutReturn function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
