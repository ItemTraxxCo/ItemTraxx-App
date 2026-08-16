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
    return hostname === "localhost" || hostname === "127.0.0.1" ||
      hostname === "0.0.0.0";
  } catch {
    return false;
  }
};

const shouldTrustLocalOrigins = (env: Env) =>
  (env.TRUST_LOCAL_ORIGINS ?? "").trim().toLowerCase() === "true";

const RESERVED_WORKSPACE_SLUGS = new Set([
  "app",
  "internal",
  "status",
  "www",
  // Scanner, demo, and test tenants are not production browser surfaces.
  "itxdemo",
  "pentest",
  "pentest2",
  "testdist",
  "testtenant-15da6e97",
]);

const isWorkspaceAppOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    const match = url.hostname.toLowerCase().match(
      /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.app\.itemtraxx\.com$/,
    );
    return url.protocol === "https:" &&
      url.port === "" &&
      !!match?.[1] &&
      !RESERVED_WORKSPACE_SLUGS.has(match[1]);
  } catch {
    return false;
  }
};

export const isAllowedOrigin = (
  origin: string | null,
  allowedOrigins: string[],
  env: Env,
) => {
  if (!origin) {
    return false;
  }

  if (shouldTrustLocalOrigins(env) && isLocalhostOrigin(origin)) {
    return true;
  }

  if (isWorkspaceAppOrigin(origin)) {
    return true;
  }

  return allowedOrigins.some((candidate) => candidate === origin);
};

export const withCorsHeaders = (
  origin: string | null,
  allowedOrigins: string[],
  env: Env,
) => {
  // Requests without an Origin header are non-browser (no CORS to enforce) and
  // are still gated downstream by trusted-ingress HMAC / auth. A present Origin
  // must match the allowlist exactly — an empty allowlist denies, never allows.
  const originAllowed = !origin || isAllowedOrigin(origin, allowedOrigins, env);
  const headers = origin && originAllowed
    ? { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin }
    : { ...BASE_CORS_HEADERS };
  return { originAllowed, headers };
};

export const resolveRequestOrigin = (request: Request) =>
  request.headers.get("Origin");
