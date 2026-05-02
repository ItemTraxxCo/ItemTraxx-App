type RpcError = {
  code?: string;
  message?: string;
};

type SupabaseLikeClient = {
  from: (table: string) => any;
};

const isMissingRelation = (error: RpcError | null | undefined, relation: string) =>
  !!error &&
  error.code === "42P01" &&
  (error.message ?? "").toLowerCase().includes(relation.toLowerCase());

const isMissingColumn = (error: RpcError | null | undefined, column: string) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes(column.toLowerCase());

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
};

const parseJwtPayload = (authToken: string): Record<string, unknown> | null => {
  try {
    const payload = authToken.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(decodeBase64Url(payload));
    return decoded && typeof decoded === "object" ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const resolveTenantAdminAuthSessionBinding = (authToken: string) => {
  const payload = parseJwtPayload(authToken);
  const sessionId = typeof payload?.session_id === "string" ? payload.session_id.trim() : "";
  const issuedAt = typeof payload?.iat === "number" && Number.isFinite(payload.iat)
    ? new Date(payload.iat * 1000).toISOString()
    : null;

  return {
    sessionId: sessionId || null,
    issuedAt,
  };
};

export const isTenantAdminTokenBlockedBySessionRevocation = async (
  client: SupabaseLikeClient,
  params: {
    tenantId: string;
    profileId: string;
    authToken: string;
  }
) => {
  const binding = resolveTenantAdminAuthSessionBinding(params.authToken);
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
        return { blocked: false as const, relationMissing: true as const };
      }
      if (isMissingColumn(error as RpcError, "auth_session_id")) {
        return { blocked: false as const, relationMissing: true as const };
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
        return { blocked: false as const, relationMissing: true as const };
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
  }
) => {
  if (!params.deviceId) {
    return { valid: false as const, reason: "missing_device" as const, relationMissing: false as const };
  }

  const { data: activeSession, error: activeSessionError } = await client
    .from("tenant_admin_sessions")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("profile_id", params.profileId)
    .eq("device_id", params.deviceId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (activeSessionError) {
    if (isMissingRelation(activeSessionError as RpcError, "tenant_admin_sessions")) {
      return { valid: false as const, reason: "missing_table" as const, relationMissing: true as const };
    }
    throw new Error("Unable to validate admin session.");
  }

  if (activeSession?.id) {
    return { valid: true as const, reason: "active" as const, relationMissing: false as const };
  }

  const tokenBlock = await isTenantAdminTokenBlockedBySessionRevocation(client, params);
  if (tokenBlock.relationMissing) {
    return { valid: false as const, reason: "missing_table" as const, relationMissing: true as const };
  }
  if (tokenBlock.blocked) {
    return { valid: false as const, reason: "revoked_token" as const, relationMissing: false as const };
  }

  return { valid: false as const, reason: "missing_session" as const, relationMissing: false as const };
};
