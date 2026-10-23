type RateLimitBinding = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
};

export type PublicRequestLimitResult =
  | { allowed: true }
  | { allowed: false; unavailable?: true };

/** Apply a Worker-side budget before public request bodies are parsed/buffered. */
export const enforcePublicRequestLimit = async (
  binding: RateLimitBinding | undefined,
  request: Request,
  scope: string,
): Promise<PublicRequestLimitResult> => {
  if (!binding) return { allowed: false, unavailable: true };

  // Cloudflare overwrites this header at its edge. Never trust a caller's
  // User-Agent or forwarded-for value to mint additional rate-limit buckets.
  const clientIp =
    request.headers.get("cf-connecting-ip")?.trim().slice(0, 128) ||
    "unknown";
  try {
    const result = await binding.limit({ key: `${scope}:${clientIp}` });
    return result.success ? { allowed: true } : { allowed: false };
  } catch {
    // Do not proxy unmetered public traffic if the admission binding fails.
    return { allowed: false, unavailable: true };
  }
};
