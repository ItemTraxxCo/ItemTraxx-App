import { MAINTENANCE_FALLBACK_KEY } from "./constants.ts";

export type MaintenanceFallbackPayload = {
  enabled: boolean;
  message: string;
  updated_at: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

export const readMaintenanceFallback = async (env: Env): Promise<MaintenanceFallbackPayload | null> => {
  if (!env.MAINTENANCE_FALLBACK_KV) return null;
  try {
    const cached = await env.MAINTENANCE_FALLBACK_KV.get(MAINTENANCE_FALLBACK_KEY, "json");
    const record = asRecord(cached);
    if (!record || record.enabled !== true) return null;
    if (typeof record.message !== "string" || typeof record.updated_at !== "string") return null;
    return {
      enabled: true,
      message: record.message.trim() || "Maintenance currently in progress.",
      updated_at: record.updated_at,
    };
  } catch {
    return null;
  }
};

export const writeMaintenanceFallback = async (
  env: Env,
  payload: MaintenanceFallbackPayload | null,
) => {
  if (!env.MAINTENANCE_FALLBACK_KV) return;
  try {
    if (!payload) {
      await env.MAINTENANCE_FALLBACK_KV.delete(MAINTENANCE_FALLBACK_KEY);
      return;
    }
    await env.MAINTENANCE_FALLBACK_KV.put(MAINTENANCE_FALLBACK_KEY, JSON.stringify(payload), {
      expirationTtl: 60 * 60 * 24 * 14,
    });
  } catch {
    // best effort only
  }
};

export const clearMaintenanceFallbackIfPresent = async (env: Env) => {
  if (!env.MAINTENANCE_FALLBACK_KV) return;
  try {
    const existing = await env.MAINTENANCE_FALLBACK_KV.get(MAINTENANCE_FALLBACK_KEY);
    if (existing === null) return;
    await env.MAINTENANCE_FALLBACK_KV.delete(MAINTENANCE_FALLBACK_KEY);
  } catch {
    // best effort only
  }
};

export const extractMaintenanceFromStatusPayload = (
  payload: Record<string, unknown>,
): MaintenanceFallbackPayload | null => {
  const maintenance = asRecord(payload.maintenance);
  if (!maintenance) return null;
  if (maintenance.enabled !== true) {
    return { enabled: false, message: "", updated_at: new Date().toISOString() };
  }
  return {
    enabled: true,
    message:
      typeof maintenance.message === "string" && maintenance.message.trim()
        ? maintenance.message.trim()
        : "Maintenance currently in progress.",
    updated_at:
      typeof maintenance.updated_at === "string" && maintenance.updated_at.trim()
        ? maintenance.updated_at
        : new Date().toISOString(),
  };
};

export const applyMaintenanceFallbackToStatusPayload = async (
  env: Env,
  upstreamStatusCode: number,
  payload: Record<string, unknown>,
) => {
  const extracted = extractMaintenanceFromStatusPayload(payload);
  if (extracted?.enabled === true) {
    await writeMaintenanceFallback(env, extracted);
    return payload;
  }
  if (extracted?.enabled === false) {
    await clearMaintenanceFallbackIfPresent(env);
  }

  const status = typeof payload.status === "string" ? payload.status : "";
  const checks = asRecord(payload.checks);
  const dbFailed = checks?.db === "failed";
  const shouldFallback = upstreamStatusCode >= 500 || status === "down" || dbFailed;
  if (!shouldFallback) return payload;

  const cached = await readMaintenanceFallback(env);
  if (!cached) return payload;
  return {
    ...payload,
    maintenance: cached,
    maintenance_fallback: true,
  };
};
