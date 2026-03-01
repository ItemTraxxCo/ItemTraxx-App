import { getEdgeFunctionsBaseUrl } from "./edgeFunctionClient";

export type SystemStatusPayload = {
  status?: string;
  broadcast?: {
    enabled?: boolean;
    message?: string;
    level?: string;
    updated_at?: string;
  };
  maintenance?: {
    enabled?: boolean;
    message?: string;
    updated_at?: string;
  };
  kill_switch?: {
    enabled?: boolean;
    message?: string;
  };
  incident_summary?: string;
  checked_at?: string;
};

export type SystemStatusResponse = {
  ok: boolean;
  status: number;
  payload: SystemStatusPayload;
};

const STATUS_FUNCTION_NAME = import.meta.env.VITE_STATUS_FUNCTION || "system-status";
const STATUS_CACHE_TTL_MS = 10_000;

let cachedResult: SystemStatusResponse | null = null;
let cachedAtMs = 0;
let pendingRequest: Promise<SystemStatusResponse | null> | null = null;

const fetchAndCacheSystemStatus = async (timeoutMs: number) => {
  const functionsBaseUrl = getEdgeFunctionsBaseUrl();
  if (!functionsBaseUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${functionsBaseUrl}/${STATUS_FUNCTION_NAME}`, {
      method: "GET",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as SystemStatusPayload;
    const result: SystemStatusResponse = {
      ok: response.ok,
      status: response.status,
      payload,
    };
    cachedResult = result;
    cachedAtMs = Date.now();
    return result;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const triggerRevalidate = (timeoutMs: number) => {
  if (pendingRequest) {
    return pendingRequest;
  }
  pendingRequest = (async () => {
    try {
      return await fetchAndCacheSystemStatus(timeoutMs);
    } finally {
      pendingRequest = null;
    }
  })();
  return pendingRequest;
};

export const fetchSystemStatus = async (options: {
  force?: boolean;
  timeoutMs?: number;
  staleWhileRevalidate?: boolean;
} = {}) => {
  const timeoutMs = options.timeoutMs ?? 3500;
  const now = Date.now();
  if (!options.force && cachedResult && now - cachedAtMs < STATUS_CACHE_TTL_MS) {
    return cachedResult;
  }

  if (!options.force && cachedResult && options.staleWhileRevalidate !== false) {
    void triggerRevalidate(timeoutMs);
    return cachedResult;
  }

  return triggerRevalidate(timeoutMs);
};
