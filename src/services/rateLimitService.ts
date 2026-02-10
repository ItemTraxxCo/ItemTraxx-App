import { supabase } from "./supabaseClient";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

const consumeRateLimit = async (
  scope: "tenant" | "admin",
  limit: number,
  windowSeconds: number
) => {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    throw new Error("Rate limit check failed.");
  }

  return data as RateLimitResult;
};

export const enforceTenantTxnRateLimit = async () => {
  const result = await consumeRateLimit("tenant", 10, 60);
  if (!result.allowed) {
    throw new Error("Rate limit exceeded, please try again in a minute.");
  }
};

export const enforceAdminRateLimit = async () => {
  const result = await consumeRateLimit("admin", 20, 60);
  if (!result.allowed) {
    throw new Error("Rate limit exceeded, please try again in a minute.");
  }
};

export const enforceTenantLookupRateLimit = async () => {
  const result = await consumeRateLimit("tenant", 20, 60);
  if (!result.allowed) {
    throw new Error("Rate limit exceeded, please try again in a minute.");
  }
};
