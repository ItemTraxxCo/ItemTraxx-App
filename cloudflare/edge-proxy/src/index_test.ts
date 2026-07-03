import {
  checkSessionRateLimit,
  default as worker,
  isBlockedRpcProxyPath,
  isUnauthorizedRpcProxyPath,
} from "./index.ts";

const sessionRequest = () =>
  new Request("https://edge.itemtraxx.com/auth/session/exchange", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.42",
      "content-type": "application/json",
      origin: "https://itemtraxx.com",
      "x-itx-session-request": "1",
    },
    body: JSON.stringify({ access_token: "access", refresh_token: "refresh" }),
  });

const executionContext = {
  waitUntil: (_promise: Promise<unknown>) => {},
};

Deno.test("blocks RPC proxy routes through direct and REST paths", () => {
  const blockedPaths = [
    "/rpc",
    "/rpc/run_data_retention",
    "/rpc/run_data_retention/",
    "/rpc/%72un_data_retention",
    "/rpc/consume_rate_limit_prelogin",
    "/rest/v1/rpc",
    "/rest/v1/rpc/run_data_retention",
    "/rest/v1/rpc/run_data_retention/",
    "/rest/v1/rpc/%72un_data_retention",
    "/rest/v1/rpc/consume_rate_limit_prelogin",
  ];

  for (const path of blockedPaths) {
    if (!isBlockedRpcProxyPath(path)) {
      throw new Error(`Expected RPC path to be blocked: ${path}`);
    }
  }
});

Deno.test("does not block non-RPC REST paths", () => {
  const allowedPaths = [
    "/rpc/consume_rate_limit",
    "/rest/v1/rpc/consume_rate_limit",
    "/rest/v1/profiles",
    "/rest/v1/tenants",
    "/functions/admin-ops",
  ];

  for (const path of allowedPaths) {
    if (isBlockedRpcProxyPath(path)) {
      throw new Error(`Expected non-RPC path to remain allowed: ${path}`);
    }
  }
});

Deno.test("requires caller auth on RPC proxy paths", () => {
  const rpcPaths = [
    "/rpc/consume_rate_limit",
    "/rest/v1/rpc/consume_rate_limit",
  ];

  for (const path of rpcPaths) {
    if (!isUnauthorizedRpcProxyPath(path, false)) {
      throw new Error(
        `Expected unauthenticated RPC path to be rejected: ${path}`,
      );
    }
    if (isUnauthorizedRpcProxyPath(path, true)) {
      throw new Error(`Expected authenticated RPC path to be allowed: ${path}`);
    }
  }
});

Deno.test("session rate limit uses the trusted Cloudflare client IP", async () => {
  let observedKey = "";
  const result = await checkSessionRateLimit(
    {
      limit: ({ key }) => {
        observedKey = key;
        return Promise.resolve({ success: true });
      },
    },
    new Request("https://edge.itemtraxx.com/auth/session/exchange", {
      headers: { "cf-connecting-ip": "203.0.113.42" },
    }),
  );

  if (result !== "allowed" || observedKey !== "203.0.113.42") {
    throw new Error("Expected the trusted Cloudflare IP to be rate limited");
  }
});

Deno.test("session rate limit reports exceeded limits", async () => {
  const result = await checkSessionRateLimit(
    { limit: () => Promise.resolve({ success: false }) },
    new Request("https://edge.itemtraxx.com/auth/session/refresh", {
      headers: { "cf-connecting-ip": "203.0.113.42" },
    }),
  );

  if (result !== "limited") {
    throw new Error("Expected the request to be rate limited");
  }
});

Deno.test("session rate limit fails closed without a binding or trusted IP", async () => {
  const request = new Request(
    "https://edge.itemtraxx.com/auth/session/refresh",
  );
  if (await checkSessionRateLimit(undefined, request) !== "unavailable") {
    throw new Error("Expected a missing binding to fail closed");
  }

  const binding = { limit: () => Promise.resolve({ success: true }) };
  if (await checkSessionRateLimit(binding, request) !== "unavailable") {
    throw new Error("Expected a missing trusted IP to fail closed");
  }
});

Deno.test("session rate limit fails closed when Cloudflare errors", async () => {
  const result = await checkSessionRateLimit(
    { limit: () => Promise.reject(new Error("binding unavailable")) },
    new Request("https://edge.itemtraxx.com/auth/session/refresh", {
      headers: { "cf-connecting-ip": "203.0.113.42" },
    }),
  );

  if (result !== "unavailable") {
    throw new Error("Expected binding errors to fail closed");
  }
});

Deno.test("session exchange returns 429 with retry guidance when limited", async () => {
  const response = await worker.fetch(
    sessionRequest(),
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SESSION_EXCHANGE_RATE_LIMITER: {
        limit: () => Promise.resolve({ success: false }),
      },
    },
    executionContext,
  );

  if (response.status !== 429 || response.headers.get("Retry-After") !== "60") {
    throw new Error("Expected a 429 response with a 60-second retry window");
  }
});

Deno.test("session exchange returns 503 when rate limiting is unavailable", async () => {
  const response = await worker.fetch(
    sessionRequest(),
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
    },
    executionContext,
  );

  if (response.status !== 503) {
    throw new Error("Expected session exchange to fail closed");
  }
});

Deno.test("edge proxy CORS requires exact configured origins", async () => {
  const response = await worker.fetch(
    new Request("https://edge.itemtraxx.com/functions/v1/system-status", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.itemtraxx.com",
      },
    }),
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      ALLOWED_ORIGINS: "https://app.itemtraxx.com,https://testdist.app.itemtraxx.com",
    },
    executionContext,
  );

  if (
    response.status !== 200 ||
    response.headers.get("Access-Control-Allow-Origin") !== "https://app.itemtraxx.com"
  ) {
    throw new Error("Expected exact configured origin to be allowed");
  }
});

Deno.test("edge proxy CORS does not expand wildcard origin patterns", async () => {
  const response = await worker.fetch(
    new Request("https://edge.itemtraxx.com/functions/v1/system-status", {
      method: "OPTIONS",
      headers: {
        origin: "https://newdistrict.itemtraxx.com",
      },
    }),
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      ALLOWED_ORIGINS: "https://*.itemtraxx.com",
    },
    executionContext,
  );

  if (response.status !== 403) {
    throw new Error("Expected wildcard subdomain configuration not to be expanded");
  }

  const lookalikeResponse = await worker.fetch(
    new Request("https://edge.itemtraxx.com/functions/v1/system-status", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.itemtraxx.com.attacker.com",
      },
    }),
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      ALLOWED_ORIGINS: "https://*.itemtraxx.com",
    },
    executionContext,
  );

  if (lookalikeResponse.status !== 403) {
    throw new Error("Expected wildcard-like origin configuration not to be expanded");
  }
});
