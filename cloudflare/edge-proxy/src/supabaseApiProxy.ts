import { appendSetCookies, parseCookies } from "./cookies.ts";
import { hasRpcCallerAuth, sanitizeUpstreamHeaders } from "./requestHeaders.ts";
import {
  MAX_PROXY_REQUEST_BODY_BYTES,
  readBoundedRequestBody,
  RequestBodyLimitError,
} from "./requestBody.ts";
import { buildError, buildSessionRateLimitError } from "./responses.ts";
import {
  isBlockedRpcProxyPath,
  isRpcProxyPath,
  isUnauthorizedRpcProxyPath,
} from "./routing.ts";
import { maybeRefreshSession } from "./session.ts";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const proxySupabaseApiRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  upstreamPath: string,
) => {
  const cookies = parseCookies(request);
  if (isBlockedRpcProxyPath(upstreamPath)) {
    return buildError(
      403,
      "RPC proxy access is not allowed",
      headers,
      requestId,
    );
  }
  if (
    isUnauthorizedRpcProxyPath(upstreamPath, hasRpcCallerAuth(request, cookies))
  ) {
    return buildError(401, "Unauthorized", headers, requestId);
  }
  const normalizedUpstreamPath = isRpcProxyPath(upstreamPath)
    ? `/rest/v1${upstreamPath}`
    : upstreamPath;
  const upstreamUrl = `${
    trimTrailingSlash(env.SUPABASE_URL)
  }${normalizedUpstreamPath}${new URL(request.url).search}`;
  let requestBody: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      const bytes = await readBoundedRequestBody(
        request,
        MAX_PROXY_REQUEST_BODY_BYTES,
      );
      requestBody = new TextDecoder().decode(bytes);
    } catch (error) {
      if (error instanceof RequestBodyLimitError) {
        return buildError(error.status, error.message, headers, requestId);
      }
      throw error;
    }
  }
  const invoke = async (sessionAccessToken?: string | null) => {
    const proxiedHeaders = sanitizeUpstreamHeaders(
      request,
      env.SUPABASE_ANON_KEY,
      requestId,
      sessionAccessToken,
    );
    return fetch(upstreamUrl, {
      method: request.method,
      headers: proxiedHeaders,
      body: requestBody,
    });
  };

  let upstreamResponse = await invoke(cookies.accessToken);
  let sessionHeaders: Headers | null = null;
  if (
    !request.headers.get("Authorization") && upstreamResponse.status === 401 &&
    cookies.refreshToken
  ) {
    const refreshed = await maybeRefreshSession(request, env, cookies);
    if (refreshed.failure) {
      return buildSessionRateLimitError(refreshed.failure, headers, requestId);
    }
    sessionHeaders = refreshed.headers;
    if (refreshed.session) {
      upstreamResponse = await invoke(refreshed.session.accessToken);
    }
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  Object.entries(headers).forEach(([key, value]) =>
    responseHeaders.set(key, value)
  );
  responseHeaders.set("x-request-id", requestId);
  if (sessionHeaders) appendSetCookies(responseHeaders, sessionHeaders);
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
};
