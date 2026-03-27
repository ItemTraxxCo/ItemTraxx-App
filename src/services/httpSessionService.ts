export type HttpSessionSummary = {
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
    last_sign_in_at: string | null;
  } | null;
  profile: {
    role: "tenant_user" | "tenant_admin" | "district_admin" | "super_admin" | null;
    tenant_id: string | null;
    district_id: string | null;
    auth_email: string | null;
    is_active: boolean | null;
  } | null;
};

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

export const getHttpSessionBaseUrl = () => {
  if (!import.meta.env.DEV) {
    return "/auth/session";
  }

  const proxyOrigin = getEdgeProxyOrigin();
  if (proxyOrigin) {
    return `${proxyOrigin}/auth/session`;
  }

  return "/auth/session";
};

const requestHttpSession = async <TData>(
  action: string,
  init?: RequestInit
): Promise<TData> => {
  const response = await fetch(`${getHttpSessionBaseUrl()}/${action}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Session request failed (${response.status}).`);
  }

  return (await response.json()) as TData;
};

export const fetchHttpSessionSummary = async () =>
  requestHttpSession<HttpSessionSummary>("me", { method: "GET" });

export const exchangeHttpSession = async (payload: {
  access_token: string;
  refresh_token: string;
}) =>
  requestHttpSession<HttpSessionSummary>("exchange", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const refreshHttpSession = async () =>
  requestHttpSession<HttpSessionSummary>("refresh", { method: "POST" });

export const clearHttpSession = async () =>
  requestHttpSession<{ ok: boolean }>("logout", { method: "POST", body: JSON.stringify({}) });
