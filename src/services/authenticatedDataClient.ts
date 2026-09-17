import { AppError, unauthorizedError } from "./appErrors";
import { captureHandledRequestFailure, capturePostHogLog } from "./posthogDiagnostics";
import { fetchWithTransientRetry } from "./fetchWithTransientRetry";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getProxyOrigin = () => {
  const proxyUrl = (import.meta.env.VITE_EDGE_PROXY_URL as string | undefined)?.trim();
  if (!proxyUrl) {
    return "";
  }
  try {
    return new URL(proxyUrl).origin;
  } catch {
    return trimTrailingSlash(proxyUrl);
  }
};

const getBaseUrl = () => {
  const origin = getProxyOrigin();
  if (!import.meta.env.DEV && origin) {
    return origin;
  }
  if (!import.meta.env.DEV) {
    return "";
  }
  if (!origin) {
    throw new Error("Missing edge proxy config for authenticated data requests. Please contact support.");
  }
  return origin;
};

type AuthenticatedRequestOptions = {
  suppressUnauthorizedRecovery?: boolean;
};

const sanitizePathForTelemetry = (path: string) =>
  path.replace(/[?#].*$/, "");

const request = async (
  path: string,
  init: RequestInit = {},
  options: AuthenticatedRequestOptions = {}
) => {
  const method = (init.method ?? "GET").toUpperCase();
  const startedAt = performance.now();
  let response: Response;
  let retryCount = 0;
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(method !== "GET" && method !== "HEAD"
        ? { "x-itx-data-request": "1" }
        : {}),
      ...(init.headers ?? {}),
    },
  };
  try {
    response = await fetchWithTransientRetry(`${getBaseUrl()}${path}`, requestInit, {
      onRetry: (count) => {
        retryCount = count;
      },
    });
  } catch (error) {
    const isAbortError = typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError";
    const errorCode = isAbortError ? "timeout" : "network";
    const route = sanitizePathForTelemetry(path);
    void captureHandledRequestFailure({
      area: "authenticated_data",
      name: route,
      path: route,
      method,
      status: 0,
      message: isAbortError ? "Authenticated data request timed out before response." : "Authenticated data request failed before response.",
      errorCode,
    });
    capturePostHogLog({
      body: "authenticated data request failed before response",
      level: "error",
      attributes: {
        route,
        operation: `${method} ${route}`,
        status: 0,
        latency_ms: Math.round(performance.now() - startedAt),
        retry_count: retryCount,
        attempt: retryCount + 1,
        error_code: errorCode,
      },
    });
    throw error;
  }

  if (!response.ok) {
    let message = `Whoops! Authenticated data request failed (${response.status}).`;
    try {
      const text = await response.text();
      if (text.trim()) {
        const parsed = JSON.parse(text) as { message?: string; error?: string; code?: string };
        message = parsed.message?.trim() || parsed.error?.trim() || message;
      }
    } catch {
      // Keep the fallback message when the error body is empty or non-JSON.
    }
    void captureHandledRequestFailure({
      area: "authenticated_data",
      name: sanitizePathForTelemetry(path),
      path: sanitizePathForTelemetry(path),
      method: init.method ?? "GET",
      status: response.status,
      message,
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
    capturePostHogLog({
      body: "authenticated data request completed",
      level: response.status >= 500 ? "error" : "warn",
      attributes: {
        route: sanitizePathForTelemetry(path),
        operation: `${method} ${sanitizePathForTelemetry(path)}`,
        status: response.status,
        latency_ms: Math.round(performance.now() - startedAt),
        request_id: response.headers.get("x-request-id") ?? undefined,
        retry_count: retryCount,
        attempt: retryCount + 1,
        error_code: response.status >= 500 ? "server_error" : "request_failed",
      },
    });
    if (response.status === 401) {
      if (options.suppressUnauthorizedRecovery) {
        throw new AppError("UNAUTHORIZED", "Your session has expired. Please sign in again.", {
          status: 401,
          reportToErrorTracking: false,
        });
      }
      throw unauthorizedError();
    }
    if (response.status === 403 && /permission denied/i.test(message)) {
      if (options.suppressUnauthorizedRecovery) {
        throw new AppError("UNAUTHORIZED", "Your session has expired. Please sign in again.", {
          status: 403,
          reportToErrorTracking: false,
        });
      }
      throw unauthorizedError();
    }
    throw new AppError("REQUEST_FAILED", message, {
      status: response.status,
      reportToErrorTracking: response.status >= 500,
    });
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  if (latencyMs >= 1500 || Math.random() < 0.01) {
    capturePostHogLog({
      body: "authenticated data request completed",
      level: latencyMs >= 1500 ? "warn" : "info",
      attributes: {
        route: sanitizePathForTelemetry(path),
        operation: `${method} ${sanitizePathForTelemetry(path)}`,
        status: response.status,
        latency_ms: latencyMs,
        request_id: response.headers.get("x-request-id") ?? undefined,
        retry_count: retryCount,
        attempt: retryCount + 1,
      },
    });
  }

  return response;
};

const requestJson = async <TData>(
  path: string,
  init: RequestInit = {},
  options: AuthenticatedRequestOptions = {}
) => {
  const response = await request(path, init, options);
  if (response.status === 204) {
    return null as TData;
  }
  const text = await response.text();
  if (!text.trim()) {
    return null as TData;
  }
  return JSON.parse(text) as TData;
};

export const authenticatedSelect = async <TData>(
  table: string,
  query: Record<string, string>,
  options: {
    prefer?: string;
    method?: "GET" | "HEAD";
    suppressUnauthorizedRecovery?: boolean;
  } = {}
) => {
  const search = new URLSearchParams(query);
  const headers: Record<string, string> = {};
  if (options.prefer) {
    headers.Prefer = options.prefer;
  }
  return requestJson<TData>(
    `/rest/v1/${table}?${search.toString()}`,
    {
      method: options.method ?? "GET",
      headers,
    },
    { suppressUnauthorizedRecovery: options.suppressUnauthorizedRecovery }
  );
};

export type AuthenticatedPage<TData> = {
  rows: TData[];
  hasMore: boolean;
};

/**
 * Read one bounded PostgREST page. The extra sentinel row lets callers know
 * whether another page exists without downloading an unbounded relation or
 * relying on an exact-count query for every navigation.
 */
export const authenticatedSelectPage = async <TData>(
  table: string,
  query: Record<string, string>,
  options: {
    page?: number;
    pageSize?: number;
    prefer?: string;
    suppressUnauthorizedRecovery?: boolean;
  } = {},
): Promise<AuthenticatedPage<TData>> => {
  const page = Number.isFinite(options.page)
    ? Math.max(0, Math.floor(options.page!))
    : 0;
  const pageSize = Number.isFinite(options.pageSize)
    ? Math.min(500, Math.max(1, Math.floor(options.pageSize!)))
    : 20;
  const rows = await authenticatedSelect<TData[]>(table, {
    ...query,
    limit: String(pageSize + 1),
    offset: String(page * pageSize),
  }, options);
  const normalizedRows = Array.isArray(rows) ? rows : [];
  return {
    rows: normalizedRows.slice(0, pageSize),
    hasMore: normalizedRows.length > pageSize,
  };
};

export const authenticatedInsert = async <TData>(
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
  options: { prefer?: string } = {}
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.prefer) {
    headers.Prefer = options.prefer;
  }
  return requestJson<TData>(`/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
};

export const authenticatedRpc = async <TData>(
  fn: string,
  payload: Record<string, unknown>,
  options: AuthenticatedRequestOptions = {}
) => {
  return requestJson<TData>(
    `/rpc/${fn}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    options
  );
};
