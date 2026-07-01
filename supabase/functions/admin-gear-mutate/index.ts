import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { resolveRateLimitResult } from "../_shared/preloginGuards.ts";
import { validateTenantAdminDeviceSession } from "../_shared/tenantAdminSessions.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import {
  BARCODE_PATTERN,
  optionalText,
  requireEnum,
  requireText,
  requireUuid,
  ValidationError,
} from "../_shared/validation.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
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

const isLocalhostMaintenanceBypassRequest = (req: Request) => {
  if ((Deno.env.get("ITX_ALLOW_LOCALHOST_MAINTENANCE_BYPASS") ?? "").toLowerCase() !== "true") {
    return false;
  }
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
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
    return new Response("ok", { headers });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  const ingressError = await requireTrustedEdgeIngress(req, "admin-gear-mutate", jsonResponse);
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
      .select("id, tenant_id, role, is_active")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !profile?.tenant_id ||
      profile.role !== "tenant_admin" ||
      profile.is_active === false
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: tenantStatusRow } = await userClient
      .from("tenants")
      .select("status")
      .eq("id", profile.tenant_id)
      .single();

    if (tenantStatusRow?.status && tenantStatusRow.status !== "active") {
      return jsonResponse(403, { error: "Tenant disabled" });
    }

    const { action, payload } = await readJsonBody(req);
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const isMutationAction =
      action === "create" ||
      action === "update" ||
      action === "delete" ||
      action === "restore";

    const payloadRecord = payload as Record<string, unknown>;
    const deviceId = optionalText(payloadRecord.device_id, { maxLen: 128 }) || null;

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    if (isMutationAction) {
      try {
        const hasStepUp = await hasPrivilegedStepUp(adminClient, {
          userId: user.id,
          roleScope: "tenant_admin",
          authToken,
        });
        if (!hasStepUp) {
          return jsonResponse(403, { error: "Admin verification required." });
        }
      } catch (error) {
        if (isMissingPrivilegedStepUpTable(error as { code?: string; message?: string })) {
          return jsonResponse(503, {
            error: "Privileged verification controls unavailable. Run latest SQL setup.",
          });
        }
        throw error;
      }
    }

    if (isMutationAction) {
      if (!deviceId) {
        return jsonResponse(400, { error: "Device session is required." });
      }

      const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
        "consume_rate_limit",
        {
          p_scope: "admin",
          p_limit: 20,
          p_window_seconds: 60,
        }
      );

      const { result: rateLimitResult, response: rateLimitFailure } = resolveRateLimitResult({
        data: rateLimit,
        error: rateLimitError,
        jsonResponse,
      });
      if (rateLimitFailure) return rateLimitFailure;
      if (!rateLimitResult.allowed) {
        return jsonResponse(429, {
          error: "Rate limit exceeded, please try again in a minute.",
        });
      }

      const activeSession = await validateTenantAdminDeviceSession(adminClient, {
        tenantId: profile.tenant_id,
        profileId: profile.id,
        deviceId,
        authToken,
      });
      if (activeSession.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeSession.valid) {
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
    if (maintenanceValue.enabled === true && !isLocalhostMaintenanceBypassRequest(req)) {
      return jsonResponse(503, {
        error:
          typeof maintenanceValue.message === "string" && maintenanceValue.message.trim()
            ? maintenanceValue.message.trim()
            : "Maintenance mode enabled.",
      });
    }

    if (action === "list_deleted") {
      const { data, error } = await adminClient
        .from("gear")
        .select("id, tenant_id, name, barcode, serial_number, status, notes")
        .eq("tenant_id", profile.tenant_id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(300);

      if (error) {
        return jsonResponse(400, { error: "Unable to load archived items." });
      }

      return jsonResponse(200, { data: data ?? [] });
    }

    if (action === "create") {
      const { name, barcode, serial_number, status, notes } = payloadRecord;
      const normalizedName = requireText(name, { maxLen: 120 });
      const normalizedBarcode = requireText(barcode, { maxLen: 64, pattern: BARCODE_PATTERN });
      const normalizedStatus = requireEnum(status, ALLOWED_GEAR_STATUSES);
      const normalizedSerial = optionalText(serial_number, { maxLen: 64 });
      const normalizedNotes = optionalText(notes, { maxLen: 500 });

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
        return jsonResponse(400, { error: "Unable to create item." });
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
      const { id, name, barcode, status, notes } = payloadRecord;
      const normalizedId = requireUuid(id);
      const normalizedName = requireText(name, { maxLen: 120 });
      const normalizedBarcode = requireText(barcode, { maxLen: 64, pattern: BARCODE_PATTERN });
      const normalizedStatus = requireEnum(status, ALLOWED_GEAR_STATUSES);
      const normalizedNotes = optionalText(notes, { maxLen: 500 });

      const { data: existingGear } = await adminClient
        .from("gear")
        .select("status, checked_out_by, checked_out_at")
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .is("deleted_at", null)
        .single();

      if (
        normalizedStatus !== "checked_out" &&
        (existingGear?.status === "checked_out" ||
          !!existingGear?.checked_out_by ||
          !!existingGear?.checked_out_at)
      ) {
        return jsonResponse(400, {
          error: "Return this item before changing its checkout status.",
        });
      }

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
        .is("deleted_at", null)
        .select("id, tenant_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to update item." });
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
      const { id } = payloadRecord;
      const normalizedId = requireUuid(id);

      const { data: activeGear } = await adminClient
        .from("gear")
        .select("id, status, checked_out_by, checked_out_at")
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!activeGear?.id) {
        return jsonResponse(404, { error: "Item not found." });
      }

      if (activeGear.status === "checked_out" || activeGear.checked_out_by || activeGear.checked_out_at) {
        return jsonResponse(400, {
          error: "Return this item before archiving it.",
        });
      }

      const { error } = await adminClient
        .from("gear")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .is("deleted_at", null);

      if (error) {
        return jsonResponse(400, { error: "Unable to archive item." });
      }

      return jsonResponse(200, { success: true });
    }

    if (action === "restore") {
      const { id } = payloadRecord;
      const normalizedId = requireUuid(id);

      const { data, error } = await adminClient
        .from("gear")
        .update({ deleted_at: null, deleted_by: null })
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .not("deleted_at", "is", null)
        .select("id, tenant_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to restore item." });
      }

      return jsonResponse(200, { data });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("admin-gear-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
