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

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
};

const resolveJwtIssuedAt = (authToken: string) => {
  try {
    const payload = authToken.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(decodeBase64Url(payload)) as { iat?: unknown };
    return typeof decoded.iat === "number" && Number.isFinite(decoded.iat)
      ? new Date(decoded.iat * 1000).toISOString()
      : null;
  } catch {
    return null;
  }
};

export const isTenantAdminTokenBlockedBySessionRevocation = async (
  client: SupabaseLikeClient,
  params: {
    tenantId: string;
    profileId: string;
    authToken: string;
  }
) => {
  const issuedAt = resolveJwtIssuedAt(params.authToken);
  if (!issuedAt) {
    return { blocked: true as const, relationMissing: false as const };
  }

  const { data, error } = await client
    .from("tenant_admin_sessions")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("profile_id", params.profileId)
    .not("revoked_at", "is", null)
    .gte("revoked_at", issuedAt)
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
