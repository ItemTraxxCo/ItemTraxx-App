import {
  isMissingPostgrestColumn as isMissingColumn,
  isMissingPostgrestRelation as isMissingRelation,
  type PostgrestErrorLike,
} from "./postgrestErrors.ts";
import { verifyExternalAuthClaims } from "./externalAuth.ts";
import { hasFreshAdminStepUpAuthMethod } from "./privilegedStepUp.ts";

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
    return { sessionId: null, claims: null };
  }

  const sessionId = typeof claims.session_id === "string"
    ? claims.session_id.trim()
    : "";

  return { sessionId: sessionId || null, claims };
};

/**
 * A privileged JWT needs an active super-admin session-registry row. The
 * initial touch_session action may create that row for a freshly authenticated
 * Better Auth session; other unregistered sessions fail closed.
 */
export const isSuperAdminTokenBlockedBySessionRevocation = async (
  client: SupabaseLikeClient,
  params: {
    profileId: string;
    authToken: string;
    allowUnregisteredSession?: boolean;
  },
) => {
  const binding = await resolveSuperAdminAuthSessionBinding(
    client,
    params.authToken,
  );
  if (!binding.sessionId) {
    return { blocked: true as const, relationMissing: false as const };
  }

  const activeSession = await client
    .from("super_admin_sessions")
    .select("id")
    .eq("profile_id", params.profileId)
    .eq("auth_session_id", binding.sessionId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (activeSession.error) {
    if (
      isMissingRelation(activeSession.error as PostgrestErrorLike, "super_admin_sessions") ||
      isMissingColumn(activeSession.error as PostgrestErrorLike, "auth_session_id")
    ) {
      return { blocked: true as const, relationMissing: true as const };
    }
    throw new Error("Unable to validate super-admin session revocation.");
  }

  if (activeSession.data?.id) {
    return { blocked: false as const, relationMissing: false as const };
  }

  // A freshly authenticated session must be allowed to create its first
  // registry row through touch_session. A revoked row for this exact auth
  // session still blocks it, and an old unregistered session cannot bootstrap.
  if (
    params.allowUnregisteredSession && binding.claims &&
    hasFreshAdminStepUpAuthMethod(binding.claims)
  ) {
    const revokedSession = await client
      .from("super_admin_sessions")
      .select("id")
      .eq("profile_id", params.profileId)
      .eq("auth_session_id", binding.sessionId)
      .not("revoked_at", "is", null)
      .limit(1)
      .maybeSingle();

    if (revokedSession.error) {
      if (
        isMissingRelation(revokedSession.error as PostgrestErrorLike, "super_admin_sessions") ||
        isMissingColumn(revokedSession.error as PostgrestErrorLike, "auth_session_id")
      ) {
        return { blocked: true as const, relationMissing: true as const };
      }
      throw new Error("Unable to validate super-admin session revocation.");
    }

    return {
      blocked: !!revokedSession.data?.id,
      relationMissing: false as const,
    };
  }

  // Current Better Auth JWTs always carry a session id. Missing registry state
  // is otherwise rejected, including for existing sessions that never completed
  // the privileged sign-in bootstrap.
  return { blocked: true as const, relationMissing: false as const };
};
