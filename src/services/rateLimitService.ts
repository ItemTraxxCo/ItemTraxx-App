import { authenticatedRpc } from "./authenticatedDataClient";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

const consumeRateLimit = async (
  scope: "tenant" | "admin",
  limit: number,
  windowSeconds: number
) => {
  try {
    const data = await authenticatedRpc<RateLimitResult>("consume_rate_limit", {
      p_scope: scope,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    return data;
  } catch {
    throw new Error("Rate limit check failed.");
  }
};

export const enforceAdminRateLimit = async () => {
  const result = await consumeRateLimit("admin", 20, 60);
  if (!result.allowed) {
    throw new Error("Rate limit exceeded, please try again in a minute.");
  }
};
