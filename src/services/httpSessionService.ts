import { captureHandledRequestFailure } from "./sentry";

export type HttpSessionSummary = {
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
    last_sign_in_at: string | null;
  } | null;
  profile: {
    role: "tenant_account" | "workspace_admin" | "super_admin" | null;
    workspace_id: string | null;
    auth_email: string | null;
    is_active: boolean | null;
  } | null;
  password_authenticated_at?: string | null;
};

/**
 * A session request that never reached the server: the browser is offline, DNS
 * or TLS failed, an extension or corporate proxy blocked the cross-origin call
 * to the edge proxy, or the proxy is simply unreachable from a dev machine.
 *
 * This is deliberately distinct from `Session request failed (<status>).`, which
 * means the server answered and refused. Callers use the distinction to decide
 * whether retrying is worthwhile and whether the failure is worth an error-level
 * log — an unreachable session service is an environment condition, not a bug.
 */
export class SessionNetworkError extends Error {
  readonly action: string;
  readonly cause?: unknown;

  constructor(action: string, cause?: unknown) {
    super(`Unable to reach the ItemTraxx session service (${action}).`);
    this.name = "SessionNetworkError";
    this.action = action;
    this.cause = cause;
  }
}

export const isSessionNetworkError = (error: unknown): error is SessionNetworkError =>
  error instanceof SessionNetworkError;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getEdgeProxyOrigin = () => {
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

const getHttpSessionBaseUrl = () => {
  const proxyOrigin = getEdgeProxyOrigin();
  if (!import.meta.env.DEV && proxyOrigin) {
    return `${proxyOrigin}/auth/session`;
  }
  if (!import.meta.env.DEV) {
    return "/auth/session";
  }
  if (proxyOrigin) {
    return `${proxyOrigin}/auth/session`;
  }

  return "/auth/session";
};

const requestHttpSession = async <TData>(
  action: string,
  init?: RequestInit
): Promise<TData> => {
  const isMutation = (init?.method ?? "GET").toUpperCase() !== "GET";
  let response: Response;
  try {
    response = await fetch(`${getHttpSessionBaseUrl()}/${action}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(isMutation ? { "x-itx-session-request": "1" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    // The request never reached the edge proxy, so there is no status to report
    // and nothing for Sentry to act on. Re-throw as a typed transport failure so
    // callers can retry or degrade quietly instead of treating a flaky network
    // as an application error.
    throw new SessionNetworkError(action, error);
  }

  if (!response.ok) {
    const message = `Session request failed (${response.status}).`;
    void captureHandledRequestFailure({
      area: "http_session",
      name: action,
      path: `/auth/session/${action}`,
      method: init?.method ?? "GET",
      status: response.status,
      message,
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
    throw new Error(message);
  }

  return (await response.json()) as TData;
};

export const fetchHttpSessionSummary = async (options: Pick<RequestInit, "signal"> = {}) =>
  requestHttpSession<HttpSessionSummary>("me", { method: "GET", ...options });

export const exchangeHttpSession = async (payload: {
  access_token: string;
  refresh_token: string;
}) =>
  requestHttpSession<HttpSessionSummary>("exchange", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const clearHttpSession = async () =>
  requestHttpSession<{ ok: boolean }>("logout", { method: "POST", body: JSON.stringify({}) });
