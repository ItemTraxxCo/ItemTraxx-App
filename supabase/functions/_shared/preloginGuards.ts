import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

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
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim() ?? "";
  const connectingIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  const realIp = req.headers.get("x-real-ip")?.trim() ?? "";
  return firstForwardedIp || connectingIp || realIp || "";
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
  client: SupabaseClient,
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
    return { ok: false as const, error };
  }

  const result = data as RateLimitResult;
  if (!result.allowed) {
    return { ok: false as const, error: null };
  }

  return { ok: true as const, error: null };
};

export const verifyTurnstileToken = async (
  secret: string,
  token: string,
  remoteIp: string,
  logContext: string
) => {
  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", token);
  if (remoteIp) {
    params.set("remoteip", remoteIp);
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
    });
    return false;
  }

  const result = (await response.json()) as TurnstileVerifyResult;
  if (!result.success) {
    console.error(`${logContext} turnstile verification failed`, {
      errorCodes: result["error-codes"] ?? [],
    });
  }
  return !!result.success;
};
