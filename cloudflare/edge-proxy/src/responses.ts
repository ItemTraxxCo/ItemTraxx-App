import { RATE_LIMIT_RETRY_AFTER_SECONDS } from "./constants.ts";

export const buildError = (
  status: number,
  message: string,
  headers: Record<string, string>,
  requestId: string,
  extraHeaders?: Headers,
) => {
  const responseHeaders = extraHeaders ? new Headers(extraHeaders) : new Headers();
  Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
  responseHeaders.set("Content-Type", "application/json");
  responseHeaders.set("x-request-id", requestId);
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: responseHeaders,
  });
};

export const buildSessionRateLimitError = (
  failure: "rate_limited" | "unavailable",
  headers: Record<string, string>,
  requestId: string,
) => {
  const responseHeaders = new Headers();
  if (failure === "rate_limited") {
    responseHeaders.set("Retry-After", RATE_LIMIT_RETRY_AFTER_SECONDS.toString());
    return buildError(429, "Too many session requests", headers, requestId, responseHeaders);
  }
  return buildError(503, "Session protection unavailable", headers, requestId);
};

export const buildJson = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  requestId: string,
  extraHeaders?: Headers,
) => {
  const responseHeaders = extraHeaders ? new Headers(extraHeaders) : new Headers();
  Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
  responseHeaders.set("Content-Type", "application/json");
  responseHeaders.set("x-request-id", requestId);
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
};
