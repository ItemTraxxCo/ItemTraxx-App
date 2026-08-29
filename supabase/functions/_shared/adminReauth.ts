// Server-side enforcement of the Workspace Admin re-authentication window.
//
// The product presents /login as a verification step before admin
// functions become available, and the SPA enforces a 15-minute freshness
// window on it (src/router/index.ts hasFreshAdminVerification, fed by
// authState.adminVerifiedAt <- session summary password_authenticated_at).
// Until now that window existed only in the browser: the admin edge functions
// checked role and device session but never how recently the caller actually
// authenticated, so the gate could be skipped by calling the API directly.
//
// This module re-derives the same fact the client is already relying on --
// "when did this session last complete an interactive authentication?" -- from
// the verified JWT, so the control holds on the server too.
//
// Deliberately NOT applied to: session lifecycle actions (touch/validate/list/
// revoke), which the app polls continuously and which must keep working for a
// user to sign themselves out, and checkoutReturn, which is the daily-driver
// workflow for both roles.

type ClaimsClient = {
  auth: {
    getClaims: (token: string) => Promise<{
      data: { claims: Record<string, unknown> } | null;
      error: unknown | null;
    }>;
  };
};

export const ADMIN_REAUTH_MAX_AGE_MS = 15 * 60 * 1000;

// Small tolerance for clock skew between the auth server and this runtime, so a
// token minted moments ago is never treated as issued in the future.
const CLOCK_SKEW_TOLERANCE_MS = 30 * 1000;

/**
 * Most recent `amr` (authentication methods reference) timestamp in the token.
 *
 * Any interactive method counts -- password, magic link, OTP, passkey -- because
 * the control is "the human re-authenticated recently", not "the human used a
 * password". Restricting this to `password` would lock out any future
 * magic-link or passkey admin sign-in. Token refresh does not add `amr`
 * entries, so this does not drift with session age.
 */
export const readLatestAuthTimestampMs = (
  claims: Record<string, unknown>,
): number | null => {
  const amr = claims.amr;
  if (!Array.isArray(amr)) return null;

  let latest: number | null = null;
  for (const entry of amr) {
    if (!entry || typeof entry !== "object") continue;
    const timestamp = (entry as { timestamp?: unknown }).timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    if (timestamp <= 0) continue;
    const timestampMs = timestamp * 1000;
    if (latest === null || timestampMs > latest) latest = timestampMs;
  }
  return latest;
};

export type AdminReauthResult =
  | { fresh: true }
  | { fresh: false; reason: "unverified" | "no_auth_timestamp" | "stale" };

/**
 * Fails closed: an unverifiable token, or one carrying no usable authentication
 * timestamp, is treated as not re-authenticated.
 */
export const checkRecentAdminAuth = async (
  authClient: ClaimsClient,
  authToken: string,
  maxAgeMs: number = ADMIN_REAUTH_MAX_AGE_MS,
): Promise<AdminReauthResult> => {
  const { data, error } = await authClient.auth.getClaims(authToken);
  if (error || !data?.claims) {
    return { fresh: false, reason: "unverified" };
  }

  const authenticatedAtMs = readLatestAuthTimestampMs(data.claims);
  if (authenticatedAtMs === null) {
    return { fresh: false, reason: "no_auth_timestamp" };
  }

  const ageMs = Date.now() - authenticatedAtMs;
  if (ageMs > maxAgeMs || ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
    return { fresh: false, reason: "stale" };
  }
  return { fresh: true };
};

// Matches the guard contract the SPA already implements and the E2E suite
// already asserts: tests/e2e/admin-mutation-guards.spec.ts models
// `step_up_required` as 403 with exactly this message. Using 401 instead would
// trigger the token-refresh retry in src/services/edgeFunctionClient.ts:160,
// which cannot help -- a refreshed token carries the same amr timestamps.
const ADMIN_REAUTH_REQUIRED_STATUS = 403;
const ADMIN_REAUTH_REQUIRED_MESSAGE = "Admin verification required.";

/**
 * Returns a 403 response when the caller has not re-authenticated recently, or
 * null to continue.
 */
export const requireRecentAdminAuth = async (
  authClient: ClaimsClient,
  authToken: string,
  jsonResponse: (status: number, body: Record<string, unknown>) => Response,
  maxAgeMs: number = ADMIN_REAUTH_MAX_AGE_MS,
): Promise<Response | null> => {
  const result = await checkRecentAdminAuth(authClient, authToken, maxAgeMs);
  if (result.fresh) return null;
  return jsonResponse(ADMIN_REAUTH_REQUIRED_STATUS, {
    error: ADMIN_REAUTH_REQUIRED_MESSAGE,
  });
};
