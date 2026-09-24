import { createAuthClient } from "better-auth/client";
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { dashClient, sentinelClient } from "@better-auth/infra/client";
import { globalAccess, globalRoles, organizationAccess, organizationRoles } from "./permissions";
import { fetchWithTransientRetry } from "../services/fetchWithTransientRetry";
import { captureHandledRequestFailure, capturePostHogLog } from "../services/posthogDiagnostics";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const configuredOrigin = (import.meta.env.VITE_EDGE_PROXY_URL as string | undefined)?.trim();
const baseURL = configuredOrigin ? trimTrailingSlash(configuredOrigin) : window.location.origin;
const sentinelIdentifyUrl = import.meta.env.VITE_BETTER_AUTH_IDENTIFY_URL?.trim() ||
  "https://kv.better-auth.com/projects/sigITsymX5OlVKCKgvuvKTOnjHJOF6p8";

// Session reads are idempotent and a Cloudflare managed challenge is exposed
// to browser JavaScript as a rejected CORS fetch. Retry that transport once so
// a transient challenge does not make a valid login look unauthenticated.
const getAuthRequestPath = (input: string | URL | Request) => {
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
    ? input.toString()
    : input.url;
  try {
    return new URL(rawUrl, window.location.origin).pathname;
  } catch {
    return rawUrl.replace(/[?#].*$/, "");
  }
};

const getAuthRequestMethod = (input: string | URL | Request, init?: RequestInit) =>
  (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET"))
    .toUpperCase();

const authFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const path = getAuthRequestPath(input);
  const method = getAuthRequestMethod(input, init);
  const startedAt = performance.now();
  let retryCount = 0;
  try {
    const response = await fetchWithTransientRetry(input, init, {
      onRetry: (count) => {
        retryCount = count;
      },
    });
    if (!response.ok) {
      void captureHandledRequestFailure({
        area: "http_session",
        name: path,
        path,
        method,
        status: response.status,
        message: `Authentication request failed (${response.status}).`,
        ...(response.status >= 500 ? { errorCode: "server_error" as const } : {}),
        requestId: response.headers?.get("x-request-id") ?? undefined,
      });
      capturePostHogLog({
        body: "authentication request completed",
        level: response.status >= 500 ? "error" : "warn",
        attributes: {
          route: path,
          operation: `${method} ${path}`,
          status: response.status,
          latency_ms: Math.round(performance.now() - startedAt),
          request_id: response.headers?.get("x-request-id") ?? undefined,
          retry_count: retryCount,
          attempt: retryCount + 1,
          error_code: response.status >= 500 ? "server_error" : "request_failed",
        },
      });
    }
    return response;
  } catch (error) {
    const isAbortError = typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError";
    const errorCode = isAbortError ? "timeout" : "network";
    void captureHandledRequestFailure({
      area: "http_session",
      name: path,
      path,
      method,
      status: 0,
      message: isAbortError ? "Authentication request timed out before response." : "Authentication request failed before response.",
      errorCode,
    });
    capturePostHogLog({
      body: "authentication request failed before response",
      level: "error",
      attributes: {
        route: path,
        operation: `${method} ${path}`,
        status: 0,
        latency_ms: Math.round(performance.now() - startedAt),
        retry_count: retryCount,
        attempt: retryCount + 1,
        error_code: errorCode,
      },
    });
    throw error;
  }
};

export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/auth",
  fetchOptions: { credentials: "include", customFetchImpl: authFetch },
  plugins: [
    organizationClient({ ac: organizationAccess, roles: organizationRoles }),
    adminClient({ ac: globalAccess, roles: globalRoles }),
    passkeyClient(),
    twoFactorClient({
      onTwoFactorRedirect: () => window.location.assign("/login/two-factor"),
    }),
    ssoClient({ domainVerification: { enabled: true } }),
    dashClient(),
    sentinelClient({ identifyUrl: sentinelIdentifyUrl }),
  ],
});
