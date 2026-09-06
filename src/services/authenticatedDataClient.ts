import { AppError, unauthorizedError } from "./appErrors";
import { captureHandledRequestFailure } from "./sentry";

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
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(method !== "GET" && method !== "HEAD"
        ? { "x-itx-data-request": "1" }
        : {}),
      ...(init.headers ?? {}),
    },
  });

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
    if (response.status === 401) {
      if (options.suppressUnauthorizedRecovery) {
        throw new AppError("UNAUTHORIZED", "Your session has expired. Please sign in again.", {
          status: 401,
          reportToSentry: false,
        });
      }
      throw unauthorizedError();
    }
    if (response.status === 403 && /permission denied/i.test(message)) {
      if (options.suppressUnauthorizedRecovery) {
        throw new AppError("UNAUTHORIZED", "Your session has expired. Please sign in again.", {
          status: 403,
          reportToSentry: false,
        });
      }
      throw unauthorizedError();
    }
    throw new AppError("REQUEST_FAILED", message, {
      status: response.status,
      reportToSentry: response.status >= 500,
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
