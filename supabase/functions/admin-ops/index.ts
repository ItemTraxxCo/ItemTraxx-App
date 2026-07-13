import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { resolveRateLimitResult } from "../_shared/preloginGuards.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import {
  isMissingPostgrestColumn as isMissingColumn,
  isMissingPostgrestRelation as isMissingRelation,
} from "../_shared/postgrestErrors.ts";
import { resolveTrustedGeneralLocation as resolveGeneralLocation } from "../_shared/requestMetadata.ts";
import {
  isTenantAdminTokenBlockedBySessionRevocation,
  resolveTenantAdminAuthSessionBinding,
} from "../_shared/tenantAdminSessions.ts";
import {
  asRecord,
  BARCODE_PATTERN,
  optionalInteger,
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
import type { AdminOpsContext } from "./context.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type TenantFeatureFlags = {
  enable_notifications: boolean;
  enable_bulk_item_import: boolean;
  enable_bulk_student_tools: boolean;
  enable_status_tracking: boolean;
  enable_barcode_generator: boolean;
};

type TenantPolicyRow = {
  checkout_due_hours: number | null;
  account_category: "organization" | "district" | "individual" | null;
  plan_code:
    | "core"
    | "growth"
    | "starter"
    | "scale"
    | "enterprise"
    | "individual_yearly"
    | "individual_monthly"
    | null;
  feature_flags: unknown;
};

type TenantPolicyResult = {
  data: TenantPolicyRow | null;
  error: RpcError | null;
};

type DeviceSessionContext = {
  deviceId: string | null;
  deviceLabel: string | null;
  userAgent: string | null;
  loginMethod: "password" | "magic_link" | "session_handoff" | null;
  loginLocation: "regular_login" | "admin_login" | null;
  generalLocation: string | null;
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

type RpcError = {
  code?: string;
  message?: string;
};

const formatRpcError = (error: RpcError | null | undefined) =>
  error
    ? `${error.code ?? "unknown"}: ${error.message ?? "Unknown error"}`
    : "Unknown error";

const defaultFeatureFlags = (): TenantFeatureFlags => ({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});

const normalizeFeatureFlags = (value: unknown): TenantFeatureFlags => {
  if (!value || typeof value !== "object") return defaultFeatureFlags();
  const payload = value as Record<string, unknown>;
  const fallback = defaultFeatureFlags();
  return {
    enable_notifications: typeof payload.enable_notifications === "boolean"
      ? payload.enable_notifications
      : fallback.enable_notifications,
    enable_bulk_item_import:
      typeof payload.enable_bulk_item_import === "boolean"
        ? payload.enable_bulk_item_import
        : fallback.enable_bulk_item_import,
    enable_bulk_student_tools:
      typeof payload.enable_bulk_student_tools === "boolean"
        ? payload.enable_bulk_student_tools
        : fallback.enable_bulk_student_tools,
    enable_status_tracking: typeof payload.enable_status_tracking === "boolean"
      ? payload.enable_status_tracking
      : fallback.enable_status_tracking,
    enable_barcode_generator:
      typeof payload.enable_barcode_generator === "boolean"
        ? payload.enable_barcode_generator
        : fallback.enable_barcode_generator,
  };
};

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

const sanitizeText = (value: unknown, maxLen: number) => {
  return optionalText(value, { maxLen }) || null;
};

const sanitizeLoginMethod = (
  value: unknown,
): DeviceSessionContext["loginMethod"] =>
  value === "password" || value === "magic_link" || value === "session_handoff"
    ? value
    : null;

const sanitizeLoginLocation = (
  value: unknown,
): DeviceSessionContext["loginLocation"] =>
  value === "regular_login" || value === "admin_login" ? value : null;

const resolveDeviceSessionContext = (
  payload: Record<string, unknown>,
  req: Request,
): DeviceSessionContext => ({
  deviceId: sanitizeText(payload.device_id, 128),
  deviceLabel: sanitizeText(payload.device_label, 160),
  userAgent: sanitizeText(req.headers.get("user-agent"), 255),
  loginMethod: sanitizeLoginMethod(payload.login_method),
  loginLocation: sanitizeLoginLocation(payload.login_location),
  generalLocation: resolveGeneralLocation(req),
});

const isMissingSessionTable = (error: RpcError | null | undefined) =>
  isMissingRelation(error, "tenant_admin_sessions");

const isMissingSessionMetadataColumn = (error: RpcError | null | undefined) =>
  isMissingColumn(error, "login_method") ||
  isMissingColumn(error, "login_location") ||
  isMissingColumn(error, "general_location");

const isMissingSessionAuthBindingColumn = (
  error: RpcError | null | undefined,
) =>
  isMissingColumn(error, "auth_session_id") ||
  isMissingColumn(error, "auth_token_hash") ||
  isMissingColumn(error, "auth_token_issued_at");

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

    const findActiveSession = async () => {
      if (!deviceSession.deviceId) {
        return {
          exists: false as const,
          relationMissing: false,
          revoked: false as const,
        };
      }
      const tokenBlock = await isTenantAdminTokenBlockedBySessionRevocation(
        adminClient,
        {
          tenantId,
          profileId: user.id,
          authToken,
        },
      );
      if (tokenBlock.relationMissing) {
        return {
          exists: false as const,
          relationMissing: true as const,
          revoked: false as const,
        };
      }
      if (tokenBlock.blocked) {
        return {
          exists: false as const,
          relationMissing: false as const,
          revoked: true as const,
        };
      }
      const { data, error } = await adminClient
        .from("tenant_admin_sessions")
        .select("id, auth_session_id, auth_token_hash")
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .eq("device_id", deviceSession.deviceId)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle();
      if (error) {
        if (isMissingSessionTable(error as RpcError)) {
          return {
            exists: false as const,
            relationMissing: true as const,
            revoked: false as const,
          };
        }
        if (isMissingSessionAuthBindingColumn(error as RpcError)) {
          return {
            exists: false as const,
            relationMissing: true as const,
            revoked: false as const,
          };
        }
        throw new Error("Unable to validate admin session.");
      }
      if (
        data?.id &&
        (
          (typeof data.auth_session_id === "string" &&
            data.auth_session_id.trim().length > 0 &&
            !!authSessionBinding.sessionId &&
            data.auth_session_id === authSessionBinding.sessionId) ||
          ((!data.auth_session_id ||
            (typeof data.auth_session_id === "string" &&
              data.auth_session_id.trim().length === 0)) &&
            typeof data.auth_token_hash === "string" &&
            data.auth_token_hash.trim() === authTokenBindingKey)
        )
      ) {
        return {
          exists: true as const,
          relationMissing: false as const,
          revoked: false as const,
        };
      }

      const { data: revokedRow, error: revokedError } = await adminClient
        .from("tenant_admin_sessions")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .eq("device_id", deviceSession.deviceId)
        .not("revoked_at", "is", null)
        .order("revoked_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (revokedError) {
        if (isMissingSessionTable(revokedError as RpcError)) {
          return {
            exists: false as const,
            relationMissing: true as const,
            revoked: false as const,
          };
        }
        throw new Error("Unable to validate admin session.");
      }

      return {
        exists: false as const,
        relationMissing: false as const,
        revoked: !!revokedRow?.id,
      };
    };

    const touchCurrentSession = async () => {
      if (!deviceSession.deviceId) {
        return {
          ok: false as const,
          relationMissing: false as const,
          reason: "missing_device",
        };
      }
      const now = new Date().toISOString();
      const { data: existing, error: existingError } = await adminClient
        .from("tenant_admin_sessions")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .eq("device_id", deviceSession.deviceId)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle();
      if (existingError) {
        console.error("admin-ops touch_session existing lookup failed", {
          request_id: requestId,
          tenant_id: tenantId,
          profile_id: user.id,
          device_id: deviceSession.deviceId,
          error: existingError,
        });
        if (isMissingSessionTable(existingError as RpcError)) {
          return {
            ok: false as const,
            relationMissing: true as const,
            reason: "missing_table",
          };
        }
        throw new Error(
          `Unable to register admin session: ${
            formatRpcError(existingError as RpcError)
          }`,
        );
      }

      const tokenBlock = await isTenantAdminTokenBlockedBySessionRevocation(
        adminClient,
        {
          tenantId,
          profileId: user.id,
          authToken,
        },
      );
      if (tokenBlock.relationMissing) {
        return {
          ok: false as const,
          relationMissing: true as const,
          reason: "missing_table",
        };
      }
      if (tokenBlock.blocked) {
        return {
          ok: false as const,
          relationMissing: false as const,
          reason: "revoked",
        };
      }

      if (existing?.id) {
        const baseUpdate = {
          last_seen_at: now,
          device_label: deviceSession.deviceLabel,
          user_agent: deviceSession.userAgent,
          auth_session_id: authSessionBinding.sessionId,
          auth_token_hash: authTokenBindingKey,
          auth_token_issued_at: authSessionBinding.issuedAt,
        };
        const metadataUpdate = {
          ...baseUpdate,
          ...(deviceSession.loginMethod
            ? { login_method: deviceSession.loginMethod }
            : {}),
          ...(deviceSession.loginLocation
            ? { login_location: deviceSession.loginLocation }
            : {}),
          ...(deviceSession.generalLocation
            ? { general_location: deviceSession.generalLocation }
            : {}),
        };
        const shouldTryMetadataUpdate = !!deviceSession.loginMethod ||
          !!deviceSession.loginLocation || !!deviceSession.generalLocation;
        const { error: updateError } = await adminClient
          .from("tenant_admin_sessions")
          .update(shouldTryMetadataUpdate ? metadataUpdate : baseUpdate)
          .eq("id", existing.id);
        if (updateError) {
          console.error("admin-ops touch_session update failed", {
            request_id: requestId,
            session_id: existing.id,
            tenant_id: tenantId,
            profile_id: user.id,
            device_id: deviceSession.deviceId,
            error: updateError,
            used_metadata_update: shouldTryMetadataUpdate,
          });
          if (isMissingSessionAuthBindingColumn(updateError as RpcError)) {
            return {
              ok: false as const,
              relationMissing: true as const,
              reason: "missing_table",
            };
          }
          if (
            shouldTryMetadataUpdate &&
            isMissingSessionMetadataColumn(updateError as RpcError)
          ) {
            const { error: fallbackUpdateError } = await adminClient
              .from("tenant_admin_sessions")
              .update({
                last_seen_at: now,
                device_label: deviceSession.deviceLabel,
                user_agent: deviceSession.userAgent,
              })
              .eq("id", existing.id);
            if (fallbackUpdateError) {
              console.error("admin-ops touch_session fallback update failed", {
                request_id: requestId,
                session_id: existing.id,
                tenant_id: tenantId,
                profile_id: user.id,
                device_id: deviceSession.deviceId,
                error: fallbackUpdateError,
              });
              throw new Error(
                `Unable to update admin session: ${
                  formatRpcError(fallbackUpdateError as RpcError)
                }`,
              );
            }
          } else {
            throw new Error(
              `Unable to update admin session: ${
                formatRpcError(updateError as RpcError)
              }`,
            );
          }
        }
      } else {
        const baseInsert = {
          tenant_id: tenantId,
          profile_id: user.id,
          device_id: deviceSession.deviceId,
          device_label: deviceSession.deviceLabel,
          user_agent: deviceSession.userAgent,
          auth_session_id: authSessionBinding.sessionId,
          auth_token_hash: authTokenBindingKey,
          auth_token_issued_at: authSessionBinding.issuedAt,
          created_at: now,
          last_seen_at: now,
        };
        const metadataInsert = {
          ...baseInsert,
          ...(deviceSession.loginMethod
            ? { login_method: deviceSession.loginMethod }
            : {}),
          ...(deviceSession.loginLocation
            ? { login_location: deviceSession.loginLocation }
            : {}),
          ...(deviceSession.generalLocation
            ? { general_location: deviceSession.generalLocation }
            : {}),
        };
        const shouldTryMetadataInsert = !!deviceSession.loginMethod ||
          !!deviceSession.loginLocation || !!deviceSession.generalLocation;
        const { error: insertError } = await adminClient
          .from("tenant_admin_sessions")
          .insert(shouldTryMetadataInsert ? metadataInsert : baseInsert);
        if (insertError) {
          console.error("admin-ops touch_session insert failed", {
            request_id: requestId,
            tenant_id: tenantId,
            profile_id: user.id,
            device_id: deviceSession.deviceId,
            error: insertError,
            used_metadata_insert: shouldTryMetadataInsert,
          });
          if (isMissingSessionTable(insertError as RpcError)) {
            return {
              ok: false as const,
              relationMissing: true as const,
              reason: "missing_table",
            };
          }
          if (isMissingSessionAuthBindingColumn(insertError as RpcError)) {
            return {
              ok: false as const,
              relationMissing: true as const,
              reason: "missing_table",
            };
          }
          if (
            shouldTryMetadataInsert &&
            isMissingSessionMetadataColumn(insertError as RpcError)
          ) {
            const { error: fallbackInsertError } = await adminClient
              .from("tenant_admin_sessions")
              .insert({
                tenant_id: tenantId,
                profile_id: user.id,
                device_id: deviceSession.deviceId,
                device_label: deviceSession.deviceLabel,
                user_agent: deviceSession.userAgent,
                auth_session_id: authSessionBinding.sessionId,
                auth_token_hash: authTokenBindingKey,
                auth_token_issued_at: authSessionBinding.issuedAt,
                created_at: now,
                last_seen_at: now,
              });
            if (fallbackInsertError) {
              console.error("admin-ops touch_session fallback insert failed", {
                request_id: requestId,
                tenant_id: tenantId,
                profile_id: user.id,
                device_id: deviceSession.deviceId,
                error: fallbackInsertError,
              });
              throw new Error(
                `Unable to register admin session: ${
                  formatRpcError(fallbackInsertError as RpcError)
                }`,
              );
            }
          } else {
            throw new Error(
              `Unable to register admin session: ${
                formatRpcError(insertError as RpcError)
              }`,
            );
          }
        }
      }

      return {
        ok: true as const,
        relationMissing: false as const,
        reason: "ok",
      };
    };

    if (profile.role === "tenant_admin" && !isSessionAction) {
      const activeSession = await findActiveSession();
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
      const activeSession = await findActiveSession();
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

    let checkoutDueHours = 72;
    let featureFlags = defaultFeatureFlags();
    let tenantPolicyResult: TenantPolicyResult = await adminClient
      .from("tenant_policies")
      .select("checkout_due_hours, account_category, plan_code, feature_flags")
      .eq("tenant_id", tenantId)
      .maybeSingle() as unknown as TenantPolicyResult;

    if (isMissingColumn(tenantPolicyResult.error, "feature_flags")) {
      const fallbackTenantPolicyResult = await adminClient
        .from("tenant_policies")
        .select("checkout_due_hours, account_category, plan_code")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      tenantPolicyResult = {
        data: fallbackTenantPolicyResult.data
          ? { ...fallbackTenantPolicyResult.data, feature_flags: null }
          : null,
        error: fallbackTenantPolicyResult.error,
      };
    }

    const tenantPolicy = tenantPolicyResult.data;

    if (!tenantPolicyResult.error && tenantPolicy) {
      if (typeof tenantPolicy.checkout_due_hours === "number") {
        checkoutDueHours = Math.min(
          720,
          Math.max(1, Math.round(tenantPolicy.checkout_due_hours)),
        );
      }
      featureFlags = normalizeFeatureFlags(tenantPolicy.feature_flags);
    }

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

    if (normalizedAction === "get_notifications") {
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
        tenantPolicy: tenantPolicy as AdminOpsContext["tenantPolicy"],
        checkoutDueHours,
        featureFlags,
        maintenance,
        tenantUpdates,
        jsonResponse,
      };
      return dispatchAdminOpsAction(context);
    }

    if (normalizedAction === "get_tenant_settings") {
      return jsonResponse(200, {
        data: {
          checkout_due_hours: checkoutDueHours,
          account_category: tenantPolicy?.account_category === "individual"
            ? "individual"
            : tenantPolicy?.account_category === "district"
            ? "district"
            : tenantPolicy?.account_category === "organization"
            ? "organization"
            : null,
          plan_code: tenantPolicy?.plan_code ?? null,
          feature_flags: featureFlags,
        },
      });
    }

    if (normalizedAction === "update_tenant_settings") {
      const next = payloadRecord;
      const checkoutDueHoursNext = optionalInteger(
        next.checkout_due_hours,
        1,
        720,
        24,
      );

      const row = {
        tenant_id: tenantId,
        checkout_due_hours: checkoutDueHoursNext,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };

      let settingsResult: TenantPolicyResult = await adminClient
        .from("tenant_policies")
        .upsert(row, { onConflict: "tenant_id" })
        .select(
          "checkout_due_hours, account_category, plan_code, feature_flags",
        )
        .single() as unknown as TenantPolicyResult;

      if (isMissingColumn(settingsResult.error, "feature_flags")) {
        const fallbackSettingsResult = await adminClient
          .from("tenant_policies")
          .upsert(row, { onConflict: "tenant_id" })
          .select("checkout_due_hours, account_category, plan_code")
          .single();

        settingsResult = {
          data: fallbackSettingsResult.data
            ? { ...fallbackSettingsResult.data, feature_flags: null }
            : null,
          error: fallbackSettingsResult.error,
        };
      }

      const { data, error } = settingsResult;

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to save tenant settings." });
      }

      return jsonResponse(200, {
        data: {
          checkout_due_hours: typeof data.checkout_due_hours === "number"
            ? data.checkout_due_hours
            : checkoutDueHoursNext,
          account_category: data.account_category === "individual"
            ? "individual"
            : data.account_category === "district"
            ? "district"
            : data.account_category === "organization"
            ? "organization"
            : null,
          plan_code: data.plan_code ?? null,
          feature_flags: normalizeFeatureFlags(data.feature_flags),
        },
      });
    }

    if (normalizedAction === "get_status_tracking") {
      const [flaggedResult, historyBaseResult] = await Promise.all([
        adminClient
          .from("gear")
          .select(
            "id, name, barcode, serial_number, status, notes, updated_at, created_at",
          )
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .not("status", "in", "(available,checked_out)")
          .order("updated_at", { ascending: false })
          .limit(400),
        adminClient
          .from("gear_status_history")
          .select("id, gear_id, status, note, changed_at, changed_by")
          .eq("tenant_id", tenantId)
          .order("changed_at", { ascending: false })
          .limit(600),
      ]);

      let flaggedItems: Array<{
        id: string;
        name: string;
        barcode: string;
        serial_number: string | null;
        status: string;
        notes: string | null;
        updated_at: string;
      }> = [];

      if (flaggedResult.error) {
        if (isMissingColumn(flaggedResult.error as RpcError, "updated_at")) {
          const fallbackFlagged = await adminClient
            .from("gear")
            .select(
              "id, name, barcode, serial_number, status, notes, created_at",
            )
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .not("status", "in", "(available,checked_out)")
            .order("created_at", { ascending: false })
            .limit(400);
          if (fallbackFlagged.error) {
            console.error(
              "admin-ops get_status_tracking flagged fallback failed",
              {
                message: fallbackFlagged.error.message,
                code: fallbackFlagged.error.code,
              },
            );
            return jsonResponse(400, {
              error: "Unable to load status tracking.",
            });
          }
          flaggedItems = ((fallbackFlagged.data ?? []) as Array<{
            id: string;
            name: string;
            barcode: string;
            serial_number: string | null;
            status: string;
            notes: string | null;
            created_at: string;
          }>).map((item) => ({
            ...item,
            updated_at: item.created_at,
          }));
        } else {
          console.error("admin-ops get_status_tracking flagged query failed", {
            message: flaggedResult.error.message,
            code: flaggedResult.error.code,
          });
          return jsonResponse(400, {
            error: "Unable to load status tracking.",
          });
        }
      } else {
        flaggedItems = ((flaggedResult.data ?? []) as Array<{
          id: string;
          name: string;
          barcode: string;
          serial_number: string | null;
          status: string;
          notes: string | null;
          updated_at?: string | null;
          created_at?: string | null;
        }>).map((item) => ({
          id: item.id,
          name: item.name,
          barcode: item.barcode,
          serial_number: item.serial_number,
          status: item.status,
          notes: item.notes,
          updated_at: item.updated_at ?? item.created_at ??
            new Date().toISOString(),
        }));
      }

      let history: Array<{
        id: string;
        gear_id: string;
        status: string;
        note: string | null;
        changed_at: string;
        changed_by: string | null;
        gear: { name: string; barcode: string } | null;
      }> = [];

      if (historyBaseResult.error) {
        if (
          !isMissingRelation(
            historyBaseResult.error as RpcError,
            "gear_status_history",
          )
        ) {
          console.error("admin-ops get_status_tracking history query failed", {
            message: historyBaseResult.error.message,
            code: historyBaseResult.error.code,
          });
          return jsonResponse(400, {
            error: "Unable to load status tracking.",
          });
        }
      } else {
        const historyRows = (historyBaseResult.data ?? []) as Array<{
          id: string;
          gear_id: string;
          status: string;
          note: string | null;
          changed_at: string;
          changed_by: string | null;
        }>;
        const gearIds = Array.from(
          new Set(historyRows.map((row) => row.gear_id)),
        );
        const { data: gearRows } = gearIds.length
          ? await adminClient.from("gear").select("id, name, barcode").in(
            "id",
            gearIds,
          )
          : { data: [] };
        const gearMap = new Map(
          ((gearRows ?? []) as Array<
            { id: string; name: string; barcode: string }
          >).map((row) => [
            row.id,
            { name: row.name, barcode: row.barcode },
          ]),
        );
        history = historyRows.map((row) => ({
          ...row,
          gear: gearMap.get(row.gear_id) ?? null,
        }));
      }

      return jsonResponse(200, {
        data: {
          flagged_items: flaggedItems,
          history,
        },
      });
    }

    if (normalizedAction === "touch_session") {
      const touch = await touchCurrentSession();
      if (touch.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!touch.ok) {
        if (touch.reason === "revoked") {
          return jsonResponse(401, { error: "Session revoked" });
        }
        return jsonResponse(400, { error: "Device session is required." });
      }
      return jsonResponse(200, { data: { ok: true } });
    }

    if (normalizedAction === "validate_session") {
      if (!deviceSession.deviceId) {
        return jsonResponse(400, { error: "Device session is required." });
      }
      const activeSession = await findActiveSession();
      if (activeSession.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeSession.exists) {
        return jsonResponse(200, { data: { valid: false } });
      }
      const touch = await touchCurrentSession();
      if (!touch.ok && !touch.relationMissing) {
        return jsonResponse(400, { error: "Unable to refresh admin session." });
      }
      return jsonResponse(200, { data: { valid: true } });
    }

    if (normalizedAction === "list_sessions") {
      let sessionQuery: {
        data:
          | Array<{
            id: string;
            device_id: string;
            device_label: string | null;
            user_agent: string | null;
            login_method?: "password" | "magic_link" | "session_handoff" | null;
            login_location?: "regular_login" | "admin_login" | null;
            general_location?: string | null;
            created_at: string;
            last_seen_at: string;
          }>
          | null;
        error: RpcError | null;
      } = await adminClient
        .from("tenant_admin_sessions")
        .select(
          "id, device_id, device_label, user_agent, login_method, login_location, general_location, created_at, last_seen_at",
        )
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(100);
      if (
        sessionQuery.error &&
        isMissingSessionMetadataColumn(sessionQuery.error as RpcError)
      ) {
        sessionQuery = await adminClient
          .from("tenant_admin_sessions")
          .select(
            "id, device_id, device_label, user_agent, created_at, last_seen_at",
          )
          .eq("tenant_id", tenantId)
          .eq("profile_id", user.id)
          .is("revoked_at", null)
          .order("last_seen_at", { ascending: false })
          .limit(100);
      }
      const { data, error } = sessionQuery;
      if (error) {
        if (isMissingSessionTable(error as RpcError)) {
          return jsonResponse(400, {
            error: "Session controls unavailable. Run latest SQL setup.",
          });
        }
        return jsonResponse(400, { error: "Unable to load active devices." });
      }
      const rows = (data ?? []) as Array<{
        id: string;
        device_id: string;
        device_label: string | null;
        user_agent: string | null;
        login_method?: "password" | "magic_link" | "session_handoff" | null;
        login_location?: "regular_login" | "admin_login" | null;
        general_location?: string | null;
        created_at: string;
        last_seen_at: string;
      }>;
      const dedupedRows = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const dedupeKey = row.device_id || row.id;
        if (!dedupedRows.has(dedupeKey)) {
          dedupedRows.set(dedupeKey, row);
        }
      }
      return jsonResponse(200, {
        data: {
          sessions: Array.from(dedupedRows.values()).map((row) => ({
            ...row,
            login_method: row.login_method ?? null,
            login_location: row.login_location ?? null,
            general_location: row.general_location ?? null,
            is_current: !!deviceSession.deviceId &&
              row.device_id === deviceSession.deviceId,
          })),
        },
      });
    }

    if (normalizedAction === "revoke_session") {
      const sessionId = sanitizeText(payloadRecord.session_id, 128);
      if (!sessionId) {
        return jsonResponse(400, { error: "Session id is required." });
      }
      const { data: revokedRows, error } = await adminClient
        .from("tenant_admin_sessions")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
        })
        .eq("id", sessionId)
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .is("revoked_at", null)
        .select("id");
      if (error) {
        if (isMissingSessionTable(error as RpcError)) {
          return jsonResponse(400, {
            error: "Session controls unavailable. Run latest SQL setup.",
          });
        }
        return jsonResponse(400, { error: "Unable to revoke session." });
      }
      if (!revokedRows?.length) {
        return jsonResponse(404, { error: "Session not found." });
      }
      return jsonResponse(200, { data: { revoked: true } });
    }

    if (normalizedAction === "revoke_current_session") {
      let query = adminClient
        .from("tenant_admin_sessions")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
        })
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .is("revoked_at", null);
      if (authSessionBinding.sessionId) {
        query = query.eq("auth_session_id", authSessionBinding.sessionId);
      } else if (deviceSession.deviceId) {
        query = query.eq("device_id", deviceSession.deviceId);
      } else {
        return jsonResponse(401, { error: "Session binding unavailable." });
      }
      const { data, error } = await query.select("id");
      if (error) {
        return jsonResponse(400, { error: "Unable to revoke session." });
      }
      return jsonResponse(200, {
        data: { revoked: (data ?? []).length > 0 },
      });
    }

    if (normalizedAction === "revoke_all_sessions") {
      const signOutCurrent = payloadRecord.sign_out_current === true;
      let query = adminClient
        .from("tenant_admin_sessions")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
        })
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .is("revoked_at", null);
      if (!signOutCurrent && deviceSession.deviceId) {
        query = query.neq("device_id", deviceSession.deviceId);
      }
      const { data, error } = await query.select("id");
      if (error) {
        if (isMissingSessionTable(error as RpcError)) {
          return jsonResponse(400, {
            error: "Session controls unavailable. Run latest SQL setup.",
          });
        }
        return jsonResponse(400, { error: "Unable to revoke sessions." });
      }
      return jsonResponse(200, {
        data: {
          revoked: (data ?? []).length,
        },
      });
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
