import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import {
  asRecord,
  optionalInteger,
  optionalJsonObject,
  optionalPositiveInteger,
  optionalText,
  requireText,
  requireUuid,
  ValidationError,
} from "../_shared/validation.ts";
import { optionalPostgrestSearchText } from "../_shared/postgrestSearch.ts";
import { enforcePreloginRateLimit } from "../_shared/preloginGuards.ts";
import { sendLoggedResendEmail } from "../_shared/emailDeliveryLog.ts";
import {
  buildSubprocessorEmailSubject,
  buildSubprocessorNoticeHtml,
  buildSubprocessorNoticePlainText,
  formatSubprocessorPreview,
  type SubprocessorChangeType,
} from "../_shared/subprocessorNotice.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type SupportRequestStatus = "open" | "in_progress" | "resolved" | "spam";

const SUPPORT_ATTACHMENT_BUCKET = "support-request-attachments";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SUPPORT_ATTACHMENT_EXTENSION_PATTERN = /^(png|jpg|webp|gif)$/i;

type SupportAttachmentRecord = {
  id: string;
  original_filename: string | null;
  stored_filename: string;
  content_type: string;
  size_bytes: number;
  storage_bucket: string | null;
  storage_path: string | null;
};
type SupabaseAdminClient = ReturnType<typeof createClient<any>>;

type SafeSupportAttachmentPathParts = {
  requestIdSegment: string;
  fileIdSegment: string;
  extensionSegment: string;
};

const getSafeSupportAttachmentPathParts = (attachment: {
  storage_bucket: string | null;
  storage_path: string | null;
}): SafeSupportAttachmentPathParts | null => {
  if (attachment.storage_bucket !== SUPPORT_ATTACHMENT_BUCKET) {
    return null;
  }
  if (typeof attachment.storage_path !== "string") {
    return null;
  }
  if (
    attachment.storage_path.includes("../") ||
    attachment.storage_path.includes("..\\") ||
    attachment.storage_path.startsWith("/") ||
    attachment.storage_path.startsWith("\\")
  ) {
    return null;
  }
  const normalizedPath = attachment.storage_path.trim();
  const pathSegments = normalizedPath.split("/");
  if (pathSegments.length !== 2) {
    return null;
  }

  const [requestIdSegment, fileNameSegment] = pathSegments;
  if (!UUID_PATTERN.test(requestIdSegment)) {
    return null;
  }

  const fileNameSegments = fileNameSegment.split(".");
  if (fileNameSegments.length !== 2) {
    return null;
  }

  const [fileIdSegment, extensionSegment] = fileNameSegments;
  if (
    !UUID_PATTERN.test(fileIdSegment) ||
    !SAFE_SUPPORT_ATTACHMENT_EXTENSION_PATTERN.test(extensionSegment)
  ) {
    return null;
  }

  return {
    requestIdSegment,
    fileIdSegment,
    extensionSegment: extensionSegment.toLowerCase(),
  };
};

const toSignedAttachmentResult = (
  attachment: Pick<
    SupportAttachmentRecord,
    | "id"
    | "original_filename"
    | "stored_filename"
    | "content_type"
    | "size_bytes"
  >,
  signedUrl: string | null,
) => ({
  id: attachment.id,
  original_filename: attachment.original_filename,
  stored_filename: attachment.stored_filename,
  content_type: attachment.content_type,
  size_bytes: attachment.size_bytes,
  signed_url: signedUrl,
});

const createSafeSupportAttachmentSignedUrl = async (
  adminClient: SupabaseAdminClient,
  rawStoragePath: string | null,
  expiresInSeconds: number,
) => {
  if (typeof rawStoragePath !== "string") {
    return { data: null, error: new Error("Invalid storage path.") };
  }

  const safePathParts = getSafeSupportAttachmentPathParts({
    storage_bucket: SUPPORT_ATTACHMENT_BUCKET,
    storage_path: rawStoragePath,
  });
  if (!safePathParts) {
    return { data: null, error: new Error("Invalid storage path.") };
  }

  const canonicalStoragePath = `${safePathParts.requestIdSegment}/` +
    `${safePathParts.fileIdSegment}.${safePathParts.extensionSegment}`;
  if (
    canonicalStoragePath.includes("../") ||
    canonicalStoragePath.includes("..\\")
  ) {
    return { data: null, error: new Error("Invalid storage path.") };
  }

  return adminClient.storage
    .from(SUPPORT_ATTACHMENT_BUCKET)
    .createSignedUrl(canonicalStoragePath, expiresInSeconds);
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

const isMissingRelation = (
  error: { code?: string; message?: string } | null,
  relation: string,
) => error?.code === "42P01" && (error.message ?? "").includes(relation);

const isMissingColumn = (
  error: { code?: string; message?: string } | null,
  column: string,
) => error?.code === "42703" && (error.message ?? "").includes(column);

const sanitizeText = (value: unknown, max = 255) =>
  optionalText(value, { maxLen: max });

const resolveGeneralLocation = (req: Request) => {
  const city = req.headers.get("cf-ipcity")?.trim();
  const region = req.headers.get("cf-region")?.trim();
  const country = req.headers.get("cf-ipcountry")?.trim();
  return [city, region, country].filter(Boolean).join(", ") || null;
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
    "super-ops",
    jsonResponse,
  );
  if (ingressError) return ingressError;

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, {
      error: "Unfortunately ItemTraxx is currently unavailable.",
    });
  }

  try {
    const authHeader = req.headers.get("authorization") ??
      req.headers.get("x-itx-user-jwt");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    // Prefer ITX_* secrets, but fall back to Supabase default injected env vars.
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ??
      Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(accessToken);

    if (authError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, auth_email, is_active")
      .eq("id", user.id)
      .single();

    if (
      profileError || profile?.role !== "super_admin" ||
      profile.is_active === false
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const parsedBody = asRecord(await readJsonBody(req));
    const action = requireText(parsedBody.action, { maxLen: 64 });
    const payload = asRecord(parsedBody.payload ?? {});

    const securitySettingsActions = new Set([
      "verify_password",
      "touch_session",
      "list_sessions",
      "revoke_session",
      "revoke_all_sessions",
    ]);

    if (!securitySettingsActions.has(action)) {
      try {
        const hasStepUp = await hasPrivilegedStepUp(adminClient, {
          userId: user.id,
          roleScope: "super_admin",
          authToken: accessToken,
        });
        if (!hasStepUp) {
          return jsonResponse(403, {
            error: "Super admin verification required.",
          });
        }
      } catch (error) {
        if (
          isMissingPrivilegedStepUpTable(
            error as { code?: string; message?: string },
          )
        ) {
          return jsonResponse(503, {
            error:
              "Privileged verification controls unavailable. Run latest SQL setup.",
          });
        }
        throw error;
      }
    }

    const rateLimit = await enforcePreloginRateLimit(
      adminClient,
      user.id,
      `super-admin-ops-${user.id}`,
      30,
      60,
    );

    if (!rateLimit.ok) {
      if (rateLimit.error) {
        console.error("super-ops rate limit rpc failed", {
          message: rateLimit.error.message,
        });
        return jsonResponse(503, { error: "Rate limit check failed." });
      }
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const writeAudit = async (
      actionType: string,
      targetType: string,
      targetId: string | null,
      metadata: Record<string, unknown>,
    ) => {
      const { error } = await adminClient.from("super_admin_audit_logs").insert({
        actor_id: user.id,
        actor_email: profile.auth_email ?? user.email ?? null,
        action_type: actionType,
        target_type: targetType,
        target_id: targetId,
        metadata,
      });
      if (error) throw new Error("Unable to write security audit log.");
    };

    if (action === "verify_password") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const password = typeof next.password === "string" ? next.password : "";
      const email = (profile.auth_email ?? user.email ?? "").trim()
        .toLowerCase();
      if (!password || !email) {
        return jsonResponse(400, { error: "Password is required." });
      }
      if (!publishableKey) {
        return jsonResponse(500, { error: "Server misconfiguration" });
      }

      const signInClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false },
      });
      const signIn = await signInClient.auth.signInWithPassword({
        email,
        password,
      });
      const verifiedUserId = signIn.data.user?.id ??
        signIn.data.session?.user?.id ?? null;
      if (signIn.error || !verifiedUserId || verifiedUserId !== user.id) {
        return jsonResponse(401, { error: "Invalid password." });
      }

      await writeAudit(
        "super_admin_settings_password_verified",
        "super_admin_auth",
        user.id,
        {},
      );
      return jsonResponse(200, { data: { verified: true } });
    }

    if (action === "touch_session") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const deviceId = sanitizeText(next.device_id, 128);
      const deviceLabel = sanitizeText(next.device_label, 160) || null;
      const loginMethodRaw = sanitizeText(next.login_method, 32);
      const loginLocationRaw = sanitizeText(next.login_location, 32);
      const loginMethod =
        loginMethodRaw === "password" || loginMethodRaw === "passkey"
          ? loginMethodRaw
          : null;
      const loginLocation = loginLocationRaw === "super_auth" ||
          loginLocationRaw === "super_settings"
        ? loginLocationRaw
        : null;
      if (!deviceId) {
        return jsonResponse(400, { error: "Device session is required." });
      }

      const { data: claimsData, error: claimsError } = await adminClient.auth
        .getClaims(accessToken);
      if (claimsError || !claimsData?.claims) {
        return jsonResponse(401, { error: "Unauthorized" });
      }
      const jwtPayload = claimsData.claims as Record<string, unknown>;
      const authSessionId = typeof jwtPayload?.session_id === "string"
        ? jwtPayload.session_id
        : null;
      const authIssuedAt = typeof jwtPayload?.iat === "number"
        ? new Date(jwtPayload.iat * 1000).toISOString()
        : null;

      const now = new Date().toISOString();
      const upsertPayload = {
        profile_id: user.id,
        device_id: deviceId,
        device_label: deviceLabel,
        user_agent: sanitizeText(req.headers.get("user-agent"), 1024) || null,
        login_method: loginMethod,
        login_location: loginLocation,
        general_location: resolveGeneralLocation(req),
        auth_session_id: authSessionId,
        auth_token_issued_at: authIssuedAt,
        last_seen_at: now,
        revoked_at: null,
      };

      const existing = await adminClient
        .from("super_admin_sessions")
        .select("id")
        .eq("profile_id", user.id)
        .eq("device_id", deviceId)
        .is("revoked_at", null)
        .maybeSingle();

      if (
        existing.error &&
        isMissingRelation(existing.error, "super_admin_sessions")
      ) {
        return jsonResponse(400, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (existing.error) {
        return jsonResponse(400, { error: "Unable to update session." });
      }

      if (existing.data?.id) {
        const { error } = await adminClient
          .from("super_admin_sessions")
          .update(upsertPayload)
          .eq("id", existing.data.id);
        if (error) {
          return jsonResponse(400, { error: "Unable to update session." });
        }
      } else {
        const { error } = await adminClient
          .from("super_admin_sessions")
          .insert({
            ...upsertPayload,
            created_at: now,
          });
        if (error && isMissingRelation(error, "super_admin_sessions")) {
          return jsonResponse(400, {
            error: "Session controls unavailable. Run latest SQL setup.",
          });
        }
        if (error) {
          return jsonResponse(400, { error: "Unable to create session." });
        }
      }

      return jsonResponse(200, { data: { ok: true } });
    }

    if (action === "list_sessions") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const currentDeviceId = sanitizeText(next.device_id, 128);

      let sessionQuery: {
        data: Array<Record<string, unknown>> | null;
        error: { code?: string; message?: string } | null;
      } = await adminClient
        .from("super_admin_sessions")
        .select(
          "id, device_id, device_label, user_agent, login_method, login_location, general_location, created_at, last_seen_at",
        )
        .eq("profile_id", user.id)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(100);

      if (
        sessionQuery.error &&
        isMissingColumn(sessionQuery.error, "login_method")
      ) {
        sessionQuery = await adminClient
          .from("super_admin_sessions")
          .select(
            "id, device_id, device_label, user_agent, created_at, last_seen_at",
          )
          .eq("profile_id", user.id)
          .is("revoked_at", null)
          .order("last_seen_at", { ascending: false })
          .limit(100);
      }

      if (
        sessionQuery.error &&
        isMissingRelation(sessionQuery.error, "super_admin_sessions")
      ) {
        return jsonResponse(400, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (sessionQuery.error) {
        return jsonResponse(400, { error: "Unable to load active sessions." });
      }

      const rows = (sessionQuery.data ?? []) as Array<Record<string, unknown>>;
      return jsonResponse(200, {
        data: {
          sessions: rows.map((row) => ({
            id: typeof row.id === "string" ? row.id : "",
            device_id: typeof row.device_id === "string" ? row.device_id : "",
            device_label: typeof row.device_label === "string"
              ? row.device_label
              : null,
            user_agent: typeof row.user_agent === "string"
              ? row.user_agent
              : null,
            login_method: typeof row.login_method === "string"
              ? row.login_method
              : null,
            login_location: typeof row.login_location === "string"
              ? row.login_location
              : null,
            general_location: typeof row.general_location === "string"
              ? row.general_location
              : null,
            created_at: typeof row.created_at === "string"
              ? row.created_at
              : null,
            last_seen_at: typeof row.last_seen_at === "string"
              ? row.last_seen_at
              : null,
            is_current: !!currentDeviceId &&
              typeof row.device_id === "string" &&
              row.device_id === currentDeviceId,
          })),
        },
      });
    }

    if (action === "revoke_session") {
      const next = payload;
      const sessionId = requireText(next.session_id, { maxLen: 128 });

      const { data, error } = await adminClient
        .from("super_admin_sessions")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
        })
        .eq("id", sessionId)
        .eq("profile_id", user.id)
        .is("revoked_at", null)
        .select("id");
      if (error && isMissingRelation(error, "super_admin_sessions")) {
        return jsonResponse(400, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (error) {
        return jsonResponse(400, { error: "Unable to revoke session." });
      }
      if (!data?.length) {
        return jsonResponse(404, { error: "Session not found." });
      }
      return jsonResponse(200, { data: { revoked: true } });
    }

    if (action === "revoke_all_sessions") {
      const next = (payload ?? {}) as Record<string, unknown>;
      const signOutCurrent = next.sign_out_current === true;
      const currentDeviceId = sanitizeText(next.device_id, 128);
      let query = adminClient
        .from("super_admin_sessions")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
        })
        .eq("profile_id", user.id)
        .is("revoked_at", null);
      if (!signOutCurrent && currentDeviceId) {
        query = query.neq("device_id", currentDeviceId);
      }
      const { data, error } = await query.select("id");
      if (error && isMissingRelation(error, "super_admin_sessions")) {
        return jsonResponse(400, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (error) {
        return jsonResponse(400, { error: "Unable to revoke sessions." });
      }
      return jsonResponse(200, { data: { revoked: (data ?? []).length } });
    }

    const writeSupportRequestEvent = async (
      supportRequestId: string,
      eventType: string,
      metadata: Record<string, unknown> | null = null,
    ) => {
      await adminClient.from("support_request_events").insert({
        support_request_id: supportRequestId,
        actor_id: user.id,
        actor_email: profile.auth_email ?? user.email ?? null,
        event_type: eventType,
        metadata,
      });
    };

    const buildSupportRequestDetail = async (supportRequestId: string) => {
      const { data: request, error: requestError } = await adminClient
        .from("support_requests")
        .select(
          "id, requester_name, reply_email, subject, category, message, source, status, assigned_to, internal_notes, created_at, updated_at",
        )
        .eq("id", supportRequestId)
        .single();

      if (requestError || !request) {
        return { error: "Support request not found.", data: null };
      }

      const [
        { data: attachments, error: attachmentsError },
        { data: events, error: eventsError },
      ] = await Promise.all([
        adminClient
          .from("support_request_attachments")
          .select(
            "id, original_filename, stored_filename, content_type, size_bytes, storage_bucket, storage_path",
          )
          .eq("support_request_id", supportRequestId)
          .order("created_at", { ascending: true }),
        adminClient
          .from("support_request_events")
          .select("id, actor_id, actor_email, event_type, metadata, created_at")
          .eq("support_request_id", supportRequestId)
          .order("created_at", { ascending: true }),
      ]);

      if (attachmentsError || eventsError) {
        return { error: "Unable to load support request details.", data: null };
      }

      let assignedToEmail: string | null = null;
      if (request.assigned_to) {
        const { data: assignedProfile } = await adminClient
          .from("profiles")
          .select("auth_email")
          .eq("id", request.assigned_to)
          .single();
        assignedToEmail = assignedProfile?.auth_email ?? null;
      }

      const signedAttachments = await Promise.all(
        ((attachments ?? []) as SupportAttachmentRecord[]).map(
          async (attachment) => {
            if (!getSafeSupportAttachmentPathParts(attachment)) {
              return toSignedAttachmentResult(attachment, null);
            }

            const { data: signedData, error: signedError } =
              await createSafeSupportAttachmentSignedUrl(
                adminClient,
                attachment.storage_path,
                60 * 60,
              );

            return toSignedAttachmentResult(
              attachment,
              signedError ? null : signedData?.signedUrl ?? null,
            );
          },
        ),
      );

      return {
        error: null,
        data: {
          ...request,
          assigned_to_email: assignedToEmail,
          attachments: signedAttachments,
          events: events ?? [],
        },
      };
    };

    if (action === "get_control_center") {
      const [
        runtimeConfigResult,
        alertRulesResult,
        approvalsResult,
        jobsResult,
      ] = await Promise.all([
        adminClient.from("app_runtime_config").select("key, value"),
        adminClient
          .from("super_alert_rules")
          .select("id, name, metric_key, threshold, is_enabled, created_at")
          .order("created_at", { ascending: false }),
        adminClient
          .from("super_approvals")
          .select(
            "id, action_type, payload, requested_by, approved_by, status, created_at, decided_at",
          )
          .order("created_at", { ascending: false })
          .limit(50),
        adminClient
          .from("super_jobs")
          .select("id, job_type, status, details, created_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(50),
      ]);

      if (
        runtimeConfigResult.error || alertRulesResult.error ||
        approvalsResult.error || jobsResult.error
      ) {
        return jsonResponse(400, { error: "Unable to load control center." });
      }

      const runtimeConfig = Object.fromEntries(
        (runtimeConfigResult.data ?? []).map((item) => [item.key, item.value]),
      );

      return jsonResponse(200, {
        data: {
          runtime_config: runtimeConfig,
          alert_rules: alertRulesResult.data ?? [],
          approvals: approvalsResult.data ?? [],
          jobs: jobsResult.data ?? [],
        },
      });
    }

    if (action === "set_runtime_config") {
      const next = payload;
      const key = requireText(next.key, { maxLen: 120 });
      const value = optionalJsonObject(next.value, 25_000);

      const { data, error } = await adminClient
        .from("app_runtime_config")
        .upsert({
          key,
          value,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "key" })
        .select("key, value")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to save runtime config." });
      }

      await writeAudit("set_runtime_config", "config", key, { key });

      return jsonResponse(200, { data });
    }

    if (action === "upsert_alert_rule") {
      const next = payload;
      const id = optionalText(next.id, { maxLen: 36 });
      if (id && !UUID_PATTERN.test(id)) {
        return jsonResponse(400, { error: "Invalid request" });
      }
      const name = requireText(next.name, { maxLen: 120 });
      const metricKey = requireText(next.metric_key, { maxLen: 120 });
      const threshold = Number(next.threshold);
      const isEnabled = next.is_enabled !== false;
      if (!Number.isFinite(threshold)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const payloadRow = {
        ...(id ? { id } : {}),
        name,
        metric_key: metricKey,
        threshold,
        is_enabled: isEnabled,
        created_by: user.id,
      };

      const { data, error } = await adminClient
        .from("super_alert_rules")
        .upsert(payloadRow)
        .select("id, name, metric_key, threshold, is_enabled, created_at")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to save alert rule." });
      }

      await writeAudit("upsert_alert_rule", "alert_rule", data.id, {
        metric_key: data.metric_key,
        threshold: data.threshold,
      });

      return jsonResponse(200, { data });
    }

    if (action === "set_tenant_policy") {
      const next = payload;
      const tenantId = requireUuid(next.tenant_id);

      const row = {
        tenant_id: tenantId,
        max_admins: optionalPositiveInteger(next.max_admins, 1000),
        max_students: optionalPositiveInteger(next.max_students, 100_000),
        max_gear: optionalPositiveInteger(next.max_gear, 100_000),
        checkout_due_hours: optionalInteger(
          next.checkout_due_hours,
          1,
          720,
          72,
        ),
        barcode_pattern: optionalText(next.barcode_pattern, { maxLen: 80 }) ||
          null,
        feature_flags: optionalJsonObject(next.feature_flags, 10_000),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await adminClient
        .from("tenant_policies")
        .upsert(row, { onConflict: "tenant_id" })
        .select(
          "tenant_id, max_admins, max_students, max_gear, checkout_due_hours, barcode_pattern, feature_flags",
        )
        .single();

      if (error || !data) {
        const message = (error?.message ?? "").toLowerCase();
        if (
          error?.code === "42703" &&
          (message.includes("feature_flags") ||
            message.includes("account_category") ||
            message.includes("plan_code"))
        ) {
          const { data: fallbackData, error: fallbackError } = await adminClient
            .from("tenant_policies")
            .upsert(
              {
                tenant_id: tenantId,
                max_admins: row.max_admins,
                max_students: row.max_students,
                max_gear: row.max_gear,
                checkout_due_hours: row.checkout_due_hours,
                barcode_pattern: row.barcode_pattern,
                updated_by: row.updated_by,
                updated_at: row.updated_at,
              },
              { onConflict: "tenant_id" },
            )
            .select(
              "tenant_id, max_admins, max_students, max_gear, checkout_due_hours, barcode_pattern",
            )
            .single();
          if (fallbackError || !fallbackData) {
            return jsonResponse(400, {
              error: "Unable to save tenant policy.",
            });
          }
          await writeAudit(
            "set_tenant_policy",
            "tenant_policy",
            tenantId,
            fallbackData as Record<string, unknown>,
          );
          return jsonResponse(200, { data: fallbackData });
        }
        return jsonResponse(400, { error: "Unable to save tenant policy." });
      }

      await writeAudit(
        "set_tenant_policy",
        "tenant_policy",
        tenantId,
        data as Record<string, unknown>,
      );
      return jsonResponse(200, { data });
    }

    if (action === "set_tenant_force_reauth") {
      const next = payload;
      const tenantId = requireUuid(next.tenant_id);

      const forceAt = new Date().toISOString();
      const { error } = await adminClient
        .from("tenant_security_controls")
        .upsert({
          tenant_id: tenantId,
          force_reauth_after: forceAt,
          updated_by: user.id,
          updated_at: forceAt,
        }, { onConflict: "tenant_id" });

      if (error) {
        return jsonResponse(400, { error: "Unable to force tenant re-login." });
      }

      const { data: job } = await adminClient
        .from("super_jobs")
        .insert({
          job_type: "force_tenant_reauth",
          status: "completed",
          details: { tenant_id: tenantId, force_reauth_after: forceAt },
          created_by: user.id,
        })
        .select("id, job_type, status, details, created_at, updated_at")
        .single();

      await writeAudit("force_tenant_reauth", "tenant", tenantId, {
        force_reauth_after: forceAt,
      });

      return jsonResponse(200, { data: { success: true, job } });
    }

    if (action === "create_approval") {
      const next = payload;
      const actionType = requireText(next.action_type, { maxLen: 120 });
      const approvalPayload = optionalJsonObject(next.payload, 25_000);

      const { data, error } = await adminClient
        .from("super_approvals")
        .insert({
          action_type: actionType,
          payload: approvalPayload,
          requested_by: user.id,
          status: "pending",
        })
        .select("id, action_type, payload, requested_by, status, created_at")
        .single();

      if (error || !data) {
        return jsonResponse(400, {
          error: "Unable to create approval request.",
        });
      }

      await writeAudit("create_approval", "approval", data.id, {
        action_type: actionType,
      });

      return jsonResponse(200, { data });
    }

    if (action === "approve_request") {
      const next = payload;
      const id = requireUuid(next.id);

      const { data: approval, error: approvalError } = await adminClient
        .from("super_approvals")
        .select("id, requested_by, status")
        .eq("id", id)
        .single();

      if (approvalError || !approval?.id) {
        return jsonResponse(400, { error: "Approval request not found." });
      }
      if (approval.requested_by === user.id) {
        return jsonResponse(403, { error: "Requester cannot self-approve." });
      }
      if (approval.status !== "pending") {
        return jsonResponse(400, {
          error: "Approval request is already resolved.",
        });
      }

      const { data, error } = await adminClient
        .from("super_approvals")
        .update({
          status: "approved",
          approved_by: user.id,
          decided_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select(
          "id, action_type, payload, requested_by, approved_by, status, created_at, decided_at",
        )
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to approve request." });
      }

      await writeAudit("approve_request", "approval", id, {});
      return jsonResponse(200, { data });
    }

    if (action === "list_support_requests") {
      const next = payload;
      const search = optionalPostgrestSearchText(next.search, { maxLen: 120 });
      const status = optionalText(next.status, { maxLen: 40 });
      const limit = optionalInteger(next.limit, 1, 200, 100);
      const allowedStatuses = new Set<SupportRequestStatus>([
        "open",
        "in_progress",
        "resolved",
        "spam",
      ]);

      let query = adminClient
        .from("support_requests")
        .select(
          "id, requester_name, reply_email, subject, category, status, created_at, updated_at, assigned_to",
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status && allowedStatuses.has(status as SupportRequestStatus)) {
        query = query.eq("status", status);
      } else if (status) {
        return jsonResponse(400, { error: "Invalid support request status." });
      }

      if (search) {
        query = query.or(
          `requester_name.ilike.%${search}%,reply_email.ilike.%${search}%,subject.ilike.%${search}%,message.ilike.%${search}%`,
        );
      }

      const { data, error } = await query;
      if (error) {
        return jsonResponse(400, { error: "Unable to load support requests." });
      }

      return jsonResponse(200, { data: { requests: data ?? [] } });
    }

    if (action === "get_support_request") {
      const next = payload;
      const supportRequestId = requireUuid(next.support_request_id);

      const detail = await buildSupportRequestDetail(supportRequestId);
      if (detail.error || !detail.data) {
        return jsonResponse(400, {
          error: detail.error ?? "Unable to load support request.",
        });
      }

      return jsonResponse(200, { data: { request: detail.data } });
    }

    if (action === "update_support_request") {
      const next = payload;
      const supportRequestId = requireUuid(next.support_request_id);
      const status = next.status === undefined
        ? undefined
        : optionalText(next.status, { maxLen: 40 }) as SupportRequestStatus;
      const internalNotes = next.internal_notes === undefined
        ? undefined
        : optionalText(next.internal_notes, { maxLen: 4000 });
      const assignToMe = next.assign_to_me === true;
      const clearAssignment = next.clear_assignment === true;
      const allowedStatuses = new Set<SupportRequestStatus>([
        "open",
        "in_progress",
        "resolved",
        "spam",
      ]);

      if (status && !allowedStatuses.has(status)) {
        return jsonResponse(400, { error: "Invalid support request status." });
      }
      if (assignToMe && clearAssignment) {
        return jsonResponse(400, { error: "Invalid assignment request." });
      }

      const { data: existing, error: existingError } = await adminClient
        .from("support_requests")
        .select("id, status, internal_notes, assigned_to")
        .eq("id", supportRequestId)
        .single();

      if (existingError || !existing) {
        return jsonResponse(400, { error: "Support request not found." });
      }

      const updates: Record<string, unknown> = {};
      const eventMetadata: Record<string, unknown> = {};

      if (status && status !== existing.status) {
        updates.status = status;
        eventMetadata.status = { from: existing.status, to: status };
      }

      if (
        internalNotes !== undefined &&
        internalNotes !== (existing.internal_notes ?? "")
      ) {
        updates.internal_notes = internalNotes || null;
        eventMetadata.internal_notes_updated = true;
      }

      if (assignToMe && existing.assigned_to !== user.id) {
        updates.assigned_to = user.id;
        eventMetadata.assignment = {
          from: existing.assigned_to,
          to: user.id,
        };
      } else if (clearAssignment && existing.assigned_to !== null) {
        updates.assigned_to = null;
        eventMetadata.assignment = {
          from: existing.assigned_to,
          to: null,
        };
      }

      if (Object.keys(updates).length === 0) {
        const detail = await buildSupportRequestDetail(supportRequestId);
        if (detail.error || !detail.data) {
          return jsonResponse(400, {
            error: detail.error ?? "Unable to load support request.",
          });
        }
        return jsonResponse(200, { data: { request: detail.data } });
      }

      updates.updated_at = new Date().toISOString();

      const { error: updateError } = await adminClient
        .from("support_requests")
        .update(updates)
        .eq("id", supportRequestId);

      if (updateError) {
        return jsonResponse(400, {
          error: "Unable to update support request.",
        });
      }

      await writeSupportRequestEvent(
        supportRequestId,
        "updated",
        eventMetadata,
      );
      await writeAudit(
        "update_support_request",
        "support_request",
        supportRequestId,
        eventMetadata,
      );

      const detail = await buildSupportRequestDetail(supportRequestId);
      if (detail.error || !detail.data) {
        return jsonResponse(400, {
          error: detail.error ?? "Unable to load support request.",
        });
      }

      return jsonResponse(200, { data: { request: detail.data } });
    }

    if (action === "list_sales_leads") {
      const next = payload;
      const search = optionalPostgrestSearchText(next.search, { maxLen: 120 });
      const limit = optionalInteger(next.limit, 1, 200, 100);

      let query = adminClient
        .from("sales_leads")
        .select(
          "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,organization.ilike.%${search}%,reply_email.ilike.%${search}%`,
        );
      }

      const { data, error } = await query;
      if (error) {
        return jsonResponse(400, { error: "Unable to load sales leads." });
      }

      return jsonResponse(200, {
        data: {
          leads: data ?? [],
        },
      });
    }

    if (action === "close_sales_lead") {
      const next = payload;
      const leadId = requireUuid(next.lead_id);

      const { data, error } = await adminClient
        .from("sales_leads")
        .update({
          lead_state: "closed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .select(
          "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at",
        )
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to close sales lead." });
      }

      await writeAudit("close_sales_lead", "sales_lead", leadId, {});
      return jsonResponse(200, { data: { lead: data } });
    }

    if (action === "move_sales_lead_to_customer") {
      const next = payload;
      const leadId = requireUuid(next.lead_id);

      const { data, error } = await adminClient
        .from("sales_leads")
        .update({
          lead_state: "converted_to_customer",
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .select(
          "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at",
        )
        .single();

      if (error || !data) {
        return jsonResponse(400, {
          error: "Unable to move lead to customers.",
        });
      }

      await writeAudit("move_sales_lead_to_customer", "sales_lead", leadId, {});
      return jsonResponse(200, { data: { lead: data } });
    }

    if (action === "set_sales_lead_stage") {
      const next = payload;
      const leadId = requireUuid(next.lead_id);
      const stage = optionalText(next.stage, { maxLen: 40 });
      const allowedStages = new Set([
        "waiting_for_quote",
        "quote_generated",
        "quote_sent",
        "quote_converted_to_invoice",
        "invoice_sent",
        "invoice_paid",
      ]);
      if (!allowedStages.has(stage)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("sales_leads")
        .update({
          stage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .select(
          "id, plan, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at",
        )
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to update lead stage." });
      }

      await writeAudit("set_sales_lead_stage", "sales_lead", leadId, { stage });
      return jsonResponse(200, { data: { lead: data } });
    }

    if (action === "delete_sales_lead") {
      const next = payload;
      const leadId = requireUuid(next.lead_id);

      const { error } = await adminClient
        .from("sales_leads")
        .delete()
        .eq("id", leadId);

      if (error) {
        return jsonResponse(400, { error: "Unable to delete sales lead." });
      }

      await writeAudit("delete_sales_lead", "sales_lead", leadId, {});
      return jsonResponse(200, { data: { deleted: true } });
    }

    if (action === "list_customers") {
      const next = payload;
      const search = optionalPostgrestSearchText(next.search, { maxLen: 120 });
      const limit = optionalInteger(next.limit, 1, 300, 150);

      let leadQuery = adminClient
        .from("sales_leads")
        .select(
          "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, created_at, updated_at",
        )
        .eq("lead_state", "converted_to_customer")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (search) {
        leadQuery = leadQuery.or(
          `name.ilike.%${search}%,organization.ilike.%${search}%,reply_email.ilike.%${search}%`,
        );
      }

      const { data: leads, error: leadError } = await leadQuery;
      if (leadError) {
        return jsonResponse(400, { error: "Unable to load customers." });
      }

      const leadIds = (leads ?? []).map((lead) => lead.id as string);
      const { data: statusLogs, error: statusError } = leadIds.length
        ? await adminClient
          .from("customer_status_logs")
          .select("id, lead_id, invoice_id, status, created_at, created_by")
          .in("lead_id", leadIds)
          .order("created_at", { ascending: false })
        : { data: [], error: null };

      if (statusError) {
        return jsonResponse(400, {
          error: "Unable to load customer status logs.",
        });
      }

      const groupedLogs = new Map<
        string,
        Array<{
          id: string;
          lead_id: string;
          invoice_id: string;
          status: string;
          created_at: string;
          created_by: string | null;
        }>
      >();
      for (
        const row of (statusLogs ?? []) as Array<{
          id: string;
          lead_id: string;
          invoice_id: string;
          status: string;
          created_at: string;
          created_by: string | null;
        }>
      ) {
        const list = groupedLogs.get(row.lead_id) ?? [];
        list.push(row);
        groupedLogs.set(row.lead_id, list);
      }

      const customers = (leads ?? []).map((lead) => {
        const logs = groupedLogs.get(lead.id as string) ?? [];
        const latest = logs[0] ?? null;
        return {
          ...lead,
          latest_status: latest?.status ?? null,
          latest_invoice_id: latest?.invoice_id ?? null,
          status_logs: logs,
        };
      });

      return jsonResponse(200, { data: { customers } });
    }

    if (action === "add_customer_status_entry") {
      const next = payload;
      const leadId = requireUuid(next.lead_id);
      const invoiceId = requireText(next.invoice_id, { maxLen: 120 });
      const status = optionalText(next.status, { maxLen: 40 });
      const allowedStatuses = new Set([
        "paid_on_time",
        "paid_late",
        "awaiting_payment",
        "canceling",
      ]);
      if (!allowedStatuses.has(status)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("customer_status_logs")
        .insert({
          lead_id: leadId,
          invoice_id: invoiceId,
          status,
          created_by: user.id,
        })
        .select("id, lead_id, invoice_id, status, created_at, created_by")
        .single();

      if (error || !data) {
        return jsonResponse(400, {
          error: "Unable to add customer status entry.",
        });
      }

      await writeAudit("add_customer_status_entry", "sales_lead", leadId, {
        invoice_id: invoiceId,
        status,
      });
      return jsonResponse(200, { data: { entry: data } });
    }

    if (action === "get_internal_ops_snapshot") {
      const nowIso = new Date().toISOString();
      const since15mIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString();

      const [
        recentLogsResult,
        queueRowsResult,
        leadsResult,
        runtimeConfigResult,
        auditRowsResult,
        customerLeadRowsResult,
      ] = await Promise.all([
        adminClient
          .from("gear_logs")
          .select(
            "tenant_id, gear_id, checked_out_by, action_type, action_time",
          )
          .in("action_type", ["checkout", "return"])
          .gte("action_time", since24hIso)
          .order("action_time", { ascending: false })
          .limit(400),
        adminClient
          .from("async_jobs")
          .select("status, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        adminClient
          .from("sales_leads")
          .select("id, lead_state, stage, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        adminClient
          .from("app_runtime_config")
          .select("key, value")
          .in("key", ["maintenance_mode", "broadcast_message"]),
        adminClient
          .from("super_admin_audit_logs")
          .select(
            "id, actor_email, action_type, target_type, target_id, metadata, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(50),
        adminClient
          .from("sales_leads")
          .select("id, lead_state, created_at, updated_at")
          .eq("lead_state", "converted_to_customer")
          .order("created_at", { ascending: false })
          .limit(600),
      ]);

      if (recentLogsResult.error) {
        return jsonResponse(400, {
          error: "Unable to load recent traffic logs.",
        });
      }
      if (queueRowsResult.error) {
        return jsonResponse(400, { error: "Unable to load async jobs." });
      }
      if (leadsResult.error) {
        return jsonResponse(400, { error: "Unable to load lead metrics." });
      }
      if (auditRowsResult.error) {
        return jsonResponse(400, { error: "Unable to load audit feed." });
      }
      if (customerLeadRowsResult.error) {
        return jsonResponse(400, {
          error: "Unable to load customer health metrics.",
        });
      }

      const recentLogs = recentLogsResult.data ?? [];
      const logs15m = recentLogs.filter((row) =>
        row.action_time >= since15mIso
      );
      const checkout15m = logs15m.filter((row) =>
        row.action_type === "checkout"
      ).length;
      const return15m = logs15m.filter((row) =>
        row.action_type === "return"
      ).length;
      const activeTenants15m = new Set(logs15m.map((row) =>
        row.tenant_id
      )).size;

      const queueRows = queueRowsResult.data ?? [];
      const queueTotal = queueRows.length;
      const queueSummary = {
        queued: queueRows.filter((row) => row.status === "queued").length,
        processing: queueRows.filter((row) =>
          row.status === "processing"
        ).length,
        completed: queueRows.filter((row) => row.status === "completed").length,
        failed: queueRows.filter((row) => row.status === "failed").length,
      };

      const leads = leadsResult.data ?? [];
      const leadSummary = {
        open: leads.filter((row) => row.lead_state === "open").length,
        closed: leads.filter((row) => row.lead_state === "closed").length,
        converted: leads.filter((row) =>
          row.lead_state === "converted_to_customer"
        ).length,
        waiting_for_quote: leads.filter((row) =>
          row.stage === "waiting_for_quote"
        ).length,
        quote_sent: leads.filter((row) => row.stage === "quote_sent").length,
        invoice_sent:
          leads.filter((row) => row.stage === "invoice_sent").length,
        invoice_paid:
          leads.filter((row) => row.stage === "invoice_paid").length,
      };

      const trafficHourKeys = Array.from({ length: 24 }, (_, offset) => {
        const date = new Date(Date.now() - (23 - offset) * 60 * 60 * 1000);
        date.setMinutes(0, 0, 0);
        return date.toISOString();
      });
      const trafficByHourMap = new Map(
        trafficHourKeys.map((
          iso,
        ) => [iso, { hour: iso, checkout: 0, return: 0 }]),
      );
      for (const log of recentLogs) {
        const hourDate = new Date(log.action_time);
        hourDate.setMinutes(0, 0, 0);
        const hourKey = hourDate.toISOString();
        const bucket = trafficByHourMap.get(hourKey);
        if (!bucket) continue;
        if (log.action_type === "checkout") {
          bucket.checkout += 1;
        } else if (log.action_type === "return") {
          bucket.return += 1;
        }
      }

      const leadFunnel = {
        waiting_for_quote:
          leads.filter((row) => row.stage === "waiting_for_quote").length,
        quote_generated:
          leads.filter((row) => row.stage === "quote_generated").length,
        quote_sent: leads.filter((row) => row.stage === "quote_sent").length,
        quote_converted_to_invoice:
          leads.filter((row) => row.stage === "quote_converted_to_invoice")
            .length,
        invoice_sent:
          leads.filter((row) => row.stage === "invoice_sent").length,
        invoice_paid:
          leads.filter((row) => row.stage === "invoice_paid").length,
      };

      const tenantIds = Array.from(
        new Set(
          recentLogs.map((row) => row.tenant_id).filter((
            value,
          ): value is string => !!value),
        ),
      );
      const gearIds = Array.from(
        new Set(
          recentLogs.map((row) => row.gear_id).filter((
            value,
          ): value is string => !!value),
        ),
      );
      const studentIds = Array.from(
        new Set(
          recentLogs.map((row) => row.checked_out_by).filter((
            value,
          ): value is string => !!value),
        ),
      );

      const [
        tenantRowsResult,
        gearRowsResult,
        studentRowsResult,
        allTenantsResult,
      ] = await Promise.all([
        tenantIds.length
          ? adminClient.from("tenants").select("id, name").in("id", tenantIds)
          : Promise.resolve({ data: [], error: null }),
        gearIds.length
          ? adminClient.from("gear").select("id, name, barcode").in(
            "id",
            gearIds,
          )
          : Promise.resolve({ data: [], error: null }),
        studentIds.length
          ? adminClient.from("students").select("id, username, student_id").in(
            "id",
            studentIds,
          )
          : Promise.resolve({ data: [], error: null }),
        adminClient
          .from("tenants")
          .select("id, name, status")
          .order("name", { ascending: true })
          .limit(300),
      ]);

      const tenantMap = new Map(
        (tenantRowsResult.data ?? []).map((
          tenant,
        ) => [tenant.id as string, tenant.name as string]),
      );
      const gearMap = new Map(
        (gearRowsResult.data ?? []).map((gear) => [
          gear.id as string,
          {
            name: gear.name as string | null,
            barcode: gear.barcode as string | null,
          },
        ]),
      );
      const studentMap = new Map(
        (studentRowsResult.data ?? []).map((student) => [
          student.id as string,
          {
            username: student.username as string | null,
            student_id: student.student_id as string | null,
          },
        ]),
      );
      const allTenants = (allTenantsResult.data ?? []) as Array<{
        id: string;
        name: string;
        status: string | null;
      }>;

      const recentEvents = recentLogs.slice(0, 40).map((row) => {
        const gear = row.gear_id ? gearMap.get(row.gear_id) : null;
        const student = row.checked_out_by
          ? studentMap.get(row.checked_out_by)
          : null;
        return {
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_id
            ? tenantMap.get(row.tenant_id) ?? "Unknown tenant"
            : "Unknown tenant",
          action_type: row.action_type,
          action_time: row.action_time,
          gear_name: gear?.name ?? null,
          gear_barcode: gear?.barcode ?? null,
          student_username: student?.username ?? null,
          student_id: student?.student_id ?? null,
        };
      });

      const auditRows = (auditRowsResult.data ?? []) as Array<{
        id: string;
        actor_email: string | null;
        action_type: string;
        target_type: string | null;
        target_id: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>;

      const durationSamples = auditRows
        .map((row) => {
          const value = row.metadata?.duration_ms;
          return typeof value === "number" && Number.isFinite(value)
            ? value
            : null;
        })
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      const percentile = (values: number[], p: number) => {
        if (values.length === 0) return null;
        const idx = Math.min(
          values.length - 1,
          Math.max(0, Math.floor((values.length - 1) * p)),
        );
        return values[idx] ?? null;
      };
      const medianDuration = percentile(durationSamples, 0.5);
      const p95Duration = percentile(durationSamples, 0.95);

      const customerLeads = (customerLeadRowsResult.data ?? []) as Array<{
        id: string;
        lead_state: string;
        created_at: string;
        updated_at: string | null;
      }>;
      const customerLeadIds = customerLeads.map((row) => row.id);
      const { data: customerStatusRows, error: customerStatusError } =
        customerLeadIds.length
          ? await adminClient
            .from("customer_status_logs")
            .select("lead_id, status, created_at")
            .in("lead_id", customerLeadIds)
            .order("created_at", { ascending: false })
            .limit(2000)
          : { data: [], error: null };
      if (customerStatusError) {
        return jsonResponse(400, {
          error: "Unable to load customer status metrics.",
        });
      }

      const latestStatusByLead = new Map<string, string>();
      for (
        const row of (customerStatusRows ?? []) as Array<{
          lead_id: string;
          status: string;
          created_at: string;
        }>
      ) {
        if (!latestStatusByLead.has(row.lead_id)) {
          latestStatusByLead.set(row.lead_id, row.status);
        }
      }
      const customerHealth = {
        total_customers: customerLeads.length,
        awaiting_payment: 0,
        canceling: 0,
        paid_late: 0,
        paid_on_time: 0,
        no_status: 0,
      };
      for (const lead of customerLeads) {
        const status = latestStatusByLead.get(lead.id) ?? null;
        if (!status) {
          customerHealth.no_status += 1;
          continue;
        }
        if (status === "awaiting_payment") customerHealth.awaiting_payment += 1;
        if (status === "canceling") customerHealth.canceling += 1;
        if (status === "paid_late") customerHealth.paid_late += 1;
        if (status === "paid_on_time") customerHealth.paid_on_time += 1;
      }

      const staleOpenLeads = leads.filter((row) => {
        if (row.lead_state !== "open") return false;
        const createdAtMs = Date.parse(row.created_at);
        if (Number.isNaN(createdAtMs)) return false;
        return Date.now() - createdAtMs >= 48 * 60 * 60 * 1000;
      }).length;

      const needsAttention = [
        ...(queueSummary.failed > 0
          ? [{
            key: "failed_jobs",
            level: "high",
            title: "Failed async jobs",
            count: queueSummary.failed,
            route: "/super-admin/sales-leads",
          }]
          : []),
        ...(queueSummary.queued >= 15
          ? [{
            key: "queue_backlog",
            level: "medium",
            title: "Async queue backlog",
            count: queueSummary.queued,
            route: "/internal",
          }]
          : []),
        ...(staleOpenLeads > 0
          ? [{
            key: "stale_open_leads",
            level: "medium",
            title: "Open leads older than 48h",
            count: staleOpenLeads,
            route: "/super-admin/sales-leads",
          }]
          : []),
        ...(customerHealth.awaiting_payment + customerHealth.canceling > 0
          ? [{
            key: "customer_billing_risk",
            level: "high",
            title: "Customers requiring billing attention",
            count: customerHealth.awaiting_payment + customerHealth.canceling,
            route: "/super-admin/customers",
          }]
          : []),
      ];

      let statusProbeMs: number | null = null;
      try {
        const { data: statusData } = await adminClient.functions.invoke(
          "system-status",
        );
        if (statusData && typeof statusData === "object") {
          const durationMs =
            (statusData as Record<string, unknown>).duration_ms;
          if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
            statusProbeMs = durationMs;
          }
        }
      } catch (statusProbeError) {
        console.warn("super-ops status probe failed", statusProbeError);
      }

      const searchIndex = [
        {
          id: "cmd_internal_home",
          label: "Internal dashboard",
          type: "page",
          route: "/internal",
        },
        {
          id: "cmd_super_home",
          label: "Super admin home",
          type: "page",
          route: "/super-admin",
        },
        {
          id: "cmd_sales_leads",
          label: "Sales leads",
          type: "page",
          route: "/super-admin/sales-leads",
        },
        {
          id: "cmd_customers",
          label: "Customers",
          type: "page",
          route: "/super-admin/customers",
        },
        ...allTenants.slice(0, 40).map((tenant) => ({
          id: `tenant_${tenant.id}`,
          label: tenant.name,
          type: "tenant",
          route: "/super-admin/tenants",
        })),
      ];

      const runtimeConfig = Object.fromEntries(
        (runtimeConfigResult.data ?? []).map((item) => [item.key, item.value]),
      );

      return jsonResponse(200, {
        data: {
          checked_at: nowIso,
          traffic: {
            checkout_15m: checkout15m,
            return_15m: return15m,
            active_tenants_15m: activeTenants15m,
            events_24h: recentLogs.length,
          },
          queue: queueSummary,
          leads: leadSummary,
          lead_funnel: leadFunnel,
          traffic_by_hour: Array.from(trafficByHourMap.values()),
          sla: {
            median_latency_ms: medianDuration ?? statusProbeMs,
            p95_latency_ms: p95Duration ?? statusProbeMs,
            error_rate_percent: queueTotal > 0
              ? Number(((queueSummary.failed / queueTotal) * 100).toFixed(2))
              : 0,
            probe_latency_ms: statusProbeMs,
          },
          needs_attention: needsAttention,
          customer_health: customerHealth,
          recent_audit: auditRows.slice(0, 25).map((row) => ({
            id: row.id,
            actor_email: row.actor_email,
            action_type: row.action_type,
            target_type: row.target_type,
            target_id: row.target_id,
            created_at: row.created_at,
          })),
          search_index: searchIndex,
          runtime: runtimeConfig,
          recent_events: recentEvents,
        },
      });
    }

    // ── Subprocessor notice: preview ────────────────────────────────────────────
    if (action === "preview_subprocessor_notice") {
      const body = asRecord(await readJsonBody(req));
      const vendor = requireText(body, "vendor", 256);
      const rawChangeType = requireText(body, "change_type", 32);
      if (!["added", "replaced", "removed"].includes(rawChangeType)) {
        throw new ValidationError(400, "change_type must be 'added', 'replaced', or 'removed'");
      }
      const changeType = rawChangeType as SubprocessorChangeType;
      const effectiveDate = requireText(body, "effective_date", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        throw new ValidationError(400, "effective_date must be YYYY-MM-DD");
      }
      const thirtyDaysOut = new Date();
      thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
      if (new Date(effectiveDate) < thirtyDaysOut) {
        throw new ValidationError(400, "effective_date must be at least 30 days from today");
      }
      const description = optionalText(body, "description", 2048) ?? undefined;

      const { count: districtCount } = await adminClient
        .from("districts")
        .select("billing_email", { count: "exact", head: true })
        .eq("billing_status", "active")
        .not("billing_email", "is", null);

      const { count: leadCount } = await adminClient
        .from("sales_leads")
        .select("reply_email", { count: "exact", head: true })
        .eq("lead_state", "converted_to_customer")
        .not("reply_email", "is", null);

      const logoUrl = Deno.env.get("ITX_EMAIL_LOGO_URL")?.trim() || null;
      const legalHubUrl = Deno.env.get("ITX_LEGAL_HUB_URL")?.trim() || "https://www.itemtraxx.com/legal";
      const contactSupportUrl = Deno.env.get("ITX_CONTACT_SUPPORT_URL")?.trim() || "https://www.itemtraxx.com/contact-support";

      const preview = formatSubprocessorPreview(
        { vendor, changeType, effectiveDate, description, logoUrl, legalHubUrl, contactSupportUrl },
        (districtCount ?? 0) + (leadCount ?? 0),
      );

      return jsonResponse(200, { preview });
    }

    // ── Subprocessor notice: announce (sends emails + creates DB record) ─────────
    if (action === "announce_subprocessor_change") {
      const body = asRecord(await readJsonBody(req));
      const vendor = requireText(body, "vendor", 256);
      const rawChangeType = requireText(body, "change_type", 32);
      if (!["added", "replaced", "removed"].includes(rawChangeType)) {
        throw new ValidationError(400, "change_type must be 'added', 'replaced', or 'removed'");
      }
      const changeType = rawChangeType as SubprocessorChangeType;
      const effectiveDate = requireText(body, "effective_date", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        throw new ValidationError(400, "effective_date must be YYYY-MM-DD");
      }
      const thirtyDaysOut = new Date();
      thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
      if (new Date(effectiveDate) < thirtyDaysOut) {
        throw new ValidationError(400, "effective_date must be at least 30 days from today");
      }
      const description = optionalText(body, "description", 2048) ?? undefined;

      const resendApiKey = Deno.env.get("ITX_RESEND_API_KEY");
      if (!resendApiKey) {
        return jsonResponse(503, { error: "Email service not configured." });
      }
      const emailFrom = Deno.env.get("ITX_EMAIL_FROM") ?? "ItemTraxx <noreply@itemtraxx.com>";
      const logoUrl = Deno.env.get("ITX_EMAIL_LOGO_URL")?.trim() || null;
      const legalHubUrl = Deno.env.get("ITX_LEGAL_HUB_URL")?.trim() || "https://www.itemtraxx.com/legal";
      const contactSupportUrl = Deno.env.get("ITX_CONTACT_SUPPORT_URL")?.trim() || "https://www.itemtraxx.com/contact-support";

      // Collect customer emails from active districts and converted leads.
      const { data: districtRows } = await adminClient
        .from("districts")
        .select("billing_email")
        .eq("billing_status", "active")
        .not("billing_email", "is", null);

      const { data: leadRows } = await adminClient
        .from("sales_leads")
        .select("reply_email")
        .eq("lead_state", "converted_to_customer")
        .not("reply_email", "is", null);

      const emailSet = new Set<string>();
      for (const row of districtRows ?? []) {
        if (typeof row.billing_email === "string") emailSet.add(row.billing_email.toLowerCase());
      }
      for (const row of leadRows ?? []) {
        if (typeof row.reply_email === "string") emailSet.add(row.reply_email.toLowerCase());
      }
      const recipients = Array.from(emailSet);

      // Create record in pending state before sending.
      const { data: changeRecord, error: insertError } = await adminClient
        .from("subprocessor_changes")
        .insert({
          vendor,
          change_type: changeType,
          effective_date: effectiveDate,
          description: description ?? null,
          status: "pending",
          created_by_email: profile.auth_email ?? user.email ?? null,
        })
        .select("id")
        .single();

      if (insertError || !changeRecord) {
        return jsonResponse(500, { error: "Failed to create subprocessor change record." });
      }
      const changeId: string = changeRecord.id;

      const noticePayload = { vendor, changeType, effectiveDate, description, logoUrl, legalHubUrl, contactSupportUrl };
      const subject = buildSubprocessorEmailSubject(vendor, changeType);
      const html = buildSubprocessorNoticeHtml(noticePayload);
      const text = buildSubprocessorNoticePlainText(noticePayload);

      let sentCount = 0;
      const emailResults = await Promise.allSettled(
        recipients.map((recipientEmail) =>
          sendLoggedResendEmail(
            adminClient,
            resendApiKey,
            { from: emailFrom, to: [recipientEmail], subject, html, text },
            {
              emailType: "subprocessor_change_notice",
              recipientEmail,
              subject,
              provider: "resend",
              requestContext: "super-ops/announce_subprocessor_change",
              triggeredByUserId: user.id,
              tenantId: null,
              districtId: null,
              metadata: { changeId, vendor, changeType, effectiveDate },
            },
          )
        ),
      );

      for (const result of emailResults) {
        if (result.status === "fulfilled") sentCount++;
      }

      const noticeSentAt = new Date().toISOString();
      await adminClient
        .from("subprocessor_changes")
        .update({
          status: recipients.length === 0 || sentCount > 0 ? "sent" : "failed",
          notice_sent_at: noticeSentAt,
          objection_deadline: effectiveDate,
          recipients_count: sentCount,
        })
        .eq("id", changeId);

      await writeAudit("announce_subprocessor_change", "subprocessor_change", changeId, {
        vendor,
        changeType,
        effectiveDate,
        recipientsCount: sentCount,
      });

      return jsonResponse(200, {
        changeId,
        vendor,
        changeType,
        effectiveDate,
        objectionDeadline: effectiveDate,
        noticeSentAt,
        recipientsCount: sentCount,
        totalTargets: recipients.length,
      });
    }

    // ── Subprocessor notice: list ────────────────────────────────────────────────
    if (action === "list_subprocessor_notices") {
      const { data: notices, error: listError } = await adminClient
        .from("subprocessor_changes")
        .select("id,vendor,change_type,effective_date,description,notice_sent_at,objection_deadline,recipients_count,status,created_by_email,created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (listError) {
        if (listError.code === "42P01") {
          return jsonResponse(503, { error: "Subprocessor changes table not found. Run latest SQL setup." });
        }
        return jsonResponse(500, { error: "Failed to fetch subprocessor notices." });
      }

      return jsonResponse(200, { notices: notices ?? [] });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("super-ops function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
