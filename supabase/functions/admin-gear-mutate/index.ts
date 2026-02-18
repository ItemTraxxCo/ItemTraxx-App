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

const ALLOWED_GEAR_STATUSES = new Set([
  "available",
  "checked_out",
  "damaged",
  "lost",
  "in_repair",
  "retired",
  "in_studio_only",
]);

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
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id || profile.role !== "tenant_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: tenantStatusRow } = await userClient
      .from("tenants")
      .select("status")
      .eq("id", profile.tenant_id)
      .single();

    if (tenantStatusRow?.status === "suspended") {
      return jsonResponse(403, { error: "Tenant disabled" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "admin",
        p_limit: 20,
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

    const { action, payload } = await req.json();
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
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

    if (action === "create") {
      const { name, barcode, serial_number, status, notes } = payload as Record<string, unknown>;
      const normalizedName = typeof name === "string" ? name.trim() : "";
      const normalizedBarcode = typeof barcode === "string" ? barcode.trim() : "";
      const normalizedStatus = typeof status === "string" ? status.trim() : "";
      const normalizedSerial =
        typeof serial_number === "string" ? serial_number.trim() : "";
      const normalizedNotes = typeof notes === "string" ? notes.trim() : "";
      if (
        !normalizedName ||
        normalizedName.length > 120 ||
        !normalizedBarcode ||
        normalizedBarcode.length > 64 ||
        !normalizedStatus ||
        !ALLOWED_GEAR_STATUSES.has(normalizedStatus) ||
        normalizedSerial.length > 64 ||
        normalizedNotes.length > 500
      ) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("gear")
        .insert({
          tenant_id: profile.tenant_id,
          name: normalizedName,
          barcode: normalizedBarcode,
          serial_number: normalizedSerial || null,
          status: normalizedStatus,
          notes: normalizedNotes || null,
        })
        .select("id, tenant_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to create gear." });
      }

      if (normalizedStatus !== "available" && normalizedStatus !== "checked_out") {
        await adminClient.from("gear_status_history").insert({
          tenant_id: profile.tenant_id,
          gear_id: data.id,
          status: normalizedStatus,
          note: normalizedNotes || null,
          changed_by: user.id,
        });
      }

      return jsonResponse(200, { data });
    }

    if (action === "update") {
      const { id, name, barcode, status, notes } = payload as Record<string, unknown>;
      const normalizedId = typeof id === "string" ? id.trim() : "";
      const normalizedName = typeof name === "string" ? name.trim() : "";
      const normalizedBarcode = typeof barcode === "string" ? barcode.trim() : "";
      const normalizedStatus = typeof status === "string" ? status.trim() : "";
      const normalizedNotes = typeof notes === "string" ? notes.trim() : "";
      if (
        !normalizedId ||
        !normalizedName ||
        normalizedName.length > 120 ||
        !normalizedBarcode ||
        normalizedBarcode.length > 64 ||
        !normalizedStatus ||
        !ALLOWED_GEAR_STATUSES.has(normalizedStatus) ||
        normalizedNotes.length > 500
      ) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data: existingGear } = await adminClient
        .from("gear")
        .select("status")
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .single();

      const { data, error } = await adminClient
        .from("gear")
        .update({
          name: normalizedName,
          barcode: normalizedBarcode,
          status: normalizedStatus,
          notes: normalizedNotes || null,
        })
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .select("id, tenant_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to update gear." });
      }

      if (
        existingGear?.status !== normalizedStatus &&
        normalizedStatus !== "available" &&
        normalizedStatus !== "checked_out"
      ) {
        await adminClient.from("gear_status_history").insert({
          tenant_id: profile.tenant_id,
          gear_id: data.id,
          status: normalizedStatus,
          note: normalizedNotes || null,
          changed_by: user.id,
        });
      }

      return jsonResponse(200, { data });
    }

    if (action === "delete") {
      const { id } = payload as Record<string, unknown>;
      if (typeof id !== "string" || !id.trim()) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { error } = await adminClient
        .from("gear")
        .delete()
        .eq("id", id)
        .eq("tenant_id", profile.tenant_id);

      if (error) {
        return jsonResponse(400, { error: "Unable to remove gear." });
      }

      return jsonResponse(200, { success: true });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("admin-gear-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
