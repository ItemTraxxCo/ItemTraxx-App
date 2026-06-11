import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import {
  BARCODE_PATTERN,
  optionalText,
  requireEnum,
  requireText,
  requireTextArray,
  ValidationError,
} from "../_shared/validation.ts";
import { validateTenantAdminDeviceSession } from "../_shared/tenantAdminSessions.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";

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

const CHECKOUT_ACTIONS = new Set(
  ["checkout", "return", "auto", "admin_return"] as const,
);

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(
    Deno.env.get("ITX_ALLOWED_ORIGINS"),
  );

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin ||
    (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

  const headers = hasOrigin && originAllowed
    ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
    : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const isLocalhostMaintenanceBypassRequest = (req: Request) => {
  if (
    (Deno.env.get("ITX_ALLOW_LOCALHOST_MAINTENANCE_BYPASS") ?? "")
      .toLowerCase() !== "true"
  ) {
    return false;
  }
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (
      hostname === "localhost" || hostname === "127.0.0.1" ||
      hostname === "0.0.0.0"
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
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

  const ingressError = await requireTrustedEdgeIngress(req, "checkoutReturn", jsonResponse);
  if (ingressError) return ingressError;

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, {
      error: "Unfortunately ItemTraxx is currently unavailable.",
    });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const authToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!authToken) {
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
      .select("tenant_id, role, is_active")
      .eq("id", user.id)
      .single();

    const callerRole = callerProfile?.role;
    if (
      profileError ||
      !callerProfile?.tenant_id ||
      callerProfile.is_active === false ||
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

    if (tenantStatusRow?.status && tenantStatusRow.status !== "active") {
      return jsonResponse(403, { error: "Tenant disabled" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "tenant",
        p_limit: 10,
        p_window_seconds: 60,
      },
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

    const { student_id, gear_barcodes, action_type, device_id } =
      await readJsonBody(req);
    const actionType = requireEnum(action_type, CHECKOUT_ACTIONS);
    const gearBarcodes = requireTextArray(gear_barcodes, {
      minItems: 1,
      maxItems: 100,
      maxLen: 64,
      pattern: BARCODE_PATTERN,
    });

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const isAdminReturn = actionType === "admin_return";
    if (isAdminReturn && callerRole !== "tenant_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (callerRole === "tenant_admin") {
      const deviceId = optionalText(device_id, { maxLen: 128 });
      if (!deviceId) {
        return jsonResponse(400, { error: "Device session is required." });
      }

      const activeAdminSession = await validateTenantAdminDeviceSession(
        adminClient,
        {
          tenantId: callerProfile.tenant_id,
          profileId: user.id,
          deviceId,
          authToken,
        },
      );
      if (activeAdminSession.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeAdminSession.valid) {
        return jsonResponse(401, { error: "Session revoked" });
      }
    }

    const { data: maintenanceRow } = await adminClient
      .from("app_runtime_config")
      .select("value")
      .eq("key", "maintenance_mode")
      .maybeSingle();
    const maintenanceValue =
      maintenanceRow?.value && typeof maintenanceRow.value === "object"
        ? (maintenanceRow.value as Record<string, unknown>)
        : {};
    if (
      maintenanceValue.enabled === true &&
      !isLocalhostMaintenanceBypassRequest(req)
    ) {
      return jsonResponse(503, {
        error: typeof maintenanceValue.message === "string" &&
            maintenanceValue.message.trim()
          ? maintenanceValue.message.trim()
          : "Maintenance mode enabled.",
      });
    }

    let student: { id: string; tenant_id: string } | null = null;

    if (!isAdminReturn) {
      const studentId = requireText(student_id, { maxLen: 32 });

      const { data: studentData, error: studentError } = await adminClient
        .from("students")
        .select("id, tenant_id")
        .eq("student_id", studentId)
        .eq("tenant_id", callerProfile.tenant_id)
        .is("deleted_at", null)
        .single();

      if (studentError || !studentData?.id || !studentData.tenant_id) {
        return jsonResponse(404, { error: "Student not found." });
      }

      student = studentData;
    }

    let processed = 0;
    const skippedBarcodes: string[] = [];

    for (const barcode of gearBarcodes) {
      const { data: gear } = await adminClient
        .from("gear")
        .select("id, tenant_id, checked_out_by, status")
        .eq("barcode", barcode)
        .eq("tenant_id", callerProfile.tenant_id)
        .is("deleted_at", null)
        .single();

      if (!gear) {
        skippedBarcodes.push(barcode);
        continue;
      }

      if (isAdminReturn) {
        const normalizedStatus = String(gear.status ?? "").toLowerCase();
        if (!gear.checked_out_by || normalizedStatus !== "checked_out") {
          skippedBarcodes.push(barcode);
          continue;
        }

        const { data: updatedGear, error: updateError } = await adminClient
          .from("gear")
          .update({
            checked_out_by: null,
            checked_out_at: null,
            status: "available",
          })
          .eq("id", gear.id)
          .eq("tenant_id", callerProfile.tenant_id)
          .not("checked_out_by", "is", null)
          .select("id")
          .maybeSingle();

        if (updateError || !updatedGear?.id) {
          skippedBarcodes.push(barcode);
          continue;
        }

        await adminClient.from("gear_logs").insert({
          gear_id: gear.id,
          action_type: "admin_return",
          checked_out_by: gear.checked_out_by,
          tenant_id: callerProfile.tenant_id,
        });

        processed += 1;
        continue;
      }

      const normalizedStatus = String(gear.status ?? "").toLowerCase();
      const isCheckout = normalizedStatus === "available" &&
        !gear.checked_out_by;
      const isReturn = normalizedStatus === "checked_out" &&
        gear.checked_out_by === student!.id;

      if (!isCheckout && !isReturn) {
        skippedBarcodes.push(barcode);
        continue;
      }

      const updateBuilder = adminClient
        .from("gear")
        .update({
          checked_out_by: isCheckout ? student!.id : null,
          checked_out_at: isCheckout ? new Date().toISOString() : null,
          status: isCheckout ? "checked_out" : "available",
        })
        .eq("id", gear.id)
        .eq("tenant_id", callerProfile.tenant_id);

      const { data: updatedGear, error: updateError } = await (isCheckout
        ? updateBuilder.is("checked_out_by", null)
        : updateBuilder.eq("checked_out_by", student!.id))
        .select("id")
        .maybeSingle();

      if (updateError || !updatedGear?.id) {
        skippedBarcodes.push(barcode);
        continue;
      }

      await adminClient.from("gear_logs").insert({
        gear_id: gear.id,
        action_type: isCheckout ? "checkout" : "return",
        checked_out_by: student!.id,
        tenant_id: callerProfile.tenant_id,
      });

      processed += 1;
    }

    return jsonResponse(200, {
      success: true,
      processed,
      skipped_barcodes: skippedBarcodes,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("checkoutReturn function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
