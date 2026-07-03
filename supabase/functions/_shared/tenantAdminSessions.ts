type RpcError = {
  code?: string;
  message?: string;
};

type SupabaseLikeClient = {
  auth: {
    getClaims: (token: string) => Promise<{
      data: { claims: Record<string, unknown> } | null;
      error: unknown | null;
    }>;
  };
  from: (table: string) => any;
};

const isMissingRelation = (
  error: RpcError | null | undefined,
  relation: string,
) =>
  !!error &&
  error.code === "42P01" &&
  (error.message ?? "").toLowerCase().includes(relation.toLowerCase());

const isMissingColumn = (error: RpcError | null | undefined, column: string) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes(column.toLowerCase());

const TENANT_ADMIN_SESSION_COLUMNS =
  "id, auth_session_id, auth_token_hash, auth_token_issued_at";

const sha256 = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const resolveTenantAdminAuthSessionBinding = async (
  client: SupabaseLikeClient,
  authToken: string,
) => {
  const { data, error } = await client.auth.getClaims(authToken);
  if (error || !data?.claims) {
    return { sessionId: null, issuedAt: null };
  }
  const payload = data.claims;
  const sessionId = typeof payload?.session_id === "string"
    ? payload.session_id.trim()
    : "";
  const issuedAt =
    typeof payload?.iat === "number" && Number.isFinite(payload.iat)
      ? new Date(payload.iat * 1000).toISOString()
      : null;

  return {
    sessionId: sessionId || null,
    issuedAt,
  };
};

const resolveTenantAdminAuthBindingKey = async (
  client: SupabaseLikeClient,
  authToken: string,
) => {
  const binding = await resolveTenantAdminAuthSessionBinding(client, authToken);
  if (binding.sessionId) {
    return {
      ...binding,
      bindingKey: `session:${binding.sessionId}`,
    };
  }

  return {
    ...binding,
    bindingKey: `token:${await sha256(authToken)}`,
  };
};

export const isTenantAdminTokenBlockedBySessionRevocation = async (
  client: SupabaseLikeClient,
  params: {
    tenantId: string;
    profileId: string;
    authToken: string;
  },
) => {
  const binding = await resolveTenantAdminAuthSessionBinding(
    client,
    params.authToken,
  );
  if (!binding.sessionId && !binding.issuedAt) {
    return { blocked: true as const, relationMissing: false as const };
  }

  if (binding.sessionId) {
    const { data, error } = await client
      .from("tenant_admin_sessions")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("profile_id", params.profileId)
      .eq("auth_session_id", binding.sessionId)
      .not("revoked_at", "is", null)
      .order("revoked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error as RpcError, "tenant_admin_sessions")) {
        return { blocked: true as const, relationMissing: true as const };
      }
      if (isMissingColumn(error as RpcError, "auth_session_id")) {
        return { blocked: true as const, relationMissing: true as const };
      }
      throw new Error("Unable to validate admin session revocation.");
    }

    if (data?.id) {
      return { blocked: true as const, relationMissing: false as const };
    }
  }

  if (binding.issuedAt) {
    const { data, error } = await client
      .from("tenant_admin_sessions")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("profile_id", params.profileId)
      .not("revoked_at", "is", null)
      .gte("revoked_at", binding.issuedAt)
      .order("revoked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error as RpcError, "tenant_admin_sessions")) {
        return { blocked: true as const, relationMissing: true as const };
      }
      throw new Error("Unable to validate admin session revocation.");
    }

    return { blocked: !!data?.id, relationMissing: false as const };
  }

  return { blocked: false as const, relationMissing: false as const };
};

export const validateTenantAdminDeviceSession = async (
  client: SupabaseLikeClient,
  params: {
    tenantId: string;
    profileId: string;
    deviceId: string | null;
    authToken: string;
  },
) => {
  if (!params.deviceId) {
    return {
      valid: false as const,
      reason: "missing_device" as const,
      relationMissing: false as const,
    };
  }

  const binding = await resolveTenantAdminAuthBindingKey(
    client,
    params.authToken,
  );
  if (!binding.issuedAt) {
    return {
      valid: false as const,
      reason: "revoked_token" as const,
      relationMissing: false as const,
    };
  }

  const tokenBlock = await isTenantAdminTokenBlockedBySessionRevocation(
    client,
    params,
  );
  if (tokenBlock.relationMissing) {
    return {
      valid: false as const,
      reason: "missing_table" as const,
      relationMissing: true as const,
    };
  }
  if (tokenBlock.blocked) {
    return {
      valid: false as const,
      reason: "revoked_token" as const,
      relationMissing: false as const,
    };
  }

  let activeSessionQuery = client
    .from("tenant_admin_sessions")
    .select(TENANT_ADMIN_SESSION_COLUMNS)
    .eq("tenant_id", params.tenantId)
    .eq("profile_id", params.profileId)
    .eq("device_id", params.deviceId)
    .is("revoked_at", null);

  if (binding.sessionId) {
    activeSessionQuery = activeSessionQuery.eq(
      "auth_session_id",
      binding.sessionId,
    );
  }

  const { data: activeSession, error: activeSessionError } =
    await activeSessionQuery
      .limit(1)
      .maybeSingle();

  if (activeSessionError) {
    if (
      isMissingRelation(activeSessionError as RpcError, "tenant_admin_sessions")
    ) {
      return {
        valid: false as const,
        reason: "missing_table" as const,
        relationMissing: true as const,
      };
    }
    if (isMissingColumn(activeSessionError as RpcError, "auth_session_id")) {
      return {
        valid: false as const,
        reason: "missing_table" as const,
        relationMissing: true as const,
      };
    }
    throw new Error("Unable to validate admin session.");
  }

  if (activeSession?.id) {
    const sessionAuthId = typeof activeSession.auth_session_id === "string"
      ? activeSession.auth_session_id.trim()
      : "";
    const sessionTokenHash = typeof activeSession.auth_token_hash === "string"
      ? activeSession.auth_token_hash.trim()
      : "";
    const sessionTokenIssuedAt = typeof activeSession.auth_token_issued_at === "string"
      ? activeSession.auth_token_issued_at
      : null;
    if (binding.sessionId) {
      return sessionAuthId === binding.sessionId
        ? {
          valid: true as const,
          reason: "active" as const,
          relationMissing: false as const,
        }
        : {
          valid: false as const,
          reason: "missing_session" as const,
          relationMissing: false as const,
        };
    }
    if (
      !sessionAuthId &&
      sessionTokenHash === binding.bindingKey &&
      sessionTokenIssuedAt === binding.issuedAt
    ) {
      return {
        valid: true as const,
        reason: "active" as const,
        relationMissing: false as const,
      };
    }
  }

  return {
    valid: false as const,
    reason: "missing_session" as const,
    relationMissing: false as const,
  };
};
