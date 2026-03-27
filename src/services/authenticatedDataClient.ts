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
  if (!import.meta.env.DEV) {
    return "";
  }
  const origin = getProxyOrigin();
  if (!origin) {
    throw new Error("Missing edge proxy configuration for authenticated data requests.");
  }
  return origin;
};

const request = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Authenticated data request failed (${response.status}).`);
  }

  return response;
};

const requestJson = async <TData>(path: string, init: RequestInit = {}) => {
  const response = await request(path, init);
  if (response.status === 204) {
    return null as TData;
  }
  return (await response.json()) as TData;
};

export const authenticatedSelect = async <TData>(
  table: string,
  query: Record<string, string>,
  options: { prefer?: string; method?: "GET" | "HEAD" } = {}
) => {
  const search = new URLSearchParams(query);
  const headers: Record<string, string> = {};
  if (options.prefer) {
    headers.Prefer = options.prefer;
  }
  return requestJson<TData>(`/rest/v1/${table}?${search.toString()}`, {
    method: options.method ?? "GET",
    headers,
  });
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
  payload: Record<string, unknown>
) => {
  return requestJson<TData>(`/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
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
