export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export const EDGE_PROXY_HEADER = "x-itx-edge-proxy";
export const EDGE_PROXY_TIMESTAMP_HEADER = "x-itx-edge-proxy-ts";
export const EDGE_PROXY_SIGNATURE_HEADER = "x-itx-edge-proxy-signature";
export const EDGE_PROXY_BODY_HASH_HEADER = "x-itx-edge-proxy-body-sha256";

export const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, prefer, x-itx-session-request, x-itx-data-request, x-itx-jit-ticket, x-captcha-response, x-visitor-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Expose-Headers":
    "content-range, content-profile, x-request-id",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none';",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  Vary: "Origin",
};

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://itemtraxx.com",
  "https://www.itemtraxx.com",
  "https://status.itemtraxx.com",
  "https://internal.itemtraxx.com",
  "https://app.itemtraxx.com",
  "https://dennis-dev.itemtraxx.com",
  "https://leo-dev.itemtraxx.com",
  "https://dev.itemtraxx.com",
  "https://preview.itemtraxx.com",
  "https://staging.itemtraxx.com",
  "https://itxdemo.app.itemtraxx.com",
];
