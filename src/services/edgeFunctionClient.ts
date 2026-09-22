type EdgeFunctionOptions<TBody> = {
  method?: "GET" | "POST";
  body?: TBody;
  accessToken?: string;
  preserveErrorData?: boolean;
  /**
   * Use a CORS-simple request for cookie-authenticated endpoints. This avoids
   * an OPTIONS preflight being challenged by an upstream WAF. The Worker still
   * generates and signs its own request id and enforces the origin, session,
   * and authorization checks. This is enabled by default for cookie requests;
   * set it to false only for an endpoint that explicitly requires a custom
   * request header or JSON content type.
   */
  avoidCorsPreflight?: boolean;
};

type EdgeFunctionResult<TData> = {
  ok: boolean;
  status: number;
  data: TData | null;
  error: string;
  requestId?: string;
};
import { clearAdminVerification, clearAuthState } from "../store/authState";
import { getEdgeFunctionsBaseUrl } from "./edgeUrls";
import { captureHandledRequestFailure, capturePostHogLog } from "./posthogDiagnostics";
import { createRequestId } from "./requestId";

const getDefaultHeaders = (accessToken?: string) => {
  const headers: Record<string, string> = {};

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
};

const EDGE_FUNCTION_TIMEOUT_MS = 10000;
const isTenantDisabledError = (payload: unknown) => {
  const parsed = payload as { error?: string; message?: string } | null;
  const message = (parsed?.error ?? parsed?.message ?? "").toLowerCase();
  return message.includes("workspace disabled") || message.includes("tenant disabled");
};

const requestEdgeFunction = async <TData = unknown, TBody = unknown>(
  functionName: string,
  options: EdgeFunctionOptions<TBody>,
  accessTokenOverride?: string,
  baseUrlOverride?: string,
  retryCount = 0,
) => {
  const baseUrl = baseUrlOverride ?? getEdgeFunctionsBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: "Missing configuration. Please contact support.",
    };
  }

  const method = options.method ?? "POST";
  const accessToken = accessTokenOverride ?? options.accessToken;
  const useSimpleCorsRequest = Boolean(
    !accessToken && options.avoidCorsPreflight !== false,
  );
  const headers = getDefaultHeaders(accessToken);
  const requestId = createRequestId();
  const startedAt = performance.now();
  if (!useSimpleCorsRequest) headers["x-request-id"] = requestId;
  const requestUrl = new URL(`${baseUrl}/${functionName}`, window.location.origin);
  if (useSimpleCorsRequest) {
    // Query parameters preserve CORS-simple requests while correlating the
    // browser failure with the edge proxy's request logs.
    requestUrl.searchParams.set("itx_request_id", requestId);
  }
  const fetchUrl = baseUrl.startsWith("/")
    ? `${requestUrl.pathname}${requestUrl.search}`
    : requestUrl.toString();
  const init: RequestInit = { method, headers };

  if (options.body !== undefined && method !== "GET") {
    // `text/plain` is a CORS-safelisted content type. The Worker and the
    // function both parse the body as JSON bytes, so this changes only the
    // browser preflight behavior, not the request contract.
    headers["Content-Type"] = useSimpleCorsRequest
      ? "text/plain;charset=UTF-8"
      : "application/json";
    init.body = JSON.stringify(options.body);
  }

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), EDGE_FUNCTION_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(fetchUrl, {
        ...init,
        credentials: "include",
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
    const responseRequestId = response.headers.get("x-request-id") ??
      headers["x-request-id"] ?? requestId;
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      if (isTenantDisabledError(payload)) {
        await import("../auth/client")
          .then(({ authClient }) => authClient.signOut())
          .catch(() => undefined);
        clearAdminVerification();
        clearAuthState(true);
      }
      const errorMessage = payload?.error || payload?.message || "Request failed. Please try again.";
      void captureHandledRequestFailure({
        area: "edge_function",
        name: functionName,
        path: `/functions/${functionName}`,
        method,
        status: response.status,
        message: errorMessage,
        requestId: responseRequestId,
      });
      capturePostHogLog({
        body: "edge function request completed",
        level: response.status >= 500 ? "error" : "warn",
        attributes: {
          route: `/functions/${functionName}`,
          operation: `${method} ${functionName}`,
          status: response.status,
          latency_ms: latencyMs,
          request_id: responseRequestId,
          retry_count: retryCount,
          attempt: retryCount + 1,
          error_code: response.status >= 500 ? "server_error" : "request_failed",
        },
      });
      return {
        ok: false,
        status: response.status,
        data: options.preserveErrorData ? (parsed as TData) : null,
        error: errorMessage,
        requestId: responseRequestId,
      };
    }

    if (latencyMs >= 1500 || Math.random() < 0.01) {
      capturePostHogLog({
        body: "edge function request completed",
        level: latencyMs >= 1500 ? "warn" : "info",
        attributes: {
          route: `/functions/${functionName}`,
          operation: `${method} ${functionName}`,
          status: response.status,
          latency_ms: latencyMs,
          request_id: responseRequestId,
          retry_count: retryCount,
          attempt: retryCount + 1,
        },
      });
    }

    return {
      ok: true,
      status: response.status,
      data: (parsed as TData) ?? null,
      error: "",
      requestId: responseRequestId,
    };
  } catch (error) {
    const isAbortError = typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError";
    const errorCode = isAbortError ? "timeout" : "network";
    void captureHandledRequestFailure({
      area: "edge_function",
      name: functionName,
      path: `/functions/${functionName}`,
      method,
      status: 0,
      message: isAbortError ? "Request timed out before response." : "Network request failed before response.",
      errorCode,
      requestId,
    });
    capturePostHogLog({
      body: "edge function request failed before response",
      level: "error",
      attributes: {
        route: `/functions/${functionName}`,
        operation: `${method} ${functionName}`,
        status: 0,
        latency_ms: Math.round(performance.now() - startedAt),
        request_id: requestId,
        retry_count: retryCount,
        attempt: retryCount + 1,
        error_code: errorCode,
      },
    });
    if (isAbortError) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: "Request timed out. Please try again.",
        requestId,
      };
    }
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Network request failed.",
      requestId,
    };
  }
};

export const invokeEdgeFunction = async <TData = unknown, TBody = unknown>(
  functionName: string,
  options: EdgeFunctionOptions<TBody> = {}
): Promise<EdgeFunctionResult<TData>> => {
  let current = await requestEdgeFunction<TData, TBody>(functionName, options);
  const method = options.method ?? "POST";

  if (
    method === "GET" &&
    current.status === 0 &&
    current.error.toLowerCase().includes("timed out")
  ) {
    return requestEdgeFunction<TData, TBody>(functionName, options, undefined, undefined, 1);
  }

  return current;
};
