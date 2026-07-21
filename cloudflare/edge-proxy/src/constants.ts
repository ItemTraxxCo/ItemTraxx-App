export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export const EDGE_PROXY_HEADER = "x-itx-edge-proxy";
export const EDGE_PROXY_TIMESTAMP_HEADER = "x-itx-edge-proxy-ts";
export const EDGE_PROXY_SIGNATURE_HEADER = "x-itx-edge-proxy-signature";

export const DEFAULT_KILL_SWITCH_MESSAGE =
  "Unfortunately ItemTraxx is currently unavailable. We apologize for any inconvenience and are working to restore access as soon as possible. Please see the status page (https://status.itemtraxx.com/) for more information.";

export const MAINTENANCE_FALLBACK_KEY = "itemtraxx:maintenance_fallback:v1";

export const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, prefer, x-itx-session-request, x-itx-data-request, aikido-scan-agent",
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
  "https://itxdemo.app.itemtraxx.com",
  "https://dennis.dev.itemtraxx.com",
  "https://leo.dev.itemtraxx.com",
  "https://testdist.app.itemtraxx.com",
  "https://dev.itemtraxx.com",
  "https://preview.itemtraxx.com",
  "https://staging.itemtraxx.com",
];
