export type PublicRateLimitHeadersOptions = {
  limit: number;
  windowSeconds: number;
  retryAfterSeconds?: number | null;
  remaining?: number | null;
};

const normalizePositiveInteger = (value: number, fallback: number) => {
  const normalized = Math.floor(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

/**
 * Build the RFC 9333 response fields for intentionally public endpoints.
 *
 * The prelogin RPC returns the exact retry delay only when a bucket is full;
 * it does not expose a live remaining count for successful calls. We therefore
 * omit RateLimit-Remaining when it is unknown instead of publishing a made-up
 * value, and set it to zero on a rejected request.
 */
export const buildPublicRateLimitHeaders = ({
  limit,
  windowSeconds,
  retryAfterSeconds = null,
  remaining = null,
}: PublicRateLimitHeadersOptions): Record<string, string> => {
  const normalizedLimit = normalizePositiveInteger(limit, 1);
  const normalizedWindow = normalizePositiveInteger(windowSeconds, 1);
  const normalizedRetryAfter =
    retryAfterSeconds === null || retryAfterSeconds === undefined
      ? null
      : Math.max(0, Math.floor(retryAfterSeconds));
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(normalizedLimit),
    "RateLimit-Reset": String(normalizedRetryAfter ?? normalizedWindow),
    "RateLimit-Policy": `${normalizedLimit};w=${normalizedWindow}`,
  };

  if (remaining !== null && remaining !== undefined) {
    headers["RateLimit-Remaining"] = String(Math.max(0, Math.floor(remaining)));
  }
  if (normalizedRetryAfter !== null) {
    headers["Retry-After"] = String(normalizedRetryAfter);
  }

  return headers;
};
