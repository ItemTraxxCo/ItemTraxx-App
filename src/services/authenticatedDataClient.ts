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
    throw new Error("Missing edge proxy configuration for authenticated data requests.");
  }
  return origin;
};

type AuthenticatedRequestOptions = {
  suppressUnauthorizedRecovery?: boolean;
};

const request = async (
  path: string,
  init: RequestInit = {},
  options: AuthenticatedRequestOptions = {}
) => {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Authenticated data request failed (${response.status}).`;
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
      name: path,
      path,
      method: init.method ?? "GET",
      status: response.status,
      message,
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
    if (response.status === 401) {
      if (options.suppressUnauthorizedRecovery) {
        throw new AppError("UNAUTHORIZED", "Your session expired. Sign in again.", {
          status: 401,
          reportToSentry: false,
        });
      }
      throw unauthorizedError();
    }
    if (response.status === 403 && /permission denied/i.test(message)) {
      if (options.suppressUnauthorizedRecovery) {
        throw new AppError("UNAUTHORIZED", "Your session expired. Sign in again.", {
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

export const authenticatedCount = async (table: string, query: Record<string, string>) => {
  const search = new URLSearchParams({ ...query, select: query.select ?? "id" });
  const response = await request(`/rest/v1/${table}?${search.toString()}`, {
    method: "HEAD",
    headers: {
      Prefer: "count=exact",
    },
  });
  const contentRange = response.headers.get("content-range") ?? "";
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) {
    throw new Error("Authenticated count request missing content-range.");
  }
  return Number(match[1]);
};
