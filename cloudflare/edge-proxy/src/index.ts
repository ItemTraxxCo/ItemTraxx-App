export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ALLOWED_ORIGINS?: string;
  ALLOWED_FUNCTIONS?: string;
  ITX_ITEMTRAXX_KILLSWITCH_ENABLED?: string;
  SESSION_COOKIE_DOMAIN?: string;
}

const ACCESS_COOKIE_NAME = "itx_session";
const REFRESH_COOKIE_NAME = "itx_refresh";
const REFRESH_GRANT_TYPE = "refresh_token";
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
  Vary: "Origin",
};
const DEFAULT_ALLOWED_ORIGINS = [
  "https://itemtraxx.com",
  "https://www.itemtraxx.com",
  "https://internal.itemtraxx.com",
  "https://app.itemtraxx.com",
  "https://*.app.itemtraxx.com",
  "https://*.vercel.app",
];

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

const parseCsv = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const isLocalhostOrigin = (origin: string | null) => {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
      return true;
    }
    if (hostname.startsWith("192.168.") || hostname.startsWith("10.")) {
      return true;
    }
    const match172 = hostname.match(/^172\.(\d{1,3})\./);
    if (!match172) return false;
    const secondOctet = Number(match172[1]);
    return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
  } catch {
    return false;
  }
};

const matchesWildcardOrigin = (origin: string, candidate: string) => {
  if (!candidate.includes("*")) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const protocolMatch = candidate.match(/^(https?:)\/\//i);
    if (!protocolMatch) {
      return false;
    }
    const candidateProtocol = protocolMatch[1].toLowerCase();
    if (originUrl.protocol.toLowerCase() !== candidateProtocol) {
      return false;
    }

    const candidateHost = candidate.slice(protocolMatch[0].length).split("/")[0]?.toLowerCase() ?? "";
    if (!candidateHost.startsWith("*.")) {
      return false;
    }

    const suffix = candidateHost.slice(2);
    const hostname = originUrl.hostname.toLowerCase();
    return hostname !== suffix && hostname.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
};

const isAllowedOrigin = (origin: string | null, allowedOrigins: string[]) => {
  if (!origin) {
    return false;
  }

  if (isLocalhostOrigin(origin)) {
    return true;
  }

  return allowedOrigins.some((candidate) => candidate === origin || matchesWildcardOrigin(origin, candidate));
};

const withCorsHeaders = (origin: string | null, allowedOrigins: string[]) => {
  const originAllowed =
    !origin || allowedOrigins.length === 0 || isAllowedOrigin(origin, allowedOrigins);
  const headers = origin && originAllowed
    ? { ...BASE_CORS_HEADERS, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) }
    : { ...BASE_CORS_HEADERS };
  return { originAllowed, headers };
};

const buildError = (
  status: number,
  message: string,
  headers: Record<string, string>,
  requestId: string,
  extraHeaders?: Headers
) => {
  const responseHeaders = extraHeaders ? new Headers(extraHeaders) : new Headers();
  Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
  responseHeaders.set("Content-Type", "application/json");
  responseHeaders.set("x-request-id", requestId);
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: responseHeaders,
  });
};

const buildJson = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  requestId: string,
  extraHeaders?: Headers
) => {
  const responseHeaders = extraHeaders ? new Headers(extraHeaders) : new Headers();
  Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
  responseHeaders.set("Content-Type", "application/json");
  responseHeaders.set("x-request-id", requestId);
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
};

const getFunctionName = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0] !== "functions") {
    return "";
  }
  return segments[1] ?? "";
};

const getSessionAction = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 3 || segments[0] !== "auth" || segments[1] !== "session") {
    return "";
  }
  return segments[2] ?? "";
};

const isRestProxyPath = (pathname: string) => pathname.startsWith("/rest/v1/");

const isRpcProxyPath = (pathname: string) => pathname.startsWith("/rpc/");

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
    "SameSite=None",
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
    "SameSite=None",
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
  appendCookie(headers, REFRESH_COOKIE_NAME, session.refreshToken, env, REFRESH_TOKEN_MAX_AGE_SECONDS);
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

const refreshSession = async (env: Env, refreshToken: string) => {
  const response = await fetch(buildSupabaseUrl(env, `/auth/v1/token?grant_type=${REFRESH_GRANT_TYPE}`), {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as TokenRefreshResponse;
  if (!payload.access_token || !payload.refresh_token) {
    return null;
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  };
};

const maybeRefreshSession = async (
  env: Env,
  cookies: SessionCookies
): Promise<{ session: { accessToken: string; refreshToken: string } | null; headers: Headers | null }> => {
  if (!cookies.refreshToken) {
    return { session: null, headers: null };
  }

  const refreshed = await refreshSession(env, cookies.refreshToken);
  if (!refreshed) {
    const headers = new Headers();
    clearSessionCookies(headers, env);
    return { session: null, headers };
  }

  const headers = new Headers();
  setSessionCookies(headers, env, refreshed);
  return { session: refreshed, headers };
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
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    headers.set("x-forwarded-for", forwardedFor);
  }
  const connectingIp = request.headers.get("cf-connecting-ip");
  if (connectingIp) {
    headers.set("cf-connecting-ip", connectingIp);
  }
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
  const upstreamUrl = buildSupabaseUrl(env, `${upstreamPath}${new URL(request.url).search}`);
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
    const refreshed = await maybeRefreshSession(env, cookies);
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
  const invoke = async (sessionAccessToken?: string | null) => {
    const proxiedHeaders = sanitizeRequestHeaders(
      request,
      env.SUPABASE_ANON_KEY,
      requestId,
      functionName,
      sessionAccessToken
    );

    const init: RequestInit = {
      method: request.method,
      headers: proxiedHeaders,
      body: request.method === "GET" ? undefined : await request.clone().text(),
    };

    return fetch(supabaseFunctionUrl, init);
  };

  let upstreamResponse = await invoke(cookies.accessToken);
  let sessionHeaders: Headers | null = null;

  if (!request.headers.get("Authorization") && upstreamResponse.status === 401 && cookies.refreshToken) {
    const refreshed = await maybeRefreshSession(env, cookies);
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

const handleSessionExchange = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string
) => {
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

  const refreshed = await refreshSession(env, cookies.refreshToken);
  if (!refreshed) {
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
    const refreshed = await maybeRefreshSession(env, cookies);
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

const handleSessionRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  action: string
) => {
  if (action === "exchange" && request.method === "POST") {
    return handleSessionExchange(request, env, headers, requestId);
  }
  if (action === "refresh" && request.method === "POST") {
    return handleSessionRefresh(request, env, headers, requestId);
  }
  if (action === "logout" && request.method === "POST") {
    return handleSessionLogout(request, env, headers, requestId);
  }
  if (action === "me" && request.method === "GET") {
    return handleSessionMe(request, env, headers, requestId);
  }
  return buildError(404, "Not found", headers, requestId);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const requestId =
      request.headers.get("x-request-id") ??
      (typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : "itx-edge-request");
    const allowedOrigins = Array.from(
      new Set([...DEFAULT_ALLOWED_ORIGINS, ...parseCsv(env.ALLOWED_ORIGINS)])
    );
    const { originAllowed, headers } = withCorsHeaders(origin, allowedOrigins);

    if (request.method === "OPTIONS") {
      if (!originAllowed) {
        return new Response("Origin not allowed", { status: 403, headers });
      }
      return new Response("ok", { headers });
    }

    if (!originAllowed) {
      return buildError(403, "Origin not allowed", headers, requestId);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return buildError(500, "Proxy misconfiguration", headers, requestId);
    }

    const sessionAction = getSessionAction(url.pathname);
    if (sessionAction) {
      return handleSessionRequest(request, env, headers, requestId, sessionAction);
    }

    if (isRestProxyPath(url.pathname) || isRpcProxyPath(url.pathname)) {
      return proxySupabaseApiRequest(request, env, headers, requestId, url.pathname);
    }

    const functionName = getFunctionName(url.pathname);
    if (!functionName) {
      return buildError(404, "Not found", headers, requestId);
    }

    const killSwitchEnabled =
      (env.ITX_ITEMTRAXX_KILLSWITCH_ENABLED ?? "").toLowerCase() === "true";
    if (killSwitchEnabled && functionName !== "system-status" && !isLocalhostOrigin(origin)) {
      return buildError(503, "Unfortunately ItemTraxx is currently unavailable.", headers, requestId);
    }

    const allowedFunctions = parseCsv(env.ALLOWED_FUNCTIONS);
    if (allowedFunctions.length > 0 && !allowedFunctions.includes(functionName)) {
      return buildError(403, "Function not allowed", headers, requestId);
    }

    return proxyFunctionRequest(request, env, headers, requestId, functionName);
  },
};
