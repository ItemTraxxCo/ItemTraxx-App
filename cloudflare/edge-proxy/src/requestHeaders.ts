import type { SessionCookies } from "./cookies.ts";

export const hasRpcCallerAuth = (request: Request, cookies: SessionCookies) => {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.trim()) {
    return true;
  }
  if (cookies.accessToken || cookies.refreshToken) {
    return true;
  }
  return false;
};

type RequestWithCf = Request & {
  cf?: {
    city?: string;
    region?: string;
    regionCode?: string;
    country?: string;
  };
};

const sanitizeGeoHeaderValue = (value: string | null | undefined, maxLen: number) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};

const applyApproxLocationHeaders = (headers: Headers, request: Request) => {
  const cf = (request as RequestWithCf).cf;
  const city = sanitizeGeoHeaderValue(cf?.city, 80);
  const region = sanitizeGeoHeaderValue(cf?.region ?? cf?.regionCode, 80);
  const country = sanitizeGeoHeaderValue(cf?.country, 80);

  if (city) headers.set("x-itx-geo-city", city);
  if (region) headers.set("x-itx-geo-region", region);
  if (country) headers.set("x-itx-geo-country", country);
};

export const sanitizeRequestHeaders = (
  request: Request,
  anonKey: string,
  requestId: string,
  functionName: string,
  sessionAccessToken?: string | null,
) => {
  const headers = new Headers();
  headers.set("x-request-id", requestId);
  headers.set("apikey", anonKey);
  headers.set("Content-Type", request.headers.get("Content-Type") ?? "application/json");
  const incomingAuth = request.headers.get("Authorization");
  const resolvedAuth = incomingAuth ?? (sessionAccessToken ? `Bearer ${sessionAccessToken}` : null);
  if (functionName === "super-ops" && resolvedAuth) {
    headers.set("x-itx-user-jwt", resolvedAuth);
    headers.set("Authorization", resolvedAuth);
  } else if (resolvedAuth) {
    headers.set("Authorization", resolvedAuth);
  }
  const clientInfo = request.headers.get("x-client-info");
  if (clientInfo) headers.set("x-client-info", clientInfo);
  const userAgent = request.headers.get("user-agent");
  if (userAgent) headers.set("user-agent", userAgent);
  const scanAgentHeader = request.headers.get("aikido-scan-agent");
  if (scanAgentHeader) headers.set("aikido-scan-agent", scanAgentHeader);
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  const connectingIp = request.headers.get("cf-connecting-ip");
  if (connectingIp) headers.set("cf-connecting-ip", connectingIp);
  applyApproxLocationHeaders(headers, request);
  return headers;
};

export const sanitizeUpstreamHeaders = (
  request: Request,
  anonKey: string,
  requestId: string,
  sessionAccessToken?: string | null,
) => {
  const headers = new Headers();
  headers.set("x-request-id", requestId);
  headers.set("apikey", anonKey);
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  const incomingAuth = request.headers.get("Authorization");
  const resolvedAuth = incomingAuth ?? (sessionAccessToken ? `Bearer ${sessionAccessToken}` : null);
  if (resolvedAuth) headers.set("Authorization", resolvedAuth);
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  const prefer = request.headers.get("prefer");
  if (prefer) headers.set("prefer", prefer);
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  return headers;
};
