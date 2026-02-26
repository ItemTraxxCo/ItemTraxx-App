type EdgeFunctionOptions<TBody> = {
  method?: "GET" | "POST";
  body?: TBody;
  accessToken?: string;
};

type EdgeFunctionResult<TData> = {
  ok: boolean;
  status: number;
  data: TData | null;
  error: string;
  requestId?: string;
};
import { supabase } from "./supabaseClient";
import { clearAdminVerification, clearAuthState } from "../store/authState";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getDirectFunctionsBaseUrl = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) {
    return "";
  }
  return `${trimTrailingSlash(supabaseUrl)}/functions/v1`;
};

export const getEdgeFunctionsBaseUrl = () => {
  const proxyUrl = import.meta.env.VITE_EDGE_PROXY_URL as string | undefined;
  if (proxyUrl?.trim()) {
    return `${trimTrailingSlash(proxyUrl)}/functions`;
  }
  return getDirectFunctionsBaseUrl();
};

const getDefaultHeaders = (accessToken?: string) => {
  const headers: Record<string, string> = {};
  const proxyUrl = import.meta.env.VITE_EDGE_PROXY_URL as string | undefined;
  const isUsingProxy = !!proxyUrl?.trim();

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (!isUsingProxy) {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (anonKey) {
      headers.apikey = anonKey;
      if (!accessToken && !anonKey.startsWith("sb_publishable_")) {
        headers.Authorization = `Bearer ${anonKey}`;
      }
    }
  }

  return headers;
};

const createRequestId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `itx-${Date.now()}-${Math.floor(performance.now() * 1000)}`;
};

const EDGE_FUNCTION_TIMEOUT_MS = 10000;

const isInvalidJwtError = (payload: unknown) => {
  const parsed = payload as { error?: string; message?: string } | null;
  const message = (parsed?.error ?? parsed?.message ?? "").toLowerCase();
  return message.includes("invalid jwt");
};

const isTenantDisabledError = (payload: unknown) => {
  const parsed = payload as { error?: string; message?: string } | null;
  const message = (parsed?.error ?? parsed?.message ?? "").toLowerCase();
  return message.includes("tenant disabled");
};

const requestEdgeFunction = async <TData = unknown, TBody = unknown>(
  functionName: string,
  options: EdgeFunctionOptions<TBody>,
  accessTokenOverride?: string,
  baseUrlOverride?: string
) => {
  const baseUrl = baseUrlOverride ?? getEdgeFunctionsBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: "Missing configuration.",
    };
  }

  const method = options.method ?? "POST";
  const headers = getDefaultHeaders(accessTokenOverride ?? options.accessToken);
  headers["x-request-id"] = createRequestId();
  const init: RequestInit = { method, headers };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), EDGE_FUNCTION_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/${functionName}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    const payload = parsed as { error?: string; message?: string } | null;
    const requestId = response.headers.get("x-request-id") ?? headers["x-request-id"];

    if (!response.ok) {
      if (isTenantDisabledError(payload)) {
        await supabase.auth.signOut();
        clearAdminVerification();
        clearAuthState(true);
      }
      return {
        ok: false,
        status: response.status,
        data: null,
        error: payload?.error || payload?.message || "Request failed.",
        requestId,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: (parsed as TData) ?? null,
      error: "",
      requestId,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        status: 0,
        data: null,
        error: "Request timed out. Please try again.",
        requestId: headers["x-request-id"],
      };
    }
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Network request failed.",
      requestId: headers["x-request-id"],
    };
  }
};

export const invokeEdgeFunction = async <TData = unknown, TBody = unknown>(
  functionName: string,
  options: EdgeFunctionOptions<TBody> = {}
): Promise<EdgeFunctionResult<TData>> => {
  const first = await requestEdgeFunction<TData, TBody>(functionName, options);
  const method = options.method ?? "POST";

  if (
    method === "GET" &&
    first.status === 0 &&
    first.error.toLowerCase().includes("timed out")
  ) {
    return requestEdgeFunction<TData, TBody>(functionName, options);
  }

  if (
    first.status === 401 &&
    isInvalidJwtError({ error: first.error }) &&
    options.accessToken
  ) {
    // Retry once with a freshly refreshed session token.
    const { data, error } = await supabase.auth.refreshSession();
    const refreshedToken = data.session?.access_token;
    if (!error && refreshedToken) {
      return requestEdgeFunction<TData, TBody>(
        functionName,
        options,
        refreshedToken
      );
    }
  }

  // If proxy rejects a valid user call with Invalid JWT, retry direct Supabase endpoint once.
  // This isolates worker header/forwarding mismatches without breaking tenant/admin flows.
  const usingProxy = !!(import.meta.env.VITE_EDGE_PROXY_URL as string | undefined)?.trim();
  if (
    usingProxy &&
    functionName.startsWith("super-") &&
    first.status === 401 &&
    isInvalidJwtError({ error: first.error })
  ) {
    const directBaseUrl = getDirectFunctionsBaseUrl();
    if (directBaseUrl) {
      const refreshed = await supabase.auth.refreshSession();
      const fallbackToken =
        refreshed.data.session?.access_token ?? options.accessToken;
      return requestEdgeFunction<TData, TBody>(
        functionName,
        options,
        fallbackToken,
        directBaseUrl
      );
    }
  }

  return first;
};
