import {
  appendSetCookies,
  clearLegacySessionCookies,
  parseCookies,
} from "./cookies.ts";
import {
  getFunctionRequestBodyLimit,
  readBoundedRequestBody,
  RequestBodyLimitError,
} from "./requestBody.ts";
import { sanitizeRequestHeaders } from "./requestHeaders.ts";
import { buildError } from "./responses.ts";
import { getSupabaseAccessToken } from "./auth.ts";
import { applyTrustedIngressHeaders } from "./trustedIngress.ts";
import { enforcePublicRequestLimit } from "./publicRequestRateLimit.ts";
import { trimTrailingSlash } from "./url.ts";

const PUBLIC_FUNCTIONS = new Set([
  "system-status",
  "checkout-borrower-lookup",
  "contact-sales-submit",
  "contact-support-submit",
  "client-error-report",
  "consent-record",
  "workspace-invitation",
  "account-email-change",
]);

export const proxyFunctionRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  functionName: string,
) => {
  const cookies = parseCookies(request);
  const supabaseFunctionUrl = `${
    trimTrailingSlash(env.SUPABASE_URL)
  }/functions/v1/${functionName}`;
  const isSystemStatusGet = functionName === "system-status" &&
    request.method === "GET";
  const publicPostRoutes = new Set([
    "contact-sales-submit",
    "contact-support-submit",
    "client-error-report",
    "consent-record",
    "workspace-invitation",
    "account-email-change",
  ]);
  if (publicPostRoutes.has(functionName) && request.method === "POST") {
    const admitted = await enforcePublicRequestLimit(
      env.PUBLIC_SUBMISSION_RATE_LIMITER,
      request,
      functionName,
    );
    if (!admitted.allowed) {
      return buildError(
        admitted.unavailable ? 503 : 429,
        admitted.unavailable
          ? "Public request admission is unavailable"
          : "Too many requests",
        headers,
        requestId,
      );
    }
  }
  if (isSystemStatusGet) {
    const admitted = await enforcePublicRequestLimit(
      env.PUBLIC_STATUS_RATE_LIMITER,
      request,
      functionName,
    );
    if (!admitted.allowed) {
      return buildError(
        admitted.unavailable ? 503 : 429,
        admitted.unavailable
          ? "Public request admission is unavailable"
          : "Too many requests",
        headers,
        requestId,
      );
    }
  }
  let requestBody: Uint8Array | null = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      requestBody = await readBoundedRequestBody(
        request,
        getFunctionRequestBodyLimit(functionName),
      );
    } catch (error) {
      if (error instanceof RequestBodyLimitError) {
        return buildError(error.status, error.message, headers, requestId);
      }
      throw error;
    }
  }
  let invocationCount = 0;
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
      body: (requestBody
        ? invocationCount++ === 0 ? requestBody : requestBody.slice()
        : undefined) as BodyInit | undefined,
    });
  };

  const betterAuthToken = await getSupabaseAccessToken(request, env).catch(() => null);
  if (!betterAuthToken && !PUBLIC_FUNCTIONS.has(functionName)) {
    return buildError(401, "Authentication required", headers, requestId);
  }
  let upstreamResponse: Response;
  try {
    upstreamResponse = await invoke(betterAuthToken);
  } catch (error) {
    throw error;
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  Object.entries(headers).forEach(([key, value]) =>
    responseHeaders.set(key, value)
  );
  responseHeaders.set("x-request-id", requestId);
  if (cookies.legacyCookiePresent) {
    const migrationHeaders = new Headers();
    clearLegacySessionCookies(migrationHeaders, env);
    appendSetCookies(responseHeaders, migrationHeaders);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
};
