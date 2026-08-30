import { isAllowedOrigin, resolveRequestOrigin } from "./cors.ts";
import {
  clearLegacySessionCookies,
  clearSessionCookies,
  parseCookies,
  type SessionCookies,
  setSessionCookies,
} from "./cookies.ts";
import {
  buildError,
  buildJson,
  buildSessionRateLimitError,
} from "./responses.ts";
import {
  readBoundedRequestBody,
  RequestBodyLimitError,
} from "./requestBody.ts";

const REFRESH_GRANT_TYPE = "refresh_token";
export const MAX_SESSION_EXCHANGE_BODY_BYTES = 32 * 1024;

type SessionSummary = {
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
    last_sign_in_at: string | null;
  } | null;
  profile: {
    role: string | null;
    workspace_id: string | null;
    auth_email: string | null;
    is_active: boolean | null;
  } | null;
  password_authenticated_at: string | null;
};

type SessionExchangePayload = {
  access_token?: string;
  refresh_token?: string;
};

type TokenRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
};

type ProfileRow = {
  id: string;
  role: string | null;
  workspace_id: string | null;
  auth_email: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const buildSupabaseUrl = (env: Env, path: string) =>
  `${trimTrailingSlash(env.SUPABASE_URL)}${path}`;

const fetchAuthUser = async (env: Env, accessToken: string) => {
  const response = await fetch(buildSupabaseUrl(env, "/auth/v1/user"), {
    method: "GET",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    id: string;
    email?: string | null;
    last_sign_in_at?: string | null;
  };
  if (!payload?.id) return null;
  return {
    id: payload.id,
    email: payload.email ?? null,
    last_sign_in_at: payload.last_sign_in_at ?? null,
  };
};

const fetchProfile = async (env: Env, accessToken: string, userId: string) => {
  const url = new URL(buildSupabaseUrl(env, "/rest/v1/profiles"));
  url.searchParams.set("id", `eq.${userId}`);
  url.searchParams.set(
    "select",
    "id,role,workspace_id,auth_email,is_active,deleted_at",
  );
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as ProfileRow[];
  return rows[0] ?? null;
};

type JwtSessionClaims = {
  session_id?: unknown;
  amr?: unknown;
};

const readJwtSessionClaims = (accessToken: string): JwtSessionClaims | null => {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    ) as JwtSessionClaims;
  } catch {
    return null;
  }
};

const readJwtSessionId = (accessToken: string) => {
  const sessionId = readJwtSessionClaims(accessToken)?.session_id;
  return typeof sessionId === "string" && sessionId.trim()
    ? sessionId.trim()
    : null;
};

const readPasswordAuthenticatedAt = (accessToken: string) => {
  const amr = readJwtSessionClaims(accessToken)?.amr;
  if (!Array.isArray(amr)) return null;
  const passwordEntry = amr.find((entry) =>
    !!entry && typeof entry === "object" &&
    (entry as { method?: unknown }).method === "password"
  ) as { timestamp?: unknown } | undefined;
  const timestamp = passwordEntry?.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  return new Date(timestamp * 1000).toISOString();
};

const hasActiveApplicationSession = async (
  env: Env,
  accessToken: string,
  profile: ProfileRow,
) => {
  // Super admins have no account_sessions row -- their device sessions live in
  // super_admin_sessions, which the `authenticated` role cannot read, so the
  // worker cannot consult it with the caller's own token. Refreshing is
  // therefore allowed here on role alone; revocation is enforced where it
  // grants access rather than where it mints a token:
  //   - RLS: every super_admin_* policy requires
  //     private.super_admin_session_not_revoked() and a live step-up
  //     (20260726120000_least_privilege_rest_surface.sql)
  //   - edge functions: isSuperAdminTokenBlockedBySessionRevocation() on every
  //     super-* entrypoint
  // A refreshed token for a revoked super admin therefore opens nothing.
  if (profile.role === "super_admin") return true;
  const sessionId = readJwtSessionId(accessToken);
  if (!sessionId) return false;
  const url = new URL(buildSupabaseUrl(env, "/rest/v1/account_sessions"));
  url.searchParams.set("profile_id", `eq.${profile.id}`);
  url.searchParams.set("auth_session_id", `eq.${sessionId}`);
  url.searchParams.set("revoked_at", "is.null");
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString(), {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return false;
  const rows = await response.json() as Array<{ id?: string }>;
  return !!rows[0]?.id;
};

const buildSessionSummary = async (
  env: Env,
  accessToken: string,
  requireActiveApplicationSession = false,
): Promise<SessionSummary | null> => {
  const user = await fetchAuthUser(env, accessToken);
  if (!user) return null;
  const profile = await fetchProfile(env, accessToken, user.id);
  if (
    profile && requireActiveApplicationSession &&
    !await hasActiveApplicationSession(env, accessToken, profile)
  ) return null;
  return {
    authenticated: true,
    user,
    profile: profile
      ? {
        role: profile.role ?? null,
        workspace_id: profile.workspace_id ?? null,
        auth_email: profile.auth_email ?? null,
        is_active: profile.is_active ?? null,
      }
      : null,
    password_authenticated_at: readPasswordAuthenticatedAt(accessToken),
  };
};

export type SessionRateLimitResult = "allowed" | "limited" | "unavailable";

export const checkSessionRateLimit = async (
  binding: RateLimit | undefined,
  request: Request,
): Promise<SessionRateLimitResult> => {
  const clientIp = request.headers.get("cf-connecting-ip")?.trim();
  if (!binding || !clientIp) return "unavailable";
  try {
    const result = await binding.limit({ key: clientIp });
    return result.success ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
};

export type RefreshSessionResult =
  | { status: "ok"; accessToken: string; refreshToken: string }
  | { status: "unauthorized" | "rate_limited" | "unavailable" };

const refreshSession = async (
  request: Request,
  env: Env,
  refreshToken: string,
): Promise<RefreshSessionResult> => {
  const rateLimit = await checkSessionRateLimit(
    env.SESSION_REFRESH_RATE_LIMITER,
    request,
  );
  if (rateLimit === "limited") return { status: "rate_limited" };
  if (rateLimit === "unavailable") return { status: "unavailable" };

  const response = await fetch(
    buildSupabaseUrl(env, `/auth/v1/token?grant_type=${REFRESH_GRANT_TYPE}`),
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );
  if (response.status >= 500) return { status: "unavailable" };
  if (response.status === 429) return { status: "rate_limited" };
  if (response.ok) {
    const payload = (await response.json()) as TokenRefreshResponse;
    if (!payload.access_token || !payload.refresh_token) {
      // A successful HTTP status with an unusable token payload is an
      // upstream protocol failure, not proof that the refresh token expired.
      // Treating it as unauthorized would let refresh-only logout claim
      // success without ever reaching the revocation endpoint.
      return { status: "unavailable" };
    }
    return {
      status: "ok",
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
    };
  }
  // Only the provider's normal invalid/expired-token responses are safe to
  // treat as an idempotent unauthorised session. Other non-2xx responses are
  // upstream failures and must not make logout claim success.
  return response.status === 400 || response.status === 401
    ? { status: "unauthorized" }
    : { status: "unavailable" };
};

export const maybeRefreshSession = async (
  request: Request,
  env: Env,
  cookies: SessionCookies,
): Promise<{
  session: { accessToken: string; refreshToken: string } | null;
  headers: Headers | null;
  failure: "rate_limited" | "unavailable" | null;
}> => {
  if (!cookies.refreshToken) {
    return { session: null, headers: null, failure: null };
  }

  const refreshed = await refreshSession(request, env, cookies.refreshToken);
  if (refreshed.status !== "ok") {
    if (
      refreshed.status === "rate_limited" || refreshed.status === "unavailable"
    ) {
      return { session: null, headers: null, failure: refreshed.status };
    }
    const headers = new Headers();
    clearSessionCookies(headers, env, cookies.legacyCookiePresent);
    return { session: null, headers, failure: null };
  }
  const headers = new Headers();
  setSessionCookies(headers, env, refreshed);
  return { session: refreshed, headers, failure: null };
};

const handleSessionExchange = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
) => {
  const rateLimit = await checkSessionRateLimit(
    env.SESSION_EXCHANGE_RATE_LIMITER,
    request,
  );
  if (rateLimit === "limited") {
    return buildSessionRateLimitError("rate_limited", headers, requestId);
  }
  if (rateLimit === "unavailable") {
    return buildSessionRateLimitError("unavailable", headers, requestId);
  }

  let payload: SessionExchangePayload;
  try {
    const body = await readBoundedRequestBody(
      request,
      MAX_SESSION_EXCHANGE_BODY_BYTES,
    );
    const parsed = JSON.parse(new TextDecoder().decode(body));
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SessionExchangePayload
      : {};
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      return buildError(error.status, error.message, headers, requestId);
    }
    payload = {};
  }
  if (!payload.access_token || !payload.refresh_token) {
    return buildError(400, "Invalid request", headers, requestId);
  }
  const summary = await buildSessionSummary(env, payload.access_token);
  if (!summary) return buildError(401, "Unauthorized", headers, requestId);

  const responseHeaders = new Headers();
  setSessionCookies(responseHeaders, env, {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  });
  return buildJson(200, summary, headers, requestId, responseHeaders);
};

const handleSessionRefresh = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
) => {
  const cookies = parseCookies(request);
  if (!cookies.refreshToken) {
    const responseHeaders = new Headers();
    clearSessionCookies(responseHeaders, env, cookies.legacyCookiePresent);
    return buildError(401, "Unauthorized", headers, requestId, responseHeaders);
  }
  const refreshed = await refreshSession(request, env, cookies.refreshToken);
  if (refreshed.status !== "ok") {
    if (
      refreshed.status === "rate_limited" || refreshed.status === "unavailable"
    ) {
      return buildSessionRateLimitError(refreshed.status, headers, requestId);
    }
    const responseHeaders = new Headers();
    clearSessionCookies(responseHeaders, env, cookies.legacyCookiePresent);
    return buildError(401, "Unauthorized", headers, requestId, responseHeaders);
  }
  const summary = await buildSessionSummary(env, refreshed.accessToken, true);
  if (!summary) {
    const responseHeaders = new Headers();
    clearSessionCookies(responseHeaders, env, cookies.legacyCookiePresent);
    return buildError(401, "Unauthorized", headers, requestId, responseHeaders);
  }
  const responseHeaders = new Headers();
  setSessionCookies(responseHeaders, env, refreshed);
  return buildJson(200, summary, headers, requestId, responseHeaders);
};

const unauthenticatedSummary = {
  authenticated: false,
  user: null,
  profile: null,
  password_authenticated_at: null,
};

const handleSessionMe = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
) => {
  const cookies = parseCookies(request);
  let accessToken = cookies.accessToken;
  let responseHeaders: Headers | null = null;
  if (!accessToken && cookies.refreshToken) {
    const refreshed = await maybeRefreshSession(request, env, cookies);
    if (refreshed.failure) {
      return buildSessionRateLimitError(refreshed.failure, headers, requestId);
    }
    if (refreshed.session) {
      accessToken = refreshed.session.accessToken;
      responseHeaders = refreshed.headers;
    } else if (refreshed.headers) {
      return buildJson(
        200,
        unauthenticatedSummary,
        headers,
        requestId,
        refreshed.headers,
      );
    }
  }
  if (!accessToken) {
    if (cookies.legacyCookiePresent) {
      const migrationHeaders = new Headers();
      clearLegacySessionCookies(migrationHeaders, env);
      return buildJson(
        200,
        unauthenticatedSummary,
        headers,
        requestId,
        migrationHeaders,
      );
    }
    return buildJson(200, unauthenticatedSummary, headers, requestId);
  }
  // No requireActiveApplicationSession here: a brand-new session (fresh
  // login, not yet touched on this device/origin) must not be treated the
  // same as a revoked one. Device/session revocation is enforced where it
  // actually matters (checkoutReturn, admin-ops) via validateAccountDeviceSession.
  const summary = await buildSessionSummary(env, accessToken);
  if (!summary) {
    const clearHeaders = responseHeaders ?? new Headers();
    clearSessionCookies(clearHeaders, env, cookies.legacyCookiePresent);
    return buildJson(
      200,
      unauthenticatedSummary,
      headers,
      requestId,
      clearHeaders,
    );
  }
  if (cookies.legacyCookiePresent) {
    const migrationHeaders = responseHeaders ?? new Headers();
    clearLegacySessionCookies(migrationHeaders, env);
    responseHeaders = migrationHeaders;
  }
  return buildJson(
    200,
    summary,
    headers,
    requestId,
    responseHeaders ?? undefined,
  );
};

const handleSessionLogout = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
) => {
  const cookies = parseCookies(request);
  const responseHeaders = new Headers();
  clearSessionCookies(responseHeaders, env, cookies.legacyCookiePresent);
  const success = () =>
    buildJson(200, { ok: true }, headers, requestId, responseHeaders);

  if (!cookies.accessToken && !cookies.refreshToken) return success();

  const requestLocalLogout = async (accessToken: string) => {
    try {
      const response = await fetch(
        buildSupabaseUrl(env, "/auth/v1/logout?scope=local"),
        {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (response.ok) return "revoked" as const;
      if (response.status === 401) {
        return "unauthorized" as const;
      }
      return "failed" as const;
    } catch {
      return "failed" as const;
    }
  };

  // Supabase's local logout endpoint accepts an access token, not a refresh
  // token. Try the access cookie first, then recover a short-lived access
  // token from a refresh-only session so that refresh-only browsers are also
  // revoked server-side.
  if (cookies.accessToken) {
    const logoutResult = await requestLocalLogout(cookies.accessToken);
    if (logoutResult === "revoked") return success();
    if (logoutResult === "failed") {
      return buildError(
        503,
        "Unable to complete logout",
        headers,
        requestId,
        responseHeaders,
      );
    }
    if (!cookies.refreshToken) return success();
  }

  let refreshed: RefreshSessionResult;
  try {
    refreshed = await refreshSession(request, env, cookies.refreshToken!);
  } catch {
    return buildError(
      503,
      "Unable to complete logout",
      headers,
      requestId,
      responseHeaders,
    );
  }
  if (refreshed.status !== "ok") {
    if (
      refreshed.status === "rate_limited" ||
      refreshed.status === "unavailable"
    ) {
      return buildSessionRateLimitError(
        refreshed.status,
        headers,
        requestId,
        responseHeaders,
      );
    }
    // An expired/invalid refresh token is already unable to mint a session.
    // The operation is therefore safely idempotent once browser cookies clear.
    return success();
  }

  const refreshedLogout = await requestLocalLogout(refreshed.accessToken);
  if (refreshedLogout === "revoked" || refreshedLogout === "unauthorized") {
    return success();
  }
  return buildError(
    503,
    "Unable to complete logout",
    headers,
    requestId,
    responseHeaders,
  );
};

const validateSessionMutationRequest = (
  request: Request,
  env: Env,
  allowedOrigins: string[],
  headers: Record<string, string>,
  requestId: string,
) => {
  const requestOrigin = resolveRequestOrigin(request);
  if (!requestOrigin || !isAllowedOrigin(requestOrigin, allowedOrigins, env)) {
    return buildError(403, "Origin not allowed", headers, requestId);
  }
  if (request.headers.get("x-itx-session-request") !== "1") {
    return buildError(400, "Invalid session request", headers, requestId);
  }
  return null;
};

export const handleSessionRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  action: string,
  allowedOrigins: string[],
) => {
  if (action === "exchange" && request.method === "POST") {
    const error = validateSessionMutationRequest(
      request,
      env,
      allowedOrigins,
      headers,
      requestId,
    );
    if (error) return error;
    return handleSessionExchange(request, env, headers, requestId);
  }
  if (action === "refresh" && request.method === "POST") {
    const error = validateSessionMutationRequest(
      request,
      env,
      allowedOrigins,
      headers,
      requestId,
    );
    if (error) return error;
    return handleSessionRefresh(request, env, headers, requestId);
  }
  if (action === "logout" && request.method === "POST") {
    const error = validateSessionMutationRequest(
      request,
      env,
      allowedOrigins,
      headers,
      requestId,
    );
    if (error) return error;
    return handleSessionLogout(request, env, headers, requestId);
  }
  if (action === "me" && request.method === "GET") {
    return handleSessionMe(request, env, headers, requestId);
  }
  return buildError(404, "Not found", headers, requestId);
};
