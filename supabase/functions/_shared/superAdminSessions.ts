import {
  isMissingPostgrestColumn as isMissingColumn,
  isMissingPostgrestRelation as isMissingRelation,
  type PostgrestErrorLike,
} from "./postgrestErrors.ts";

type SupabaseLikeClient = {
  auth: {
    getClaims: (token: string) => Promise<{
      data: { claims: Record<string, unknown> } | null;
      error: unknown | null;
    }>;
  };
  from: (table: string) => any;
};

export const resolveSuperAdminAuthSessionBinding = async (
  client: SupabaseLikeClient,
  authToken: string,
) => {
  const { data, error } = await client.auth.getClaims(authToken);
  if (error || !data?.claims) {
    return { sessionId: null, issuedAt: null };
  }

  const claims = data.claims;
  const sessionId = typeof claims.session_id === "string"
    ? claims.session_id.trim()
    : "";
  const issuedAt =
    typeof claims.iat === "number" && Number.isFinite(claims.iat)
      ? new Date(claims.iat * 1000).toISOString()
      : null;

  return { sessionId: sessionId || null, issuedAt };
};

/**
 * A revoked row must block the matching Supabase Auth session before any
 * super-admin operation runs. This keeps revocation effective even while an
 * already-issued JWT remains within its normal lifetime.
 */
export const isSuperAdminTokenBlockedBySessionRevocation = async (
  client: SupabaseLikeClient,
  params: { profileId: string; authToken: string },
) => {
  const binding = await resolveSuperAdminAuthSessionBinding(
    client,
    params.authToken,
  );
  if (!binding.sessionId && !binding.issuedAt) {
    return { blocked: true as const, relationMissing: false as const };
  }

  if (binding.sessionId) {
    const { data, error } = await client
      .from("super_admin_sessions")
      .select("id")
      .eq("profile_id", params.profileId)
      .eq("auth_session_id", binding.sessionId)
      .not("revoked_at", "is", null)
      .order("revoked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (
        isMissingRelation(error as PostgrestErrorLike, "super_admin_sessions") ||
        isMissingColumn(error as PostgrestErrorLike, "auth_session_id")
      ) {
        return { blocked: true as const, relationMissing: true as const };
      }
      throw new Error("Unable to validate super-admin session revocation.");
    }
    if (data?.id) {
      return { blocked: true as const, relationMissing: false as const };
    }
  }

  if (binding.issuedAt) {
    const { data, error } = await client
      .from("super_admin_sessions")
      .select("id")
      .eq("profile_id", params.profileId)
      .not("revoked_at", "is", null)
      .gte("revoked_at", binding.issuedAt)
      .order("revoked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error as PostgrestErrorLike, "super_admin_sessions")) {
        return { blocked: true as const, relationMissing: true as const };
      }
      throw new Error("Unable to validate super-admin session revocation.");
    }
    return { blocked: !!data?.id, relationMissing: false as const };
  }

  return { blocked: false as const, relationMissing: false as const };
};
