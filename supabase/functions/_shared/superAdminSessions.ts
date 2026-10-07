import {
  isMissingPostgrestColumn as isMissingColumn,
  isMissingPostgrestRelation as isMissingRelation,
  type PostgrestErrorLike,
} from "./postgrestErrors.ts";
import { verifyExternalAuthClaims } from "./externalAuth.ts";

type SupabaseLikeClient = {
  from: (table: string) => any;
};

const resolveSuperAdminAuthSessionBinding = async (
  client: SupabaseLikeClient,
  authToken: string,
) => {
  const injectedVerifier = (client as SupabaseLikeClient & {
    verifyExternalAuthClaims?: (authorization: string) => Promise<Record<string, unknown> | null>;
  }).verifyExternalAuthClaims;
  const claims = await (injectedVerifier ?? verifyExternalAuthClaims)(`Bearer ${authToken}`);
  if (!claims) {
    return { sessionId: null, issuedAt: null };
  }

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
 * A privileged JWT is accepted only while its exact Better Auth session has
 * an active super-admin session-registry row. Missing registry state fails
 * closed, including during session creation and after revocation.
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
      .is("revoked_at", null)
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
    return { blocked: !data?.id, relationMissing: false as const };
  }

  // Current Better Auth JWTs always carry a session id. A legacy token without
  // that binding cannot be tied to an active registry row safely.
  return { blocked: true as const, relationMissing: false as const };
};
