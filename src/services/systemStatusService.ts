import { getEdgeFunctionsBaseUrl } from "./edgeUrls";
import { fetchWithTransientRetry } from "./fetchWithTransientRetry";
import { captureHandledRequestFailure, capturePostHogLog } from "./posthogDiagnostics";
import { createRequestId } from "./requestId";

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

type SystemStatusResponse = {
  ok: boolean;
  status: number;
  payload: SystemStatusPayload;
};

const STATUS_FUNCTION_NAME = import.meta.env.VITE_STATUS_FUNCTION || "system-status";
const STATUS_CACHE_TTL_MS = 10_000;
const statusRoute = () => `/functions/${STATUS_FUNCTION_NAME}`;
const withRequestId = (functionsBaseUrl: string, requestId: string) => {
  const requestUrl = new URL(
    `${functionsBaseUrl}/${STATUS_FUNCTION_NAME}`,
    window.location.origin,
  );
  requestUrl.searchParams.set("itx_request_id", requestId);
  return functionsBaseUrl.startsWith("/")
    ? `${requestUrl.pathname}${requestUrl.search}`
    : requestUrl.toString();
};

const isAbortError = (error: unknown) =>
  typeof DOMException !== "undefined" &&
  error instanceof DOMException &&
  error.name === "AbortError";

let cachedResult: SystemStatusResponse | null = null;
let cachedAtMs = 0;
let pendingRequest: Promise<SystemStatusResponse | null> | null = null;

const fetchAndCacheSystemStatus = async (timeoutMs: number) => {
  const functionsBaseUrl = getEdgeFunctionsBaseUrl();
  if (!functionsBaseUrl) {
    return null;
  }

  // This is the unauthenticated health path. Keep it independent from
  // invokeEdgeFunction so it can report edge reachability when authenticated
  // dispatch is unavailable; check-edge-function-coverage explicitly permits
  // this one direct fetch.
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  const requestId = createRequestId();
  const requestUrl = withRequestId(functionsBaseUrl, requestId);
  try {
    const response = await fetchWithTransientRetry(requestUrl, {
      method: "GET",
      signal: controller.signal,
    });
    const responseRequestId = response.headers.get("x-request-id") ?? requestId;
    const payload = (await response.json().catch(() => ({}))) as SystemStatusPayload;
    const result: SystemStatusResponse = {
      ok: response.ok,
      status: response.status,
      payload,
    };
    if (!response.ok) {
      const route = statusRoute();
      void captureHandledRequestFailure({
        area: "edge_function",
        name: STATUS_FUNCTION_NAME,
        path: route,
        method: "GET",
        status: response.status,
        message: `System status request failed (${response.status}).`,
        requestId: responseRequestId,
      });
      capturePostHogLog({
        body: "system status request completed",
        level: response.status >= 500 ? "error" : "warn",
        attributes: {
          route,
          operation: `GET ${route}`,
          status: response.status,
          latency_ms: Math.round(performance.now() - startedAt),
          request_id: responseRequestId,
          error_code: response.status >= 500 ? "server_error" : "request_failed",
        },
      });
    }
    cachedResult = result;
    cachedAtMs = Date.now();
    return result;
  } catch (error) {
    const errorCode = isAbortError(error) ? "timeout" : "network";
    const route = statusRoute();
    void captureHandledRequestFailure({
      area: "edge_function",
      name: STATUS_FUNCTION_NAME,
      path: route,
      method: "GET",
      status: 0,
      message: isAbortError(error) ? "System status request timed out before response." : "System status request failed before response.",
      errorCode,
      requestId,
    });
    capturePostHogLog({
      body: "system status request failed before response",
      level: "error",
      attributes: {
        route,
        operation: `GET ${route}`,
        status: 0,
        latency_ms: Math.round(performance.now() - startedAt),
        request_id: requestId,
        error_code: errorCode,
      },
    });
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

/**
 * Check whether the edge host can be reached without requiring a CORS
 * response. A managed edge challenge can reject a normal browser fetch before
 * application code sees the HTTP status; a no-cors request still distinguishes
 * that reachable edge from an actual network outage.
 */
export const probeSystemStatusTransport = async (timeoutMs = 3500) => {
  const functionsBaseUrl = getEdgeFunctionsBaseUrl();
  if (!functionsBaseUrl) return false;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const requestId = createRequestId();
  try {
    await fetch(withRequestId(functionsBaseUrl, requestId), {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch (error) {
    const errorCode = isAbortError(error) ? "timeout" : "network";
    const route = statusRoute();
    void captureHandledRequestFailure({
      area: "edge_function",
      name: STATUS_FUNCTION_NAME,
      path: route,
      method: "GET",
      status: 0,
      message: isAbortError(error) ? "System status transport probe timed out." : "System status transport probe failed.",
      errorCode,
      requestId,
    });
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
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
