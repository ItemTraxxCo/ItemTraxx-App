const ACCESS_COOKIE_NAME = "itx_session";
const REFRESH_COOKIE_NAME = "itx_refresh";
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60;
const REFRESH_TOKEN_DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const REFRESH_TOKEN_MAX_ALLOWED_AGE_SECONDS = 60 * 60 * 24 * 14;

export type SessionCookies = {
  accessToken: string | null;
  refreshToken: string | null;
};

export const parseCookies = (request: Request): SessionCookies => {
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
    return Math.min(
      Math.floor(configured),
      REFRESH_TOKEN_MAX_ALLOWED_AGE_SECONDS,
    );
  }
  return REFRESH_TOKEN_DEFAULT_MAX_AGE_SECONDS;
};

const appendCookie = (
  headers: Headers,
  name: string,
  value: string,
  env: Env,
  maxAgeSeconds: number,
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

export const setSessionCookies = (
  headers: Headers,
  env: Env,
  session: { accessToken: string; refreshToken: string },
) => {
  appendCookie(
    headers,
    ACCESS_COOKIE_NAME,
    session.accessToken,
    env,
    ACCESS_TOKEN_MAX_AGE_SECONDS,
  );
  appendCookie(
    headers,
    REFRESH_COOKIE_NAME,
    session.refreshToken,
    env,
    resolveRefreshCookieMaxAgeSeconds(env),
  );
};

export const clearSessionCookies = (headers: Headers, env: Env) => {
  clearCookie(headers, ACCESS_COOKIE_NAME, env);
  clearCookie(headers, REFRESH_COOKIE_NAME, env);
};

export const appendSetCookies = (target: Headers, source: Headers) => {
  const maybeExtended = source as Headers & { getSetCookie?: () => string[] };
  if (typeof maybeExtended.getSetCookie === "function") {
    maybeExtended.getSetCookie().forEach((cookie) =>
      target.append("Set-Cookie", cookie)
    );
    return;
  }
  const raw = source.get("Set-Cookie");
  if (raw) {
    target.append("Set-Cookie", raw);
  }
};
