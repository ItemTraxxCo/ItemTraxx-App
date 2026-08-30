import { sha256Hex } from "./sha256.ts";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

type RateLimitError = {
  message?: string;
} | null;

type TurnstileVerifyResult = {
  success: boolean;
  "error-codes"?: string[];
};

export const hashString = sha256Hex;

type JsonResponse = (status: number, body: Record<string, unknown>) => Response;

const normalizeScopePart = (value: string, fallback: string, maxLen = 32) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, maxLen);
};

export const resolveClientIp = (req: Request) => {
  const connectingIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (connectingIp) return connectingIp;

  // Do not trust x-real-ip or x-forwarded-for on public/prelogin handlers unless
  // the upstream proxy chain is explicitly validated. For requests that do not
  // arrive through Cloudflare, fall back to non-IP client fingerprinting instead.
  return "";
};

const STATUS_CLIENT_COOKIE = "itx-status-client";
const STATUS_CLIENT_COOKIE_MAX_AGE_SECONDS = 15 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const readCookie = (req: Request, name: string) => {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
};

export type PublicStatusClient = {
  key: string;
  setCookie?: string;
};

/**
 * Resolve the public status limiter identity only after the caller's edge
 * proof has been established. Direct callers receive a server-issued,
 * HttpOnly nonce so unrelated browsers do not share the anonymous bucket.
 * A separate direct global budget still bounds callers that rotate cookies.
 */
export const resolvePublicStatusClient = (
  req: Request,
  trustedEdgeIngress: boolean,
): PublicStatusClient => {
  if (trustedEdgeIngress) {
    const ip = resolveClientIp(req);
    if (ip) {
      return {
        key: `ip-${normalizeScopePart(ip, "unknown-ip", 24)}`,
      };
    }
  }

  const existing = readCookie(req, STATUS_CLIENT_COOKIE);
  if (UUID_PATTERN.test(existing)) {
    return { key: `status-${existing.toLowerCase()}` };
  }

  const nonce = crypto.randomUUID();
  return {
    key: `status-${nonce}`,
    setCookie:
      `${STATUS_CLIENT_COOKIE}=${nonce}; Max-Age=${STATUS_CLIENT_COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  };
};

export const resolveClientFingerprint = (
  req: Request,
  _origin: string | null,
  options: { trustProxyHeader?: boolean } = { trustProxyHeader: false },
) => {
  const ipCandidate = options.trustProxyHeader === false
    ? ""
    : resolveClientIp(req);

  if (ipCandidate) {
    return `ip-${normalizeScopePart(ipCandidate, "unknown-ip", 24)}`;
  }

  return "unknown-client";
};

export const enforcePreloginRateLimit = async (
  client: any,
  key: string,
  scope: string,
  limit: number,
  windowSeconds: number,
) => {
  const { data, error } = await client.rpc("consume_rate_limit_prelogin", {
    p_key: key,
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    return {
      ok: false as const,
      error: error as RateLimitError,
      retryAfterSeconds: null,
    };
  }

  const result = Array.isArray(data)
    ? ((data[0] as RateLimitResult | undefined) ?? null)
    : ((data as RateLimitResult | null) ?? null);
  if (!result) {
    return {
      ok: false as const,
      error: { message: "Rate limit RPC returned no rows." } as RateLimitError,
      retryAfterSeconds: null,
    };
  }
  if (!result.allowed) {
    return {
      ok: false as const,
      error: null as RateLimitError,
      retryAfterSeconds: result.retry_after_seconds,
    };
  }

  return {
    ok: true as const,
    error: null as RateLimitError,
    retryAfterSeconds: null,
  };
};

/**
 * Apply a stable per-client limit and an independent fixed global budget.
 * Public callers must not be able to mint new buckets by changing a browser
 * supplied header such as User-Agent. The global bucket also caps aggregate
 * work when requests arrive from many addresses.
 */
export const enforcePublicRateLimits = async (
  client: any,
  clientKey: string,
  scope: string,
  perClientLimit: number,
  windowSeconds: number,
  globalLimit: number,
) => {
  const perClient = await enforcePreloginRateLimit(
    client,
    clientKey,
    scope,
    perClientLimit,
    windowSeconds,
  );
  if (!perClient.ok) return perClient;

  return enforcePreloginRateLimit(
    client,
    "global",
    `${scope}:global`,
    globalLimit,
    windowSeconds,
  );
};

export const resolveRateLimitResult = ({
  data,
  error,
  jsonResponse,
  failureStatus = 500,
  failureMessage = "Rate limit check failed",
}: {
  data: unknown;
  error: RateLimitError;
  jsonResponse: JsonResponse;
  failureStatus?: number;
  failureMessage?: string;
}) => {
  if (error) {
    return {
      result: null as RateLimitResult | null,
      response: jsonResponse(failureStatus, { error: failureMessage }),
    };
  }

  const result = Array.isArray(data)
    ? ((data[0] as RateLimitResult | undefined) ?? null)
    : ((data as RateLimitResult | null) ?? null);

  if (!result) {
    return {
      result: null as RateLimitResult | null,
      response: jsonResponse(failureStatus, { error: failureMessage }),
    };
  }

  return {
    result,
    response: null as Response | null,
  };
};

export const verifyTurnstileToken = async (
  token: string,
  remoteIp: string,
  logContext: string,
) => {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    console.error(`${logContext} turnstile token is empty`);
    return false;
  }

  const secret = Deno.env.get("ITX_TURNSTILE_SECRET") ??
    Deno.env.get("ITX_TURNSTILE_SECRET_KEY") ?? "";
  if (!secret) {
    console.error(`${logContext} turnstile secret is not configured`);
    return false;
  }
  const submitVerification = async (ip?: string) => {
    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", normalizedToken);
    if (ip) {
      params.set("remoteip", ip);
    }

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );

    if (!response.ok) {
      console.error(`${logContext} turnstile verification request failed`, {
        status: response.status,
        usedRemoteIp: Boolean(ip),
      });
      return null;
    }

    return (await response.json()) as TurnstileVerifyResult;
  };

  const initialResult = await submitVerification(remoteIp || undefined);
  if (initialResult?.success) {
    return true;
  }

  if (remoteIp) {
    const fallbackResult = await submitVerification();
    if (fallbackResult?.success) {
      console.warn(
        `${logContext} turnstile verification succeeded after retry without remote IP`,
      );
      return true;
    }
    if (fallbackResult) {
      console.error(`${logContext} turnstile verification failed`, {
        errorCodes: fallbackResult["error-codes"] ?? [],
        retriedWithoutRemoteIp: true,
      });
      return false;
    }
  }

  if (initialResult) {
    console.error(`${logContext} turnstile verification failed`, {
      errorCodes: initialResult["error-codes"] ?? [],
      retriedWithoutRemoteIp: false,
    });
  }
  return false;
};
