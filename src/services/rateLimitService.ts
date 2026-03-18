import { supabase } from "./supabaseClient";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

type TenantLookupState = {
  timestamps: number[];
  cooldownUntil: number;
};

const TENANT_LOOKUP_LIMIT = 20;
const TENANT_LOOKUP_WINDOW_MS = 30_000;
const TENANT_LOOKUP_COOLDOWN_MS = 5_000;
const TENANT_LOOKUP_STORAGE_KEY = "itemtraxx:tenant-student-lookup-rate-limit:v1";

const hasWindowStorage = () =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const readTenantLookupState = (): TenantLookupState => {
  if (!hasWindowStorage()) {
    return { timestamps: [], cooldownUntil: 0 };
  }

  try {
    const raw = window.localStorage.getItem(TENANT_LOOKUP_STORAGE_KEY);
    if (!raw) {
      return { timestamps: [], cooldownUntil: 0 };
    }
    const parsed = JSON.parse(raw) as Partial<TenantLookupState>;
    return {
      timestamps: Array.isArray(parsed.timestamps)
        ? parsed.timestamps.filter((value): value is number => Number.isFinite(value))
        : [],
      cooldownUntil: Number.isFinite(parsed.cooldownUntil) ? Number(parsed.cooldownUntil) : 0,
    };
  } catch {
    return { timestamps: [], cooldownUntil: 0 };
  }
};

const writeTenantLookupState = (state: TenantLookupState) => {
  if (!hasWindowStorage()) return;

  try {
    window.localStorage.setItem(TENANT_LOOKUP_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures so checkout still works.
  }
};

const getTenantLookupMessage = (secondsRemaining: number) =>
  `Rate limit reached. Wait ${secondsRemaining} second${secondsRemaining === 1 ? "" : "s"} and try again.`;

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
  const now = Date.now();
  const state = readTenantLookupState();

  if (state.cooldownUntil > now) {
    const secondsRemaining = Math.max(1, Math.ceil((state.cooldownUntil - now) / 1000));
    throw new Error(getTenantLookupMessage(secondsRemaining));
  }

  const timestamps = state.timestamps.filter((timestamp) => now - timestamp < TENANT_LOOKUP_WINDOW_MS);
  if (timestamps.length >= TENANT_LOOKUP_LIMIT) {
    const cooldownUntil = now + TENANT_LOOKUP_COOLDOWN_MS;
    writeTenantLookupState({ timestamps, cooldownUntil });
    throw new Error(getTenantLookupMessage(Math.ceil(TENANT_LOOKUP_COOLDOWN_MS / 1000)));
  }

  timestamps.push(now);
  writeTenantLookupState({ timestamps, cooldownUntil: 0 });
};

export const getTenantLookupCooldownRemainingMs = () => {
  const now = Date.now();
  const state = readTenantLookupState();
  return Math.max(0, state.cooldownUntil - now);
};
