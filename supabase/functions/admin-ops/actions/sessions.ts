import {
  isMissingPostgrestColumn as isMissingColumn,
  isMissingPostgrestRelation as isMissingRelation,
} from "../../_shared/postgrestErrors.ts";
import { resolveTrustedGeneralLocation as resolveGeneralLocation } from "../../_shared/requestMetadata.ts";
import { isTenantAdminTokenBlockedBySessionRevocation } from "../../_shared/tenantAdminSessions.ts";
import { optionalText } from "../../_shared/validation.ts";
import type {
  AdminOpsContext,
  DeviceSessionContext,
  RpcError,
  SupabaseClient,
} from "../context.ts";

export type SessionSecurityContext = Pick<
  AdminOpsContext,
  | "adminClient"
  | "tenantId"
  | "user"
  | "authToken"
  | "authSessionBinding"
  | "authTokenBindingKey"
  | "deviceSession"
  | "requestId"
>;

const formatRpcError = (error: RpcError | null | undefined) =>
  error
    ? `${error.code ?? "unknown"}: ${error.message ?? "Unknown error"}`
    : "Unknown error";

const sanitizeText = (value: unknown, maxLen: number) =>
  optionalText(value, { maxLen }) || null;

export const resolveDeviceSessionContext = (
  payload: Record<string, unknown>,
  req: Request,
): DeviceSessionContext => ({
  deviceId: sanitizeText(payload.device_id, 128),
  deviceLabel: sanitizeText(payload.device_label, 160),
  userAgent: sanitizeText(req.headers.get("user-agent"), 255),
  loginMethod: payload.login_method === "password" ||
      payload.login_method === "magic_link" ||
      payload.login_method === "session_handoff"
    ? payload.login_method
    : null,
  loginLocation: payload.login_location === "regular_login" ||
      payload.login_location === "admin_login"
    ? payload.login_location
    : null,
  generalLocation: resolveGeneralLocation(req),
});

const isMissingSessionTable = (error: RpcError | null | undefined) =>
  isMissingRelation(error, "tenant_admin_sessions");

const isMissingSessionMetadataColumn = (
  error: RpcError | null | undefined,
) =>
  isMissingColumn(error, "login_method") ||
  isMissingColumn(error, "login_location") ||
  isMissingColumn(error, "general_location");

const isMissingSessionAuthBindingColumn = (
  error: RpcError | null | undefined,
) =>
  isMissingColumn(error, "auth_session_id") ||
  isMissingColumn(error, "auth_token_hash") ||
  isMissingColumn(error, "auth_token_issued_at");

export const findActiveSession = async (context: SessionSecurityContext) => {
  if (!context.deviceSession.deviceId) {
    return {
      exists: false as const,
      relationMissing: false,
      revoked: false as const,
    };
  }
  const tokenBlock = await isTenantAdminTokenBlockedBySessionRevocation(
    context.adminClient,
    {
      tenantId: context.tenantId,
      profileId: context.user.id,
      authToken: context.authToken,
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
  const { data, error } = await context.adminClient
    .from("tenant_admin_sessions")
    .select("id, auth_session_id, auth_token_hash")
    .eq("tenant_id", context.tenantId)
    .eq("profile_id", context.user.id)
    .eq("device_id", context.deviceSession.deviceId)
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
    ((typeof data.auth_session_id === "string" &&
      data.auth_session_id.trim().length > 0 &&
      !!context.authSessionBinding.sessionId &&
      data.auth_session_id === context.authSessionBinding.sessionId) ||
      ((!data.auth_session_id ||
        (typeof data.auth_session_id === "string" &&
          data.auth_session_id.trim().length === 0)) &&
        typeof data.auth_token_hash === "string" &&
        data.auth_token_hash.trim() === context.authTokenBindingKey))
  ) {
    return {
      exists: true as const,
      relationMissing: false as const,
      revoked: false as const,
    };
  }

  const { data: revokedRow, error: revokedError } = await context.adminClient
    .from("tenant_admin_sessions")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("profile_id", context.user.id)
    .eq("device_id", context.deviceSession.deviceId)
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

export const touchCurrentSession = async (
  context: SessionSecurityContext,
) => {
  if (!context.deviceSession.deviceId) {
    return {
      ok: false as const,
      relationMissing: false as const,
      reason: "missing_device",
    };
  }
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await context.adminClient
    .from("tenant_admin_sessions")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("profile_id", context.user.id)
    .eq("device_id", context.deviceSession.deviceId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (existingError) {
    console.error("admin-ops touch_session existing lookup failed", {
      request_id: context.requestId,
      tenant_id: context.tenantId,
      profile_id: context.user.id,
      device_id: context.deviceSession.deviceId,
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
    context.adminClient,
    {
      tenantId: context.tenantId,
      profileId: context.user.id,
      authToken: context.authToken,
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

  const baseBinding = {
    auth_session_id: context.authSessionBinding.sessionId,
    auth_token_hash: context.authTokenBindingKey,
    auth_token_issued_at: context.authSessionBinding.issuedAt,
  };
  const optionalMetadata = {
    ...(context.deviceSession.loginMethod
      ? { login_method: context.deviceSession.loginMethod }
      : {}),
    ...(context.deviceSession.loginLocation
      ? { login_location: context.deviceSession.loginLocation }
      : {}),
    ...(context.deviceSession.generalLocation
      ? { general_location: context.deviceSession.generalLocation }
      : {}),
  };
  const shouldTryMetadata = !!context.deviceSession.loginMethod ||
    !!context.deviceSession.loginLocation ||
    !!context.deviceSession.generalLocation;

  if (existing?.id) {
    const baseUpdate = {
      last_seen_at: now,
      device_label: context.deviceSession.deviceLabel,
      user_agent: context.deviceSession.userAgent,
      ...baseBinding,
    };
    const { error: updateError } = await context.adminClient
      .from("tenant_admin_sessions")
      .update(
        shouldTryMetadata ? { ...baseUpdate, ...optionalMetadata } : baseUpdate,
      )
      .eq("id", existing.id);
    if (updateError) {
      console.error("admin-ops touch_session update failed", {
        request_id: context.requestId,
        session_id: existing.id,
        tenant_id: context.tenantId,
        profile_id: context.user.id,
        device_id: context.deviceSession.deviceId,
        error: updateError,
        used_metadata_update: shouldTryMetadata,
      });
      if (isMissingSessionAuthBindingColumn(updateError as RpcError)) {
        return {
          ok: false as const,
          relationMissing: true as const,
          reason: "missing_table",
        };
      }
      if (
        shouldTryMetadata &&
        isMissingSessionMetadataColumn(updateError as RpcError)
      ) {
        const { error: fallbackUpdateError } = await context.adminClient
          .from("tenant_admin_sessions")
          .update({
            last_seen_at: now,
            device_label: context.deviceSession.deviceLabel,
            user_agent: context.deviceSession.userAgent,
          })
          .eq("id", existing.id);
        if (fallbackUpdateError) {
          console.error("admin-ops touch_session fallback update failed", {
            request_id: context.requestId,
            session_id: existing.id,
            tenant_id: context.tenantId,
            profile_id: context.user.id,
            device_id: context.deviceSession.deviceId,
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
      tenant_id: context.tenantId,
      profile_id: context.user.id,
      device_id: context.deviceSession.deviceId,
      device_label: context.deviceSession.deviceLabel,
      user_agent: context.deviceSession.userAgent,
      ...baseBinding,
      created_at: now,
      last_seen_at: now,
    };
    const { error: insertError } = await context.adminClient
      .from("tenant_admin_sessions")
      .insert(
        shouldTryMetadata ? { ...baseInsert, ...optionalMetadata } : baseInsert,
      );
    if (insertError) {
      console.error("admin-ops touch_session insert failed", {
        request_id: context.requestId,
        tenant_id: context.tenantId,
        profile_id: context.user.id,
        device_id: context.deviceSession.deviceId,
        error: insertError,
        used_metadata_insert: shouldTryMetadata,
      });
      if (
        isMissingSessionTable(insertError as RpcError) ||
        isMissingSessionAuthBindingColumn(insertError as RpcError)
      ) {
        return {
          ok: false as const,
          relationMissing: true as const,
          reason: "missing_table",
        };
      }
      if (
        shouldTryMetadata &&
        isMissingSessionMetadataColumn(insertError as RpcError)
      ) {
        const { error: fallbackInsertError } = await context.adminClient
          .from("tenant_admin_sessions")
          .insert(baseInsert);
        if (fallbackInsertError) {
          console.error("admin-ops touch_session fallback insert failed", {
            request_id: context.requestId,
            tenant_id: context.tenantId,
            profile_id: context.user.id,
            device_id: context.deviceSession.deviceId,
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
  return { ok: true as const, relationMissing: false as const, reason: "ok" };
};

const sessionUnavailable = (context: AdminOpsContext, status: number) =>
  context.jsonResponse(status, {
    error: "Session controls unavailable. Run latest SQL setup.",
  });

export const handleSessionAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
  if (context.action === "touch_session") {
    const touch = await touchCurrentSession(context);
    if (touch.relationMissing) return sessionUnavailable(context, 503);
    if (!touch.ok) {
      return touch.reason === "revoked"
        ? context.jsonResponse(401, { error: "Session revoked" })
        : context.jsonResponse(400, { error: "Device session is required." });
    }
    return context.jsonResponse(200, { data: { ok: true } });
  }

  if (context.action === "validate_session") {
    if (!context.deviceSession.deviceId) {
      return context.jsonResponse(400, {
        error: "Device session is required.",
      });
    }
    const activeSession = await findActiveSession(context);
    if (activeSession.relationMissing) return sessionUnavailable(context, 503);
    if (!activeSession.exists) {
      return context.jsonResponse(200, { data: { valid: false } });
    }
    const touch = await touchCurrentSession(context);
    if (!touch.ok && !touch.relationMissing) {
      return context.jsonResponse(400, {
        error: "Unable to refresh admin session.",
      });
    }
    return context.jsonResponse(200, { data: { valid: true } });
  }

  if (context.action === "list_sessions") {
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
    } = await context.adminClient
      .from("tenant_admin_sessions")
      .select(
        "id, device_id, device_label, user_agent, login_method, login_location, general_location, created_at, last_seen_at",
      )
      .eq("tenant_id", context.tenantId)
      .eq("profile_id", context.user.id)
      .is("revoked_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(100);
    if (
      sessionQuery.error &&
      isMissingSessionMetadataColumn(sessionQuery.error as RpcError)
    ) {
      sessionQuery = await context.adminClient
        .from("tenant_admin_sessions")
        .select(
          "id, device_id, device_label, user_agent, created_at, last_seen_at",
        )
        .eq("tenant_id", context.tenantId)
        .eq("profile_id", context.user.id)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(100);
    }
    const { data, error } = sessionQuery;
    if (error) {
      return isMissingSessionTable(error as RpcError)
        ? sessionUnavailable(context, 400)
        : context.jsonResponse(400, {
          error: "Unable to load active devices.",
        });
    }
    const rows = data ?? [];
    const dedupedRows = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const dedupeKey = row.device_id || row.id;
      if (!dedupedRows.has(dedupeKey)) dedupedRows.set(dedupeKey, row);
    }
    return context.jsonResponse(200, {
      data: {
        sessions: Array.from(dedupedRows.values()).map((row) => ({
          ...row,
          login_method: row.login_method ?? null,
          login_location: row.login_location ?? null,
          general_location: row.general_location ?? null,
          is_current: !!context.deviceSession.deviceId &&
            row.device_id === context.deviceSession.deviceId,
        })),
      },
    });
  }

  if (context.action === "revoke_session") {
    const sessionId = sanitizeText(context.payload.session_id, 128);
    if (!sessionId) {
      return context.jsonResponse(400, { error: "Session id is required." });
    }
    const { data: revokedRows, error } = await context.adminClient
      .from("tenant_admin_sessions")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: context.user.id,
      })
      .eq("id", sessionId)
      .eq("tenant_id", context.tenantId)
      .eq("profile_id", context.user.id)
      .is("revoked_at", null)
      .select("id");
    if (error) {
      return isMissingSessionTable(error as RpcError)
        ? sessionUnavailable(context, 400)
        : context.jsonResponse(400, { error: "Unable to revoke session." });
    }
    if (!revokedRows?.length) {
      return context.jsonResponse(404, { error: "Session not found." });
    }
    return context.jsonResponse(200, { data: { revoked: true } });
  }

  if (context.action === "revoke_current_session") {
    let query = context.adminClient
      .from("tenant_admin_sessions")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: context.user.id,
      })
      .eq("tenant_id", context.tenantId)
      .eq("profile_id", context.user.id)
      .is("revoked_at", null);
    if (context.authSessionBinding.sessionId) {
      query = query.eq("auth_session_id", context.authSessionBinding.sessionId);
    } else if (context.deviceSession.deviceId) {
      query = query.eq("device_id", context.deviceSession.deviceId);
    } else {
      return context.jsonResponse(401, {
        error: "Session binding unavailable.",
      });
    }
    const { data, error } = await query.select("id");
    if (error) {
      return context.jsonResponse(400, { error: "Unable to revoke session." });
    }
    return context.jsonResponse(200, {
      data: { revoked: (data ?? []).length > 0 },
    });
  }

  const signOutCurrent = context.payload.sign_out_current === true;
  let query = context.adminClient
    .from("tenant_admin_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: context.user.id,
    })
    .eq("tenant_id", context.tenantId)
    .eq("profile_id", context.user.id)
    .is("revoked_at", null);
  if (!signOutCurrent && context.deviceSession.deviceId) {
    query = query.neq("device_id", context.deviceSession.deviceId);
  }
  const { data, error } = await query.select("id");
  if (error) {
    return isMissingSessionTable(error as RpcError)
      ? sessionUnavailable(context, 400)
      : context.jsonResponse(400, { error: "Unable to revoke sessions." });
  }
  return context.jsonResponse(200, { data: { revoked: (data ?? []).length } });
};
