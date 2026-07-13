import { appendSetCookies, parseCookies } from "./cookies.ts";
import {
  applyMaintenanceFallbackToStatusPayload,
  readMaintenanceFallback,
} from "./maintenanceFallback.ts";
import { sanitizeRequestHeaders } from "./requestHeaders.ts";
import { buildSessionRateLimitError } from "./responses.ts";
import { maybeRefreshSession } from "./session.ts";
import { applyTrustedIngressHeaders } from "./trustedIngress.ts";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const proxyFunctionRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  functionName: string,
) => {
  const cookies = parseCookies(request);
  const supabaseFunctionUrl = `${trimTrailingSlash(env.SUPABASE_URL)}/functions/v1/${functionName}`;
  const isSystemStatusGet = functionName === "system-status" && request.method === "GET";
  const requestBody = request.method === "GET" || request.method === "HEAD"
    ? null
    : new Uint8Array(await request.clone().arrayBuffer());
  const invoke = async (sessionAccessToken?: string | null) => {
    const proxiedHeaders = sanitizeRequestHeaders(
      request,
      env.SUPABASE_ANON_KEY,
      requestId,
      functionName,
      sessionAccessToken,
    );
    await applyTrustedIngressHeaders(
      proxiedHeaders,
      env,
      requestId,
      functionName,
      request.method,
      requestBody,
    );
    return fetch(supabaseFunctionUrl, {
      method: request.method,
      headers: proxiedHeaders,
      body: requestBody ? requestBody.slice() : undefined,
    });
  };

  let upstreamResponse: Response;
  try {
    upstreamResponse = await invoke(cookies.accessToken);
  } catch (error) {
    if (isSystemStatusGet) {
      const cached = await readMaintenanceFallback(env);
      if (cached) {
        const responseHeaders = new Headers();
        Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
        responseHeaders.set("x-request-id", requestId);
        responseHeaders.set("content-type", "application/json");
        return new Response(JSON.stringify({
          status: "down",
          checks: { config: "ok", db: "failed" },
          maintenance: cached,
          maintenance_fallback: true,
          incident_summary: "system status unavailable; maintenance fallback active",
          checked_at: new Date().toISOString(),
        }), { status: 503, headers: responseHeaders });
      }
    }
    throw error;
  }

  let sessionHeaders: Headers | null = null;
  if (!request.headers.get("Authorization") && upstreamResponse.status === 401 && cookies.refreshToken) {
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
  Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
  responseHeaders.set("x-request-id", requestId);
  if (sessionHeaders) appendSetCookies(responseHeaders, sessionHeaders);

  if (isSystemStatusGet) {
    const rawBody = await upstreamResponse.clone().text();
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const withFallback = await applyMaintenanceFallbackToStatusPayload(env, upstreamResponse.status, parsed);
      responseHeaders.set("content-type", "application/json");
      return new Response(JSON.stringify(withFallback), {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    } catch {
      // Preserve the original upstream payload when JSON parsing fails.
    }
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
};
