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

export const resolveClientFingerprint = (
  req: Request,
  _origin: string | null,
) => {
  const ipCandidate = resolveClientIp(req);

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
    return { ok: false as const, error: error as RateLimitError };
  }

  const result = Array.isArray(data)
    ? ((data[0] as RateLimitResult | undefined) ?? null)
    : ((data as RateLimitResult | null) ?? null);
  if (!result) {
    return {
      ok: false as const,
      error: { message: "Rate limit RPC returned no rows." } as RateLimitError,
    };
  }
  if (!result.allowed) {
    return { ok: false as const, error: null as RateLimitError };
  }

  return { ok: true as const, error: null as RateLimitError };
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
  const secret = Deno.env.get("ITX_TURNSTILE_SECRET") ??
    Deno.env.get("ITX_TURNSTILE_SECRET_KEY") ?? "";
  if (!secret) {
    console.error(`${logContext} turnstile secret is not configured`);
    return false;
  }
  const submitVerification = async (ip?: string) => {
    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", token);
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
