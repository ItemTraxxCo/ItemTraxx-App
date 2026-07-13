import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_KILL_SWITCH_MESSAGE,
} from "./constants.ts";
import {
  isAllowedOrigin,
  isLocalhostOrigin,
  parseCsv,
  resolveRequestOrigin,
  withCorsHeaders,
} from "./cors.ts";
import {
  applyMaintenanceFallbackToStatusPayload,
  readMaintenanceFallback,
} from "./maintenanceFallback.ts";
import {
  maybeReportWorkerResponse,
  reportWorkerException,
} from "./observability.ts";
import {
  buildError,
  buildJson,
  buildSessionRateLimitError,
} from "./responses.ts";
import {
  getFunctionName,
  getSessionAction,
  isBlockedRpcProxyPath,
  isRestProxyPath,
  isRpcProxyPath,
  isUnauthorizedRpcProxyPath,
} from "./routing.ts";
import { applyTrustedIngressHeaders } from "./trustedIngress.ts";

const ACCESS_COOKIE_NAME = "itx_session";
const REFRESH_COOKIE_NAME = "itx_refresh";
const REFRESH_GRANT_TYPE = "refresh_token";
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60;
const REFRESH_TOKEN_DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const REFRESH_TOKEN_MAX_ALLOWED_AGE_SECONDS = 60 * 60 * 24 * 14;

type SessionCookies = {
  accessToken: string | null;
  refreshToken: string | null;
};

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
const resolveKillSwitchMessage = (env: Env) =>
  env.ITX_ITEMTRAXX_KILLSWITCH_MESSAGE?.trim() || DEFAULT_KILL_SWITCH_MESSAGE;

const hasRpcCallerAuth = (request: Request, cookies: SessionCookies) => {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.trim()) {
    return true;
  }
  if (cookies.accessToken || cookies.refreshToken) {
    return true;
  }
  return false;
};

const parseCookies = (request: Request): SessionCookies => {
  const raw = request.headers.get("cookie") ?? "";
  const parsed = new Map<string, string>();
  raw.split(";").forEach((part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key || rest.length === 0) return;
    parsed.set(key, decodeURIComponent(rest.join("=")));
  });
  return {
    accessToken: parsed.get(ACCESS_COOKIE_NAME) ?? null,
    refreshToken: parsed.get(REFRESH_COOKIE_NAME) ?? null,
  };
};

const resolveSessionCookieSameSite = (env: Env) => {
  const configured = env.SESSION_COOKIE_SAMESITE?.trim().toLowerCase();
  if (configured === "strict") return "Strict";
  if (configured === "none") return "None";
  return "Lax";
};

const resolveRefreshCookieMaxAgeSeconds = (env: Env) => {
  const configured = Number(env.SESSION_REFRESH_COOKIE_MAX_AGE_SECONDS?.trim());
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(Math.floor(configured), REFRESH_TOKEN_MAX_ALLOWED_AGE_SECONDS);
  }
  return REFRESH_TOKEN_DEFAULT_MAX_AGE_SECONDS;
};

const appendCookie = (
  headers: Headers,
  name: string,
  value: string,
  env: Env,
  maxAgeSeconds: number
) => {
  const cookieParts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "Secure",
    `SameSite=${resolveSessionCookieSameSite(env)}`,
  ];
  const domain = env.SESSION_COOKIE_DOMAIN?.trim();
  if (domain) {
    cookieParts.push(`Domain=${domain}`);
  }
  headers.append("Set-Cookie", cookieParts.join("; "));
};

const clearCookie = (headers: Headers, name: string, env: Env) => {
  const cookieParts = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    `SameSite=${resolveSessionCookieSameSite(env)}`,
  ];
  const domain = env.SESSION_COOKIE_DOMAIN?.trim();
  if (domain) {
    cookieParts.push(`Domain=${domain}`);
  }
  headers.append("Set-Cookie", cookieParts.join("; "));
};

const setSessionCookies = (
  headers: Headers,
  env: Env,
  session: { accessToken: string; refreshToken: string }
) => {
  appendCookie(headers, ACCESS_COOKIE_NAME, session.accessToken, env, ACCESS_TOKEN_MAX_AGE_SECONDS);
  appendCookie(headers, REFRESH_COOKIE_NAME, session.refreshToken, env, resolveRefreshCookieMaxAgeSeconds(env));
};

const clearSessionCookies = (headers: Headers, env: Env) => {
  clearCookie(headers, ACCESS_COOKIE_NAME, env);
  clearCookie(headers, REFRESH_COOKIE_NAME, env);
};

const appendSetCookies = (target: Headers, source: Headers) => {
  const maybeExtended = source as Headers & { getSetCookie?: () => string[] };
  if (typeof maybeExtended.getSetCookie === "function") {
    maybeExtended.getSetCookie().forEach((cookie) => target.append("Set-Cookie", cookie));
    return;
  }
  const raw = source.get("Set-Cookie");
  if (raw) {
    target.append("Set-Cookie", raw);
  }
};

const buildSupabaseUrl = (env: Env, path: string) => `${trimTrailingSlash(env.SUPABASE_URL)}${path}`;

const fetchAuthUser = async (env: Env, accessToken: string) => {
  const response = await fetch(buildSupabaseUrl(env, "/auth/v1/user"), {
    method: "GET",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    id: string;
    email?: string | null;
    last_sign_in_at?: string | null;
  };

  if (!payload?.id) {
    return null;
  }

  return {
    id: payload.id,
    email: payload.email ?? null,
    last_sign_in_at: payload.last_sign_in_at ?? null,
  };
};

const fetchProfile = async (env: Env, accessToken: string, userId: string) => {
  const url = new URL(buildSupabaseUrl(env, "/rest/v1/profiles"));
  url.searchParams.set("id", `eq.${userId}`);
  url.searchParams.set("select", "id,role,tenant_id,district_id,auth_email,is_active");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const rows = (await response.json()) as ProfileRow[];
  return rows[0] ?? null;
};

const buildSessionSummary = async (env: Env, accessToken: string): Promise<SessionSummary | null> => {
  const user = await fetchAuthUser(env, accessToken);
  if (!user) {
    return null;
  }
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

type SessionRateLimitResult = "allowed" | "limited" | "unavailable";

export const checkSessionRateLimit = async (
  binding: RateLimit | undefined,
  request: Request,
): Promise<SessionRateLimitResult> => {
  const clientIp = request.headers.get("cf-connecting-ip")?.trim();
  if (!binding || !clientIp) {
    return "unavailable";
  }
  try {
    const result = await binding.limit({ key: clientIp });
    return result.success ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
};

type RefreshSessionResult =
  | { status: "ok"; accessToken: string; refreshToken: string }
  | { status: "unauthorized" | "rate_limited" | "unavailable" };

const refreshSession = async (
  request: Request,
  env: Env,
  refreshToken: string,
): Promise<RefreshSessionResult> => {
  const rateLimit = await checkSessionRateLimit(env.SESSION_REFRESH_RATE_LIMITER, request);
  if (rateLimit === "limited") {
    return { status: "rate_limited" };
  }
  if (rateLimit === "unavailable") {
    return { status: "unavailable" };
  }

  const response = await fetch(buildSupabaseUrl(env, `/auth/v1/token?grant_type=${REFRESH_GRANT_TYPE}`), {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    return { status: "unauthorized" };
  }

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

const maybeRefreshSession = async (
  request: Request,
  env: Env,
  cookies: SessionCookies
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
    if (refreshed.status === "rate_limited" || refreshed.status === "unavailable") {
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

type RequestWithCf = Request & {
  cf?: {
    city?: string;
    region?: string;
    regionCode?: string;
    country?: string;
  };
};

const sanitizeGeoHeaderValue = (value: string | null | undefined, maxLen: number) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};

const applyApproxLocationHeaders = (headers: Headers, request: Request) => {
  const cf = (request as RequestWithCf).cf;
  const city = sanitizeGeoHeaderValue(cf?.city, 80);
  const region = sanitizeGeoHeaderValue(cf?.region ?? cf?.regionCode, 80);
  const country = sanitizeGeoHeaderValue(cf?.country, 80);

  if (city) headers.set('x-itx-geo-city', city);
  if (region) headers.set('x-itx-geo-region', region);
  if (country) headers.set('x-itx-geo-country', country);
};

const sanitizeRequestHeaders = (
  request: Request,
  anonKey: string,
  requestId: string,
  functionName: string,
  sessionAccessToken?: string | null
) => {
  const headers = new Headers();
  headers.set("x-request-id", requestId);
  headers.set("apikey", anonKey);
  headers.set("Content-Type", request.headers.get("Content-Type") ?? "application/json");
  const incomingAuth = request.headers.get("Authorization");
  const resolvedAuth = incomingAuth ?? (sessionAccessToken ? `Bearer ${sessionAccessToken}` : null);
  if (functionName === "super-ops" && resolvedAuth) {
    headers.set("x-itx-user-jwt", resolvedAuth);
    headers.set("Authorization", resolvedAuth);
  } else if (resolvedAuth) {
    headers.set("Authorization", resolvedAuth);
  }
  const clientInfo = request.headers.get("x-client-info");
  if (clientInfo) {
    headers.set("x-client-info", clientInfo);
  }
  const userAgent = request.headers.get("user-agent");
  if (userAgent) {
    headers.set("user-agent", userAgent);
  }
  const scanAgentHeader = request.headers.get("aikido-scan-agent");
  if (scanAgentHeader) {
    headers.set("aikido-scan-agent", scanAgentHeader);
  }
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    headers.set("x-forwarded-for", forwardedFor);
  }
  const connectingIp = request.headers.get("cf-connecting-ip");
  if (connectingIp) {
    headers.set("cf-connecting-ip", connectingIp);
  }
  applyApproxLocationHeaders(headers, request);
  return headers;
};

const sanitizeUpstreamHeaders = (
  request: Request,
  anonKey: string,
  requestId: string,
  sessionAccessToken?: string | null
) => {
  const headers = new Headers();
  headers.set("x-request-id", requestId);
  headers.set("apikey", anonKey);
  const contentType = request.headers.get("Content-Type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  const incomingAuth = request.headers.get("Authorization");
  const resolvedAuth = incomingAuth ?? (sessionAccessToken ? `Bearer ${sessionAccessToken}` : null);
  if (resolvedAuth) {
    headers.set("Authorization", resolvedAuth);
  }
  const accept = request.headers.get("accept");
  if (accept) {
    headers.set("accept", accept);
  }
  const prefer = request.headers.get("prefer");
  if (prefer) {
    headers.set("prefer", prefer);
  }
  const range = request.headers.get("range");
  if (range) {
    headers.set("range", range);
  }
  return headers;
};

const proxySupabaseApiRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  upstreamPath: string
) => {
  const cookies = parseCookies(request);
  if (isBlockedRpcProxyPath(upstreamPath)) {
    return buildError(403, "RPC proxy access is not allowed", headers, requestId);
  }
  if (isUnauthorizedRpcProxyPath(upstreamPath, hasRpcCallerAuth(request, cookies))) {
    return buildError(401, "Unauthorized", headers, requestId);
  }
  const normalizedUpstreamPath = isRpcProxyPath(upstreamPath)
    ? `/rest/v1${upstreamPath}`
    : upstreamPath;
  const upstreamUrl = buildSupabaseUrl(
    env,
    `${normalizedUpstreamPath}${new URL(request.url).search}`
  );
  const requestBody = request.method === "GET" || request.method === "HEAD" ? undefined : await request.clone().text();
  const invoke = async (sessionAccessToken?: string | null) => {
    const proxiedHeaders = sanitizeUpstreamHeaders(
      request,
      env.SUPABASE_ANON_KEY,
      requestId,
      sessionAccessToken
    );

    return fetch(upstreamUrl, {
      method: request.method,
      headers: proxiedHeaders,
      body: requestBody,
    });
  };

  let upstreamResponse = await invoke(cookies.accessToken);
  let sessionHeaders: Headers | null = null;

  if (!request.headers.get("Authorization") && upstreamResponse.status === 401 && cookies.refreshToken) {
    const refreshed = await maybeRefreshSession(request, env, cookies);
    if (refreshed.failure) {
      return buildSessionRateLimitError(refreshed.failure, headers, requestId);
    }
    sessionHeaders = refreshed.headers;
    if (refreshed.session) {
      upstreamResponse = await invoke(refreshed.session.accessToken);
    }
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
  responseHeaders.set("x-request-id", requestId);
  if (sessionHeaders) {
    appendSetCookies(responseHeaders, sessionHeaders);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
};

const proxyFunctionRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  functionName: string
) => {
  const cookies = parseCookies(request);
  const supabaseFunctionUrl = `${trimTrailingSlash(env.SUPABASE_URL)}/functions/v1/${functionName}`;
  const isSystemStatusGet = functionName === "system-status" && request.method === "GET";
  const requestBody =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : new Uint8Array(await request.clone().arrayBuffer());
  const invoke = async (sessionAccessToken?: string | null) => {
    const proxiedHeaders = sanitizeRequestHeaders(
      request,
      env.SUPABASE_ANON_KEY,
      requestId,
      functionName,
      sessionAccessToken
    );
    await applyTrustedIngressHeaders(
      proxiedHeaders,
      env,
      requestId,
      functionName,
      request.method,
      requestBody,
    );

    const init: RequestInit = {
      method: request.method,
      headers: proxiedHeaders,
      body:
        requestBody ? requestBody.slice() : undefined,
    };

    return fetch(supabaseFunctionUrl, init);
  };

  let upstreamResponse: Response;
  try {
    upstreamResponse = await invoke(cookies.accessToken);
  } catch (error) {
    if (isSystemStatusGet) {
      const cached = await readMaintenanceFallback(env);
      if (cached) {
        const responseHeaders = new Headers();
        Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
        responseHeaders.set("x-request-id", requestId);
        responseHeaders.set("content-type", "application/json");
        return new Response(
          JSON.stringify({
            status: "down",
            checks: { config: "ok", db: "failed" },
            maintenance: cached,
            maintenance_fallback: true,
            incident_summary: "system status unavailable; maintenance fallback active",
            checked_at: new Date().toISOString(),
          }),
          {
            status: 503,
            headers: responseHeaders,
          }
        );
      }
    }
    throw error;
  }
  let sessionHeaders: Headers | null = null;

  if (!request.headers.get("Authorization") && upstreamResponse.status === 401 && cookies.refreshToken) {
    const refreshed = await maybeRefreshSession(request, env, cookies);
    if (refreshed.failure) {
      return buildSessionRateLimitError(refreshed.failure, headers, requestId);
    }
    sessionHeaders = refreshed.headers;
    if (refreshed.session) {
      upstreamResponse = await invoke(refreshed.session.accessToken);
    }
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
  responseHeaders.set("x-request-id", requestId);
  if (sessionHeaders) {
    appendSetCookies(responseHeaders, sessionHeaders);
  }

  if (isSystemStatusGet) {
    const rawBody = await upstreamResponse.clone().text();
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const withFallback = await applyMaintenanceFallbackToStatusPayload(
        env,
        upstreamResponse.status,
        parsed
      );
      responseHeaders.set("content-type", "application/json");
      return new Response(JSON.stringify(withFallback), {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    } catch {
      // preserve original upstream payload when JSON parsing fails
    }
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
};

const handleSessionExchange = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string
) => {
  const rateLimit = await checkSessionRateLimit(env.SESSION_EXCHANGE_RATE_LIMITER, request);
  if (rateLimit === "limited") {
    return buildSessionRateLimitError("rate_limited", headers, requestId);
  }
  if (rateLimit === "unavailable") {
    return buildSessionRateLimitError("unavailable", headers, requestId);
  }

  const payload = (await request.json().catch(() => ({}))) as SessionExchangePayload;
  if (!payload.access_token || !payload.refresh_token) {
    return buildError(400, "Invalid request", headers, requestId);
  }

  const summary = await buildSessionSummary(env, payload.access_token);
  if (!summary) {
    return buildError(401, "Unauthorized", headers, requestId);
  }

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
  requestId: string
) => {
  const cookies = parseCookies(request);
  if (!cookies.refreshToken) {
    const responseHeaders = new Headers();
    clearSessionCookies(responseHeaders, env);
    return buildError(401, "Unauthorized", headers, requestId, responseHeaders);
  }

  const refreshed = await refreshSession(request, env, cookies.refreshToken);
  if (refreshed.status !== "ok") {
    if (refreshed.status === "rate_limited" || refreshed.status === "unavailable") {
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

const handleSessionMe = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string
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
      return buildJson(200, { authenticated: false, user: null, profile: null }, headers, requestId, refreshed.headers);
    }
  }

  if (!accessToken) {
    return buildJson(200, { authenticated: false, user: null, profile: null }, headers, requestId);
  }

  const summary = await buildSessionSummary(env, accessToken);
  if (!summary) {
    const clearHeaders = responseHeaders ?? new Headers();
    clearSessionCookies(clearHeaders, env);
    return buildJson(200, { authenticated: false, user: null, profile: null }, headers, requestId, clearHeaders);
  }

  return buildJson(200, summary, headers, requestId, responseHeaders ?? undefined);
};

const handleSessionLogout = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string
) => {
  const cookies = parseCookies(request);
  const authToken = cookies.accessToken;

  if (authToken) {
    await fetch(buildSupabaseUrl(env, "/auth/v1/logout"), {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${authToken}`,
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
  requestId: string
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

const handleSessionRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  action: string,
  allowedOrigins: string[]
) => {
  if (action === "exchange" && request.method === "POST") {
    const error = validateSessionMutationRequest(request, env, allowedOrigins, headers, requestId);
    if (error) return error;
    return handleSessionExchange(request, env, headers, requestId);
  }
  if (action === "refresh" && request.method === "POST") {
    const error = validateSessionMutationRequest(request, env, allowedOrigins, headers, requestId);
    if (error) return error;
    return handleSessionRefresh(request, env, headers, requestId);
  }
  if (action === "logout" && request.method === "POST") {
    const error = validateSessionMutationRequest(request, env, allowedOrigins, headers, requestId);
    if (error) return error;
    return handleSessionLogout(request, env, headers, requestId);
  }
  if (action === "me" && request.method === "GET") {
    return handleSessionMe(request, env, headers, requestId);
  }
  return buildError(404, "Not found", headers, requestId);
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const requestId =
      request.headers.get("x-request-id") ??
      (typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : "itx-edge-request");
    const allowedOrigins = Array.from(
      new Set([...DEFAULT_ALLOWED_ORIGINS, ...parseCsv(env.ALLOWED_ORIGINS)])
    );
    const { originAllowed, headers } = withCorsHeaders(origin, allowedOrigins, env);

    try {
      if (request.method === "OPTIONS") {
        if (!originAllowed) {
          return new Response("Origin not allowed", { status: 403, headers });
        }
        return new Response("ok", { headers });
      }

      if (!originAllowed) {
        return buildError(403, "Origin not allowed", headers, requestId);
      }

      if (url.pathname === "/turnstile-policy" && request.method === "GET") {
        return buildJson(
          200,
          { bypass_turnstile: false },
          headers,
          requestId
        );
      }

      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        const response = buildError(500, "Proxy misconfiguration", headers, requestId);
        maybeReportWorkerResponse(env, request, requestId, response, ctx, { type: "proxy_misconfiguration" });
        return response;
      }

      const sessionAction = getSessionAction(url.pathname);
      if (sessionAction) {
        const response = await handleSessionRequest(request, env, headers, requestId, sessionAction, allowedOrigins);
        maybeReportWorkerResponse(env, request, requestId, response, ctx, { type: "session", action: sessionAction });
        return response;
      }

      if (isBlockedRpcProxyPath(url.pathname)) {
        return buildError(403, "RPC proxy access is not allowed", headers, requestId);
      }

      if (isRestProxyPath(url.pathname) || isRpcProxyPath(url.pathname)) {
        if (
          request.method !== "GET" && request.method !== "HEAD" &&
          request.headers.get("x-itx-data-request") !== "1"
        ) {
          return buildError(400, "Invalid data request", headers, requestId);
        }
        const response = await proxySupabaseApiRequest(request, env, headers, requestId, url.pathname);
        maybeReportWorkerResponse(env, request, requestId, response, ctx, { type: "rest", path: url.pathname });
        return response;
      }

      const functionName = getFunctionName(url.pathname);
      if (!functionName) {
        return buildError(404, "Not found", headers, requestId);
      }

      const killSwitchEnabled =
        (env.ITX_ITEMTRAXX_KILLSWITCH_ENABLED ?? "").toLowerCase() === "true";
      if (killSwitchEnabled && functionName !== "system-status" && !isLocalhostOrigin(origin)) {
        const response = buildError(
          503,
          resolveKillSwitchMessage(env),
          headers,
          requestId
        );
        maybeReportWorkerResponse(env, request, requestId, response, ctx, { type: "kill_switch", functionName });
        return response;
      }

      const allowedFunctions = parseCsv(env.ALLOWED_FUNCTIONS);
      if (allowedFunctions.length > 0 && !allowedFunctions.includes(functionName)) {
        return buildError(403, "Function not allowed", headers, requestId);
      }

      const response = await proxyFunctionRequest(request, env, headers, requestId, functionName);
      maybeReportWorkerResponse(env, request, requestId, response, ctx, { type: "function", functionName });
      return response;
    } catch (error) {
      ctx.waitUntil(reportWorkerException(env, request, requestId, error));
      return buildError(500, "Internal worker error", headers, requestId);
    }
  },
} satisfies ExportedHandler<Env>;
