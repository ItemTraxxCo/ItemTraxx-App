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

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const hashString = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(new Uint8Array(digest));
};

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

export const resolveClientFingerprint = (req: Request, origin: string | null) => {
  const ipCandidate = resolveClientIp(req);

  if (ipCandidate) {
    return `ip-${normalizeScopePart(ipCandidate, "unknown-ip", 24)}`;
  }

  if (origin) {
    return `origin-${normalizeScopePart(origin, "unknown-origin", 24)}`;
  }

  return "unknown-client";
};

export const enforcePreloginRateLimit = async (
  client: any,
  key: string,
  scope: string,
  limit: number,
  windowSeconds: number
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

  const result = data as RateLimitResult;
  if (!result.allowed) {
    return { ok: false as const, error: null as RateLimitError };
  }

  return { ok: true as const, error: null as RateLimitError };
};

export const verifyTurnstileToken = async (
  secret: string,
  token: string,
  remoteIp: string,
  logContext: string
) => {
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
      }
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
      console.warn(`${logContext} turnstile verification succeeded after retry without remote IP`);
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
