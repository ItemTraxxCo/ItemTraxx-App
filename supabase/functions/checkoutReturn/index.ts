import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
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
import { validateAccountDeviceSession } from "../_shared/accountSessions.ts";
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
  ["checkout", "return", "auto", "admin_return", "quick_return"] as const,
);

const buildItemLogOperationId = (
  operationId: string,
  itemId: string,
  actionType: "checkout" | "return" | "admin_return" | "quick_return",
) => `${operationId}:${itemId}:${actionType}`;

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
      .select("workspace_id, role, is_active")
      .eq("id", user.id)
      .single();

    const callerRole = callerProfile?.role;
    if (
      profileError ||
      !callerProfile?.workspace_id ||
      callerProfile.is_active === false ||
      !callerRole ||
      !["tenant_account", "workspace_admin"].includes(callerRole)
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: workspaceStatusRow } = await userClient
      .from("workspaces")
      .select("status")
      .eq("id", callerProfile.workspace_id)
      .single();

    if (workspaceStatusRow?.status && workspaceStatusRow.status !== "active") {
      return jsonResponse(403, { error: "Workspace disabled" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "workspace",
        p_limit: 10,
        p_window_seconds: 60,
      },
    );

    if (rateLimitError) {
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

    const { borrower_id, item_barcodes, action_type, device_id, operation_id } =
      await readJsonBody(req);
    const actionType = requireEnum(action_type, CHECKOUT_ACTIONS);
    const itemBarcodes = requireTextArray(item_barcodes, {
      minItems: 1,
      maxItems: 100,
      maxLen: 64,
      pattern: BARCODE_PATTERN,
    });
    const requestIdFallback = optionalText(req.headers.get("x-request-id"), {
      maxLen: 128,
    });
    const operationId = optionalText(operation_id, { maxLen: 128 }) ||
      requestIdFallback ||
      crypto.randomUUID();

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const isAdminReturn = actionType === "admin_return";
    const isQuickReturn = actionType === "quick_return";
    if (isAdminReturn && callerRole !== "workspace_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    {
      const deviceId = optionalText(device_id, { maxLen: 128 });
      if (!deviceId) {
        return jsonResponse(400, { error: "Device session is required." });
      }

      const activeAdminSession = await validateAccountDeviceSession(
        adminClient,
        {
          workspaceId: callerProfile.workspace_id,
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

    let borrower: { id: string; workspace_id: string; access_mode: string } | null = null;

    if (!isAdminReturn && !isQuickReturn) {
      const borrowerId = requireText(borrower_id, { maxLen: 32 });

      const { data: borrowerData, error: borrowerError } = await adminClient
        .from("borrowers")
        .select("id, workspace_id, access_mode")
        .eq("borrower_id", borrowerId)
        .eq("workspace_id", callerProfile.workspace_id)
        .is("deleted_at", null)
        .single();

      if (borrowerError || !borrowerData?.id || !borrowerData.workspace_id) {
        return jsonResponse(404, { error: "Borrower not found." });
      }

      if (callerRole === "tenant_account" && borrowerData.access_mode === "restricted") {
        const { data: grant } = await adminClient.from("borrower_access_grants").select("borrower_id").eq("borrower_id", borrowerData.id).eq("profile_id", user.id).maybeSingle();
        if (!grant) return jsonResponse(404, { error: "Borrower not found." });
      }
      borrower = borrowerData;
    }

    let processed = 0;
    const skippedBarcodes: string[] = [];

    for (const barcode of itemBarcodes) {
      const { data: item } = await adminClient
        .from("items")
        .select("id, workspace_id, checked_out_by, status, access_mode")
        .eq("barcode", barcode)
        .eq("workspace_id", callerProfile.workspace_id)
        .is("deleted_at", null)
        .single();

      if (!item) {
        skippedBarcodes.push(barcode);
        continue;
      }

      if (callerRole === "tenant_account" && item.access_mode === "restricted") {
        const { data: grant } = await adminClient.from("item_access_grants").select("item_id").eq("item_id", item.id).eq("profile_id", user.id).maybeSingle();
        if (!grant) { skippedBarcodes.push(barcode); continue; }
      }

      const existingOperationId = buildItemLogOperationId(
        operationId,
        item.id,
        isAdminReturn ? "admin_return" : isQuickReturn ? "quick_return" : "checkout",
      );
      const existingReturnOperationId = buildItemLogOperationId(
        operationId,
        item.id,
        "return",
      );
      const { data: existingOperation } = await adminClient
        .from("item_logs")
        .select("id")
        .eq("workspace_id", callerProfile.workspace_id)
        .eq("item_id", item.id)
        .in("operation_id", isAdminReturn
          ? [existingOperationId]
          : [existingOperationId, existingReturnOperationId])
        .limit(1)
        .maybeSingle();

      if (existingOperation?.id) {
        processed += 1;
        continue;
      }

      if (isAdminReturn || isQuickReturn) {
        const normalizedStatus = String(item.status ?? "").toLowerCase();
        if (!item.checked_out_by || normalizedStatus !== "checked_out") {
          skippedBarcodes.push(barcode);
          continue;
        }

        const { data: updatedItem, error: updateError } = await adminClient
          .from("items")
          .update({
            checked_out_by: null,
            checked_out_at: null,
            status: "available",
          })
          .eq("id", item.id)
          .eq("workspace_id", callerProfile.workspace_id)
          .eq("status", "checked_out")
          .not("checked_out_by", "is", null)
          .select("id")
          .maybeSingle();

        if (updateError || !updatedItem?.id) {
          skippedBarcodes.push(barcode);
          continue;
        }

        const { error: logError } = await adminClient.from("item_logs").upsert({
          item_id: item.id,
          action_type: isQuickReturn ? "quick_return" : "admin_return",
          checked_out_by: item.checked_out_by,
          performed_by: user.id,
          workspace_id: callerProfile.workspace_id,
          operation_id: buildItemLogOperationId(operationId, item.id, isQuickReturn ? "quick_return" : "admin_return"),
        }, {
          onConflict: "workspace_id,item_id,action_type,operation_id",
          ignoreDuplicates: true,
        });

        if (logError) {
          console.error("checkoutReturn admin log write failed", {
            itemId: item.id,
            operationId,
            message: logError.message,
          });
        }

        processed += 1;
        continue;
      }

      const normalizedStatus = String(item.status ?? "").toLowerCase();
      const isCheckout = normalizedStatus === "available" &&
        !item.checked_out_by;
      const isReturn = normalizedStatus === "checked_out" &&
        item.checked_out_by === borrower!.id;

      if (!isCheckout && !isReturn) {
        skippedBarcodes.push(barcode);
        continue;
      }

      const updateBuilder = adminClient
        .from("items")
        .update({
          checked_out_by: isCheckout ? borrower!.id : null,
          checked_out_at: isCheckout ? new Date().toISOString() : null,
          status: isCheckout ? "checked_out" : "available",
        })
        .eq("id", item.id)
        .eq("workspace_id", callerProfile.workspace_id);

      const { data: updatedItem, error: updateError } = await (isCheckout
        ? updateBuilder.is("checked_out_by", null).eq("status", "available")
        : updateBuilder.eq("checked_out_by", borrower!.id).eq("status", "checked_out"))
        .select("id")
        .maybeSingle();

      if (updateError || !updatedItem?.id) {
        skippedBarcodes.push(barcode);
        continue;
      }

      const resolvedActionType = isCheckout ? "checkout" : "return";
      const { error: logError } = await adminClient.from("item_logs").upsert({
        item_id: item.id,
        action_type: resolvedActionType,
        checked_out_by: borrower!.id,
        performed_by: user.id,
        workspace_id: callerProfile.workspace_id,
        operation_id: buildItemLogOperationId(operationId, item.id, resolvedActionType),
      }, {
        onConflict: "workspace_id,item_id,action_type,operation_id",
        ignoreDuplicates: true,
      });

      if (logError) {
        console.error("checkoutReturn item log write failed", {
          itemId: item.id,
          operationId,
          actionType: resolvedActionType,
          message: logError.message,
        });
      }

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
