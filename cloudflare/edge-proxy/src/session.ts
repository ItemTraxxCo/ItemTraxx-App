import { isAllowedOrigin, resolveRequestOrigin } from "./cors.ts";
import {
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

const REFRESH_GRANT_TYPE = "refresh_token";

type SessionSummary = {
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
    last_sign_in_at: string | null;
  } | null;
  profile: {
    role: string | null;
    tenant_id: string | null;
    district_id: string | null;
    auth_email: string | null;
    is_active: boolean | null;
  } | null;
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
  tenant_id: string | null;
  district_id: string | null;
  auth_email: string | null;
  is_active: boolean | null;
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
    "id,role,tenant_id,district_id,auth_email,is_active",
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

const buildSessionSummary = async (
  env: Env,
  accessToken: string,
): Promise<SessionSummary | null> => {
  const user = await fetchAuthUser(env, accessToken);
  if (!user) return null;
  const profile = await fetchProfile(env, accessToken, user.id);
  return {
    authenticated: true,
    user,
    profile: profile
      ? {
        role: profile.role ?? null,
        tenant_id: profile.tenant_id ?? null,
        district_id: profile.district_id ?? null,
        auth_email: profile.auth_email ?? null,
        is_active: profile.is_active ?? null,
      }
      : null,
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
  if (!response.ok) return { status: "unauthorized" };
  const payload = (await response.json()) as TokenRefreshResponse;
  if (!payload.access_token || !payload.refresh_token) {
    return { status: "unauthorized" };
  }
  return {
    status: "ok",
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  };
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
    clearSessionCookies(headers, env);
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

  const payload =
    (await request.json().catch(() => ({}))) as SessionExchangePayload;
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
    clearSessionCookies(responseHeaders, env);
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
    clearSessionCookies(responseHeaders, env);
    return buildError(401, "Unauthorized", headers, requestId, responseHeaders);
  }
  const summary = await buildSessionSummary(env, refreshed.accessToken);
  if (!summary) {
    const responseHeaders = new Headers();
    clearSessionCookies(responseHeaders, env);
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
    return buildJson(200, unauthenticatedSummary, headers, requestId);
  }
  const summary = await buildSessionSummary(env, accessToken);
  if (!summary) {
    const clearHeaders = responseHeaders ?? new Headers();
    clearSessionCookies(clearHeaders, env);
    return buildJson(
      200,
      unauthenticatedSummary,
      headers,
      requestId,
      clearHeaders,
    );
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
  if (cookies.accessToken) {
    await fetch(buildSupabaseUrl(env, "/auth/v1/logout"), {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cookies.accessToken}`,
        "Content-Type": "application/json",
      },
    }).catch(() => undefined);
  }
  const responseHeaders = new Headers();
  clearSessionCookies(responseHeaders, env);
  return buildJson(200, { ok: true }, headers, requestId, responseHeaders);
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
