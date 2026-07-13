import { BASE_CORS_HEADERS } from "./constants.ts";

export const parseCsv = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export const isLocalhostOrigin = (origin: string | null) => {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  } catch {
    return false;
  }
};

const shouldTrustLocalOrigins = (env: Env) =>
  (env.TRUST_LOCAL_ORIGINS ?? "").trim().toLowerCase() === "true";

export const isAllowedOrigin = (origin: string | null, allowedOrigins: string[], env: Env) => {
  if (!origin) {
    return false;
  }

  if (shouldTrustLocalOrigins(env) && isLocalhostOrigin(origin)) {
    return true;
  }

  return allowedOrigins.some((candidate) => candidate === origin);
};

export const withCorsHeaders = (origin: string | null, allowedOrigins: string[], env: Env) => {
  const originAllowed =
    !origin || allowedOrigins.length === 0 || isAllowedOrigin(origin, allowedOrigins, env);
  const headers = origin && originAllowed
    ? { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin }
    : { ...BASE_CORS_HEADERS };
  return { originAllowed, headers };
};

export const resolveRequestOrigin = (request: Request) => request.headers.get("Origin");
