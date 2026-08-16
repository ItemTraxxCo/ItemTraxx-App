import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { resolveRateLimitResult } from "../_shared/preloginGuards.ts";
import { validateAccountDeviceSession } from "../_shared/accountSessions.ts";
import { requireRecentAdminAuth } from "../_shared/adminReauth.ts";
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

const ALLOWED_ITEM_STATUSES = new Set([
  "available",
  "checked_out",
  "damaged",
  "lost",
  "in_repair",
  "retired",
  "in_studio_only",
] as const);
const ACCESS_MODES = new Set(["all", "restricted"] as const);

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

  const ingressError = await requireTrustedEdgeIngress(req, "admin-item-mutate", jsonResponse);
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

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
      .select("id, workspace_id, role, is_active")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !profile?.workspace_id ||
      profile.role !== "workspace_admin" ||
      profile.is_active === false
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: workspaceStatusRow } = await userClient
      .from("workspaces")
      .select("status")
      .eq("id", profile.workspace_id)
      .single();

    if (workspaceStatusRow?.status && workspaceStatusRow.status !== "active") {
      return jsonResponse(403, { error: "Workspace disabled" });
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
    const resolveAccess = async () => {
      const accessMode = requireEnum(payloadRecord.access_mode, ACCESS_MODES);
      const profileIds = Array.isArray(payloadRecord.profile_ids)
        ? [...new Set(payloadRecord.profile_ids.map((value) => requireUuid(value)))]
        : [];
      if (accessMode === "restricted" && profileIds.length === 0) throw new ValidationError("Select at least one Tenant Account.");
      if (profileIds.length) {
        const { count, error } = await adminClient.from("profiles").select("id", { count: "exact", head: true }).eq("workspace_id", profile.workspace_id).eq("role", "tenant_account").eq("is_active", true).is("deleted_at", null).in("id", profileIds);
        if (error || count !== profileIds.length) throw new ValidationError("Invalid Tenant Account selection.");
      }
      return { accessMode, profileIds };
    };
    const replaceAccess = async (itemId: string, accessMode: "all" | "restricted", profileIds: string[]) => {
      const { error: deleteError } = await adminClient.from("item_access_grants").delete().eq("item_id", itemId);
      if (deleteError) throw new Error("Unable to update item access.");
      if (accessMode === "restricted") {
        const { error } = await adminClient.from("item_access_grants").insert(profileIds.map((profileId) => ({ item_id: itemId, profile_id: profileId, granted_by: user.id })));
        if (error) throw new Error("Unable to update item access.");
      }
    };

    const writeAudit = async (
      actionType: string,
      entityId: string | null,
      metadata: Record<string, unknown>,
    ) => {
      const { error } = await adminClient.from("admin_audit_logs").insert({
        workspace_id: profile.workspace_id,
        actor_id: profile.id,
        action_type: actionType,
        entity_type: "items",
        entity_id: entityId,
        metadata,
      });
      if (error) throw new Error("Unable to write security audit log.");
    };

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
      if (!rateLimitResult?.allowed) {
        return jsonResponse(429, {
          error: "Rate limit exceeded, please try again in a minute.",
        });
      }

      const activeSession = await validateAccountDeviceSession(adminClient, {
        workspaceId: profile.workspace_id,
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

      const reauthFailure = await requireRecentAdminAuth(
        adminClient,
        authToken,
        jsonResponse,
      );
      if (reauthFailure) return reauthFailure;
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
        .from("items")
        .select("id, workspace_id, name, barcode, serial_number, status, notes")
        .eq("workspace_id", profile.workspace_id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(300);

      if (error) {
        return jsonResponse(400, { error: "Unable to load archived items." });
      }

      return jsonResponse(200, { data: data ?? [] });
    }

    if (action === "create") {
      const { accessMode, profileIds } = await resolveAccess();
      const { name, barcode, serial_number, status, notes } = payloadRecord;
      const normalizedName = requireText(name, { maxLen: 120 });
      const normalizedBarcode = requireText(barcode, { maxLen: 64, pattern: BARCODE_PATTERN });
      const normalizedStatus = requireEnum(status, ALLOWED_ITEM_STATUSES);
      const normalizedSerial = optionalText(serial_number, { maxLen: 64 });
      const normalizedNotes = optionalText(notes, { maxLen: 500 });

      const { data, error } = await adminClient
        .from("items")
        .insert({
          workspace_id: profile.workspace_id,
          name: normalizedName,
          barcode: normalizedBarcode,
          serial_number: normalizedSerial || null,
          status: normalizedStatus,
          notes: normalizedNotes || null,
          access_mode: accessMode,
        })
        .select("id, workspace_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to create item." });
      }
      await replaceAccess(data.id, accessMode, profileIds);

      if (normalizedStatus !== "available" && normalizedStatus !== "checked_out") {
        await adminClient.from("item_status_history").insert({
          workspace_id: profile.workspace_id,
          item_id: data.id,
          status: normalizedStatus,
          note: normalizedNotes || null,
          changed_by: user.id,
        });
      }

      await writeAudit("item_create", data.id, {
        barcode: normalizedBarcode,
        status: normalizedStatus,
        has_serial_number: !!normalizedSerial,
      });

      return jsonResponse(200, { data });
    }

    if (action === "update") {
      const { accessMode, profileIds } = await resolveAccess();
      const { id, name, barcode, status, notes } = payloadRecord;
      const normalizedId = requireUuid(id);
      const normalizedName = requireText(name, { maxLen: 120 });
      const normalizedBarcode = requireText(barcode, { maxLen: 64, pattern: BARCODE_PATTERN });
      const normalizedStatus = requireEnum(status, ALLOWED_ITEM_STATUSES);
      const normalizedNotes = optionalText(notes, { maxLen: 500 });

      const { data: existingItem } = await adminClient
        .from("items")
        .select("status, checked_out_by, checked_out_at")
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .is("deleted_at", null)
        .single();

      if (
        normalizedStatus !== "checked_out" &&
        (existingItem?.status === "checked_out" ||
          !!existingItem?.checked_out_by ||
          !!existingItem?.checked_out_at)
      ) {
        return jsonResponse(400, {
          error: "Return this item before changing its checkout status.",
        });
      }

      const { data, error } = await adminClient
        .from("items")
        .update({
          name: normalizedName,
          barcode: normalizedBarcode,
          status: normalizedStatus,
          notes: normalizedNotes || null,
          access_mode: accessMode,
        })
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .is("deleted_at", null)
        .select("id, workspace_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to update item." });
      }
      await replaceAccess(data.id, accessMode, profileIds);

      if (
        existingItem?.status !== normalizedStatus &&
        normalizedStatus !== "available" &&
        normalizedStatus !== "checked_out"
      ) {
        await adminClient.from("item_status_history").insert({
          workspace_id: profile.workspace_id,
          item_id: data.id,
          status: normalizedStatus,
          note: normalizedNotes || null,
          changed_by: user.id,
        });
      }

      await writeAudit("item_update", data.id, {
        barcode: normalizedBarcode,
        previous_status: existingItem?.status ?? null,
        status: normalizedStatus,
      });

      return jsonResponse(200, { data });
    }

    if (action === "delete") {
      const { id } = payloadRecord;
      const normalizedId = requireUuid(id);

      const { data: activeItem } = await adminClient
        .from("items")
        .select("id, status, checked_out_by, checked_out_at")
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!activeItem?.id) {
        return jsonResponse(404, { error: "Item not found." });
      }

      if (activeItem.status === "checked_out" || activeItem.checked_out_by || activeItem.checked_out_at) {
        return jsonResponse(400, {
          error: "Return this item before archiving it.",
        });
      }

      const { error } = await adminClient
        .from("items")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .is("deleted_at", null);

      if (error) {
        return jsonResponse(400, { error: "Unable to archive item." });
      }

      await writeAudit("item_archive", normalizedId, {
        previous_status: activeItem.status ?? null,
      });

      return jsonResponse(200, { success: true });
    }

    if (action === "restore") {
      const { id } = payloadRecord;
      const normalizedId = requireUuid(id);

      const { data, error } = await adminClient
        .from("items")
        .update({ deleted_at: null, deleted_by: null })
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .not("deleted_at", "is", null)
        .select("id, workspace_id, name, barcode, serial_number, status, notes")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to restore item." });
      }

      await writeAudit("item_restore", data.id, {
        barcode: data.barcode ?? null,
        status: data.status ?? null,
      });

      return jsonResponse(200, { data });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("admin-item-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
