import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { resolveRateLimitResult } from "../_shared/preloginGuards.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { resolveTenantAdminAuthSessionBinding } from "../_shared/tenantAdminSessions.ts";
import {
  asRecord,
  BARCODE_PATTERN,
  optionalText,
  requireEnum,
  requireText,
  ValidationError,
} from "../_shared/validation.ts";
import {
  authorizeAdminOpsAction,
  dispatchAdminOpsAction,
} from "./actions/index.ts";
import {
  normalizeTenantUpdates,
  resolveMaintenance,
} from "./actions/notifications.ts";
import {
  findActiveSession,
  resolveDeviceSessionContext,
} from "./actions/sessions.ts";
import { resolveTenantPolicyState } from "./actions/settings.ts";
import type { AdminOpsContext } from "./context.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const TRACKED_STATUSES = new Set([
  "damaged",
  "lost",
  "in_repair",
  "retired",
  "in_studio_only",
]);
const ALLOWED_GEAR_STATUSES = new Set(
  [
    "available",
    "checked_out",
    "damaged",
    "lost",
    "in_repair",
    "retired",
    "in_studio_only",
  ] as const,
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

const sha256 = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
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
    "admin-ops",
    jsonResponse,
  );
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

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const authSessionBinding = await resolveTenantAdminAuthSessionBinding(
      adminClient,
      authToken,
    );
    const authTokenBindingKey = authSessionBinding.sessionId
      ? `session:${authSessionBinding.sessionId}`
      : `token:${await sha256(authToken)}`;

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
      .select("tenant_id, role, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (profile.role !== "tenant_admin" && profile.role !== "tenant_user") {
      return jsonResponse(403, { error: "Access denied" });
    }
    if (profile.is_active === false) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: profile.role === "tenant_admin" ? "admin" : "tenant",
        p_limit: profile.role === "tenant_admin" ? 30 : 25,
        p_window_seconds: 60,
      },
    );

    const { result: rateLimitResult, response: rateLimitFailure } =
      resolveRateLimitResult({
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

    const requestBody = asRecord(await readJsonBody(req));
    const normalizedAction = requireText(requestBody.action, { maxLen: 64 });
    const payloadRecord = asRecord(requestBody.payload ?? {});
    const isSessionAction = normalizedAction === "touch_session" ||
      normalizedAction === "validate_session" ||
      normalizedAction === "list_sessions" ||
      normalizedAction === "revoke_current_session" ||
      normalizedAction === "revoke_session" ||
      normalizedAction === "revoke_all_sessions";

    const tenantId = profile.tenant_id as string;
    const { data: tenantStatus } = await userClient
      .from("tenants")
      .select("status")
      .eq("id", tenantId)
      .maybeSingle();
    const isTenantSuspended = !!tenantStatus?.status &&
      tenantStatus.status !== "active";
    const deviceSession = resolveDeviceSessionContext(payloadRecord, req);

    const sessionSecurityContext = {
      adminClient,
      tenantId,
      user: { id: user.id },
      authToken,
      authSessionBinding,
      authTokenBindingKey,
      deviceSession,
      requestId,
    };

    if (profile.role === "tenant_admin" && !isSessionAction) {
      const activeSession = await findActiveSession(sessionSecurityContext);
      if (activeSession.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeSession.exists) {
        if (activeSession.revoked) {
          return jsonResponse(401, { error: "Session revoked" });
        }
        return jsonResponse(401, { error: "Session revoked" });
      }
    }

    if (
      profile.role === "tenant_admin" &&
      (normalizedAction === "list_sessions" ||
        normalizedAction === "revoke_current_session" ||
        normalizedAction === "revoke_session" ||
        normalizedAction === "revoke_all_sessions")
    ) {
      const activeSession = await findActiveSession(sessionSecurityContext);
      if (activeSession.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeSession.exists) {
        return jsonResponse(401, { error: "Session revoked" });
      }
    }

    const [maintenanceRuntimeResult, updateRuntimeResult] = await Promise.all([
      adminClient
        .from("app_runtime_config")
        .select("value")
        .eq("key", "maintenance_mode")
        .maybeSingle(),
      adminClient
        .from("app_runtime_config")
        .select("value")
        .eq("key", "tenant_updates")
        .maybeSingle(),
    ]);
    const maintenance = resolveMaintenance(
      maintenanceRuntimeResult.data?.value,
    );

    const { tenantPolicy, checkoutDueHours, featureFlags } =
      await resolveTenantPolicyState(adminClient, tenantId);

    const updateRuntimeValue = updateRuntimeResult.data?.value;
    const tenantUpdates = normalizeTenantUpdates(updateRuntimeValue);

    const actionAuthorizationFailure = await authorizeAdminOpsAction({
      action: normalizedAction,
      profileRole: profile.role,
      isTenantSuspended,
      adminClient,
      userId: user.id,
      authToken,
      jsonResponse,
    });
    if (actionAuthorizationFailure) return actionAuthorizationFailure;

    const context: AdminOpsContext = {
      req,
      requestId,
      action: normalizedAction,
      payload: payloadRecord,
      adminClient,
      user: { id: user.id },
      profile: { role: profile.role },
      tenantId,
      isTenantSuspended,
      authToken,
      authSessionBinding,
      authTokenBindingKey,
      deviceSession,
      tenantPolicy,
      checkoutDueHours,
      featureFlags,
      maintenance,
      tenantUpdates,
      jsonResponse,
    };
    if (normalizedAction !== "bulk_import_gear") {
      return dispatchAdminOpsAction(context);
    }

    if (normalizedAction === "bulk_import_gear") {
      const rawRows = Array.isArray(payloadRecord.rows)
        ? payloadRecord.rows
        : [];

      if (!rawRows.length || rawRows.length > 1000) {
        return jsonResponse(400, { error: "Provide between 1 and 1000 rows." });
      }

      const skippedRows: Array<{ barcode: string; reason: string }> = [];
      const normalizedRows: Array<{
        name: string;
        barcode: string;
        serial_number: string | null;
        status: string;
        notes: string | null;
      }> = [];

      const seenBarcodes = new Set<string>();

      for (const row of rawRows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          skippedRows.push({ barcode: "(invalid)", reason: "Invalid row." });
          continue;
        }
        const rowRecord = row as Record<string, unknown>;
        let name = "";
        let barcode = "";
        let serial = "";
        let statusRaw:
          | "available"
          | "checked_out"
          | "damaged"
          | "lost"
          | "in_repair"
          | "retired"
          | "in_studio_only";
        let notes = "";
        try {
          name = requireText(rowRecord.name, { maxLen: 120 });
          barcode = requireText(rowRecord.barcode, {
            maxLen: 64,
            pattern: BARCODE_PATTERN,
          });
          serial = optionalText(rowRecord.serial_number, { maxLen: 64 });
          statusRaw = requireEnum(
            rowRecord.status ?? "available",
            ALLOWED_GEAR_STATUSES,
          );
          notes = optionalText(rowRecord.notes, { maxLen: 500 });
        } catch {
          skippedRows.push({
            barcode: barcode || "(blank)",
            reason: "Invalid row.",
          });
          continue;
        }
        if (seenBarcodes.has(barcode.toLowerCase())) {
          skippedRows.push({ barcode, reason: "Duplicate barcode in import." });
          continue;
        }

        seenBarcodes.add(barcode.toLowerCase());
        normalizedRows.push({
          name,
          barcode,
          serial_number: serial || null,
          status: statusRaw,
          notes: notes || null,
        });
      }

      if (!normalizedRows.length) {
        return jsonResponse(200, {
          data: {
            inserted: 0,
            skipped: skippedRows.length,
            inserted_items: [],
            skipped_rows: skippedRows,
          },
        });
      }

      const lookupBarcodes = normalizedRows.map((row) => row.barcode);
      const { data: existingRows } = await adminClient
        .from("gear")
        .select("barcode")
        .eq("tenant_id", tenantId)
        .in("barcode", lookupBarcodes);
      const existing = new Set(
        (existingRows ?? []).map((row) => (row as { barcode: string }).barcode),
      );

      const toInsert = normalizedRows.filter((row) => {
        const isExisting = existing.has(row.barcode);
        if (isExisting) {
          skippedRows.push({
            barcode: row.barcode,
            reason: "Barcode already exists.",
          });
        }
        return !isExisting;
      });

      if (!toInsert.length) {
        return jsonResponse(200, {
          data: {
            inserted: 0,
            skipped: skippedRows.length,
            inserted_items: [],
            skipped_rows: skippedRows,
          },
        });
      }

      const insertPayload = toInsert.map((row) => ({
        tenant_id: tenantId,
        name: row.name,
        barcode: row.barcode,
        serial_number: row.serial_number,
        status: row.status,
        notes: row.notes,
      }));

      const { data: insertedRows, error: insertError } = await adminClient
        .from("gear")
        .insert(insertPayload)
        .select("id, tenant_id, name, barcode, serial_number, status, notes");

      if (insertError) {
        return jsonResponse(400, { error: "Unable to import item rows." });
      }

      const historyPayload = (insertedRows ?? [])
        .filter((item) =>
          TRACKED_STATUSES.has((item as { status: string }).status)
        )
        .map((item) => ({
          tenant_id: tenantId,
          gear_id: (item as { id: string }).id,
          status: (item as { status: string }).status,
          note: (item as { notes?: string | null }).notes ?? null,
          changed_by: user.id,
        }));
      if (historyPayload.length) {
        await adminClient.from("gear_status_history").insert(historyPayload);
      }

      return jsonResponse(200, {
        data: {
          inserted: (insertedRows ?? []).length,
          skipped: skippedRows.length,
          inserted_items: insertedRows ?? [],
          skipped_rows: skippedRows,
        },
      });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("admin-ops function error", {
      request_id: requestId,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
