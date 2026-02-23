export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ALLOWED_ORIGINS?: string;
  ALLOWED_FUNCTIONS?: string;
}

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const parseCsv = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const withCorsHeaders = (origin: string | null, allowedOrigins: string[]) => {
  const originAllowed =
    !!origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin));
  const headers = originAllowed
    ? { ...BASE_CORS_HEADERS, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) }
    : { ...BASE_CORS_HEADERS };
  return { originAllowed, headers };
};

const buildError = (
  status: number,
  message: string,
  headers: Record<string, string>,
  requestId: string
) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "x-request-id": requestId },
  });

const getFunctionName = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0] !== "functions") {
    return "";
  }
  return segments[1] ?? "";
};

const sanitizeRequestHeaders = (request: Request, anonKey: string, requestId: string) => {
  const headers = new Headers();
  headers.set("x-request-id", requestId);
  headers.set("apikey", anonKey);
  headers.set("Content-Type", request.headers.get("Content-Type") ?? "application/json");
  const auth = request.headers.get("Authorization");
  if (auth) {
    headers.set("Authorization", auth);
  }
  const clientInfo = request.headers.get("x-client-info");
  if (clientInfo) {
    headers.set("x-client-info", clientInfo);
  }
  return headers;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const requestId =
      request.headers.get("x-request-id") ??
      (typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : "itx-edge-request");
    const allowedOrigins = parseCsv(env.ALLOWED_ORIGINS);
    const { originAllowed, headers } = withCorsHeaders(origin, allowedOrigins);

    if (request.method === "OPTIONS") {
      if (!originAllowed) {
        return new Response("Origin not allowed", { status: 403, headers });
      }
      return new Response("ok", { headers });
    }

    if (!originAllowed) {
      return buildError(403, "Origin not allowed", headers, requestId);
    }

    const functionName = getFunctionName(url.pathname);
    if (!functionName) {
      return buildError(404, "Not found", headers, requestId);
    }

    const allowedFunctions = parseCsv(env.ALLOWED_FUNCTIONS);
    if (allowedFunctions.length > 0 && !allowedFunctions.includes(functionName)) {
      return buildError(403, "Function not allowed", headers, requestId);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return buildError(500, "Proxy misconfiguration", headers, requestId);
    }

    const supabaseFunctionUrl = `${trimTrailingSlash(
      env.SUPABASE_URL
    )}/functions/v1/${functionName}`;

    const proxiedHeaders = sanitizeRequestHeaders(
      request,
      env.SUPABASE_ANON_KEY,
      requestId
    );
    const init: RequestInit = {
      method: request.method,
      headers: proxiedHeaders,
      body: request.method === "GET" ? undefined : await request.text(),
    };

    const upstreamResponse = await fetch(supabaseFunctionUrl, init);
    const responseHeaders = new Headers(upstreamResponse.headers);
    Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
    responseHeaders.set("x-request-id", requestId);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  },
};
