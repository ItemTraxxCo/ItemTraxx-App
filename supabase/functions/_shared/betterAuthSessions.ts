import type { PostgrestErrorLike } from "./postgrestErrors.ts";
import type { SupabaseClient } from "../admin-ops/context.ts";

type BetterAuthSessionRow = {
  id: string;
  expiresAt: string | Date | null;
};

type BetterAuthSessionResult = {
  active: boolean;
  relationMissing: boolean;
};

type ActiveSessionIdsResult = {
  sessionIds: Set<string>;
  relationMissing: boolean;
};

const isMissingBetterAuthSessionRelation = (
  error: PostgrestErrorLike | null | undefined,
) =>
  error?.code === "42P01" &&
  ((error.message ?? "").toLowerCase().includes("better_auth") ||
    (error.message ?? "").toLowerCase().includes("session"));

const isLiveSession = (row: BetterAuthSessionRow | null | undefined) => {
  if (!row?.id || !row.expiresAt) return false;
  const expiresAt = new Date(row.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

/**
 * Better Auth owns session validity. The public account_sessions table is only
 * a display/revocation overlay, so every privileged request must still find
 * its session in Better Auth and verify that it belongs to the mapped user.
 */
export const isBetterAuthSessionActive = async (
  client: SupabaseClient,
  betterAuthUserId: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<BetterAuthSessionResult> => {
  if (!betterAuthUserId || !sessionId) {
    return { active: false, relationMissing: false };
  }

  const { data, error } = await client
    .schema("better_auth")
    .from("session")
    .select('id, "expiresAt"')
    .eq("id", sessionId)
    .eq("userId", betterAuthUserId)
    .maybeSingle();

  if (error) {
    if (isMissingBetterAuthSessionRelation(error as PostgrestErrorLike)) {
      return { active: false, relationMissing: true };
    }
    throw new Error("Unable to validate Better Auth session.");
  }

  return {
    active: isLiveSession(data as BetterAuthSessionRow | null),
    relationMissing: false,
  };
};

/** Return only live Better Auth sessions for the mapped user. */
export const listActiveBetterAuthSessionIds = async (
  client: SupabaseClient,
  betterAuthUserId: string | null | undefined,
  sessionIds: string[],
): Promise<ActiveSessionIdsResult> => {
  if (!betterAuthUserId || sessionIds.length === 0) {
    return { sessionIds: new Set<string>(), relationMissing: false };
  }

  const { data, error } = await client
    .schema("better_auth")
    .from("session")
    .select('id, "expiresAt"')
    .eq("userId", betterAuthUserId)
    .in("id", sessionIds)
    .gt("expiresAt", new Date().toISOString());

  if (error) {
    if (isMissingBetterAuthSessionRelation(error as PostgrestErrorLike)) {
      return { sessionIds: new Set<string>(), relationMissing: true };
    }
    throw new Error("Unable to load Better Auth sessions.");
  }

  return {
    sessionIds: new Set(
      (data as BetterAuthSessionRow[] | null | undefined ?? [])
        .filter((row) => isLiveSession(row))
        .map((row) => row.id),
    ),
    relationMissing: false,
  };
};
