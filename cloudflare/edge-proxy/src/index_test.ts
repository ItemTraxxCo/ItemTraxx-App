import worker, {
  attachSsoLoginProof,
  getCookieHeaderFromSetCookies,
  resolveSsoCallbackContext,
} from "./index.ts";
import {
  isBlockedRpcProxyPath,
  isUnauthorizedRpcProxyPath,
} from "./routing.ts";

const executionContext = {
  waitUntil: (_promise: Promise<unknown>) => {},
};

Deno.test("SSO callback context excludes GET-based SAML ACS safe redirects", () => {
  const request = new Request(
    "https://edge.itemtraxx.com/api/auth/sso/saml2/sp/acs/provider-1?RelayState=%2F",
  );
  if (resolveSsoCallbackContext(request) !== null) {
    throw new Error(
      "A GET request must not be classified as a SAML assertion callback",
    );
  }

  const post = new Request(
    "https://edge.itemtraxx.com/api/auth/sso/saml2/sp/acs/provider-1",
    { method: "POST" },
  );
  const callback = resolveSsoCallbackContext(post);
  if (
    callback?.providerId !== "provider-1" || callback.protocol !== "SAML2.0"
  ) {
    throw new Error("Expected a SAML POST ACS callback to be recognized");
  }

  const oidc = resolveSsoCallbackContext(
    new Request(
      "https://edge.itemtraxx.com/api/auth/sso/callback/provider-2?code=code&state=state",
    ),
  );
  if (
    oidc?.providerId !== "provider-2" ||
    oidc.protocol !== "OpenID Connect (OIDC)"
  ) {
    throw new Error("Expected an OIDC GET callback to be recognized");
  }

  const invalidMethod = resolveSsoCallbackContext(
    new Request(
      "https://edge.itemtraxx.com/api/auth/sso/callback/provider-2",
      { method: "PUT" },
    ),
  );
  if (invalidMethod !== null) {
    throw new Error(
      "Unsupported methods must not be classified as OIDC callbacks",
    );
  }
});

Deno.test("SSO callback proof is added only to successful redirects and replaces legacy claims", () => {
  const response = new Response(null, {
    status: 302,
    headers: {
      Location:
        "https://itemtraxx.com/?keep=1&itx_sso_provider_id=forged&itx_sso_protocol=SAML2.0",
    },
  });
  const attached = attachSsoLoginProof(
    response,
    new URL("https://edge.itemtraxx.com/api/auth/sso/callback/provider-1"),
    "signed-proof",
  );
  const location = new URL(attached.headers.get("Location") ?? "");

  if (
    location.searchParams.get("keep") !== "1" ||
    location.searchParams.get("itx_sso_proof") !== "signed-proof" ||
    location.searchParams.has("itx_sso_provider_id") ||
    location.searchParams.has("itx_sso_protocol")
  ) {
    throw new Error("Expected the redirect to carry only the signed SSO proof");
  }

  const errorResponse = new Response(null, {
    status: 302,
    headers: { Location: "https://itemtraxx.com/?error=access_denied" },
  });
  if (
    attachSsoLoginProof(
      errorResponse,
      new URL("https://edge.itemtraxx.com/api/auth/sso/callback/provider-1"),
      "signed-proof",
    ) !== errorResponse
  ) {
    throw new Error("An SSO error redirect must not be altered");
  }
});

Deno.test("SSO callback session cookie header keeps the latest value per cookie name", () => {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    "better-auth.session_token=old; Path=/; HttpOnly",
  );
  headers.append("Set-Cookie", "state=; Path=/; Max-Age=0");
  headers.append(
    "Set-Cookie",
    "better-auth.session_token=new; Path=/; HttpOnly",
  );

  const cookie = getCookieHeaderFromSetCookies(headers);
  if (cookie !== "better-auth.session_token=new; state=") {
    throw new Error(`Unexpected callback Cookie header: ${cookie}`);
  }
});

Deno.test("SSO callback proof is not attached when no server proof is available", () => {
  const response = new Response(null, {
    status: 302,
    headers: { Location: "https://itemtraxx.com/" },
  });
  if (
    attachSsoLoginProof(
      response,
      new URL("https://edge.itemtraxx.com/api/auth/sso/callback/provider-1"),
      null,
    ) !== response
  ) {
    throw new Error(
      "Missing proof should leave the Better Auth redirect unchanged",
    );
  }
});

Deno.test("SSO callback proof is not forwarded to a non-ItemTraxx redirect", () => {
  const response = new Response(null, {
    status: 302,
    headers: { Location: "https://outside.example/return" },
  });
  if (
    attachSsoLoginProof(
      response,
      new URL("https://edge.itemtraxx.com/api/auth/sso/callback/provider-1"),
      "signed-proof",
    ) !== response
  ) {
    throw new Error(
      "A proof must not be forwarded to an external redirect target",
    );
  }
});

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
    "/rest/v1/workspaces",
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
      ALLOWED_ORIGINS:
        "https://app.itemtraxx.com,https://staging.itemtraxx.com",
    },
    executionContext,
  );

  if (
    response.status !== 200 ||
    response.headers.get("Access-Control-Allow-Origin") !==
      "https://app.itemtraxx.com"
  ) {
    throw new Error("Expected exact configured origin to be allowed");
  }
});

Deno.test("killswitch and maintenance return JSON 503s for HTML-accepting API requests", async () => {
  const cases = [
    {
      mode: "killswitch",
      flag: "ITX_KILLSWITCH_ENABLED",
      messageKey: "ITX_KILLSWITCH_MESSAGE",
      message: "The service is unavailable. Please see the status page.",
    },
    {
      mode: "maintenance",
      flag: "ITX_MAINTENANCE_ENABLED",
      messageKey: "ITX_MAINTENANCE_MESSAGE",
      message: "Maintenance is in progress. Please see the status page.",
    },
  ] as const;

  for (const testCase of cases) {
    const response = await worker.fetch(
      new Request("https://edge.itemtraxx.com/rest/v1/workspaces", {
        headers: {
          origin: "https://app.itemtraxx.com",
          accept: "text/html,application/xhtml+xml",
        },
      }),
      {
        [testCase.flag]: "true",
        [testCase.messageKey]: testCase.message,
      } as Env,
      executionContext,
    );

    if (response.status !== 503) {
      throw new Error(`${testCase.mode} should return 503, got ${response.status}`);
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`${testCase.mode} response must have a JSON content type`);
    }
    if (
      response.headers.get("Access-Control-Allow-Origin") !==
        "https://app.itemtraxx.com"
    ) {
      throw new Error(`${testCase.mode} response must include the allowed CORS origin`);
    }
    if (response.headers.get("Access-Control-Allow-Credentials") !== "true") {
      throw new Error(`${testCase.mode} response must retain credentialed CORS`);
    }
    if (
      !response.headers.get("Access-Control-Allow-Headers")?.includes(
        "content-type",
      ) ||
      !response.headers.get("Access-Control-Expose-Headers")?.includes(
        "x-request-id",
      )
    ) {
      throw new Error(`${testCase.mode} response must retain the API CORS header contract`);
    }

    const body = await response.json() as Record<string, unknown>;
    const expected = {
      status: "unavailable",
      mode: testCase.mode,
      message: testCase.message,
      statusPageUrl: "https://status.itemtraxx.com",
    };
    if (JSON.stringify(body) !== JSON.stringify(expected)) {
      throw new Error(
        `${testCase.mode} response body mismatch: ${JSON.stringify(body)}`,
      );
    }
  }
});

Deno.test("system-status remains a 200 JSON response during edge downtime", async () => {
  const cases = [
    {
      mode: "killswitch",
      flag: "ITX_KILLSWITCH_ENABLED",
      expectedStatus: "major_outage",
    },
    {
      mode: "maintenance",
      flag: "ITX_MAINTENANCE_ENABLED",
      expectedStatus: "maintenance",
    },
  ] as const;

  for (const testCase of cases) {
    const response = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/system-status", {
        headers: { origin: "https://app.itemtraxx.com" },
      }),
      { [testCase.flag]: "true" } as Env,
      executionContext,
    );
    const body = await response.json() as Record<string, unknown>;

    if (response.status !== 200 || body.status !== testCase.expectedStatus) {
      throw new Error(
        `${testCase.mode} system status should return 200/${testCase.expectedStatus}`,
      );
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("System status response must have a JSON content type");
    }
    if (body.statusPageUrl !== "https://status.itemtraxx.com") {
      throw new Error("System status must include the status page URL");
    }
  }
});

Deno.test("spoofed Referer without Origin does not bypass edge downtime", async () => {
  for (const flag of ["ITX_MAINTENANCE_ENABLED", "ITX_KILLSWITCH_ENABLED"] as const) {
    for (const referer of ["http://localhost:5173/", "https://dev.itemtraxx.com/"]) {
      const response = await worker.fetch(
        new Request("https://edge.itemtraxx.com/rest/v1/workspaces", {
          headers: { referer },
        }),
        { [flag]: "true", TRUST_LOCAL_ORIGINS: "false" } as Env,
        executionContext,
      );
      if (response.status !== 503) {
        throw new Error(
          `${flag} with Referer ${referer} and no Origin must return 503, got ${response.status}`,
        );
      }
    }
  }
});

Deno.test("dev domains and trusted localhost origins bypass both killswitch and maintenance", async () => {
  for (const flag of ["ITX_MAINTENANCE_ENABLED", "ITX_KILLSWITCH_ENABLED"] as const) {
    const devResponse = await worker.fetch(
      new Request("https://edge.itemtraxx.com/rest/v1/workspaces", {
        headers: { origin: "https://dev.itemtraxx.com" },
      }),
      { [flag]: "true", TRUST_LOCAL_ORIGINS: "false" } as Env,
      executionContext,
    );
    if (devResponse.status === 503) {
      throw new Error(`${flag} should allow dev.itemtraxx.com to bypass edge downtime`);
    }

    const trustedLocalResponse = await worker.fetch(
      new Request("https://edge.itemtraxx.com/rest/v1/workspaces", {
        headers: { origin: "http://localhost:5173" },
      }),
      { [flag]: "true", TRUST_LOCAL_ORIGINS: "true" } as Env,
      executionContext,
    );
    if (trustedLocalResponse.status === 503) {
      throw new Error(`${flag} should allow localhost to bypass when TRUST_LOCAL_ORIGINS=true`);
    }

    const untrustedLocalResponse = await worker.fetch(
      new Request("https://edge.itemtraxx.com/rest/v1/workspaces", {
        headers: { origin: "http://localhost:5173" },
      }),
      { [flag]: "true", TRUST_LOCAL_ORIGINS: "false" } as Env,
      executionContext,
    );
    if (untrustedLocalResponse.status !== 403) {
      throw new Error(
        `${flag} should reject localhost when TRUST_LOCAL_ORIGINS=false, got ${untrustedLocalResponse.status}`,
      );
    }
  }
});

Deno.test("internal auth admin bridge is not masked by edge downtime when secret header is supplied", async () => {
  const response = await worker.fetch(
    new Request("https://edge.itemtraxx.com/api/auth/internal-admin", {
      method: "POST",
      headers: { "x-itx-internal-auth": "wrong-secret" },
    }),
    {
      ITX_MAINTENANCE_ENABLED: "true",
      ITX_INTERNAL_AUTH_SECRET: "expected-secret",
    } as Env,
    executionContext,
  );
  if (response.status !== 401) {
    throw new Error(`Expected internal-admin bridge to enforce secret auth (401), got ${response.status}`);
  }
});

Deno.test("rate limits public email sign-in before reading its form body", async () => {
  let bodyRead = false;
  let limiterKey = "";
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      bodyRead = true;
      controller.enqueue(new TextEncoder().encode("email=user@example.com"));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const response = await worker.fetch(
    new Request("https://edge.itemtraxx.com/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cf-connecting-ip": "203.0.113.9",
      },
      body,
      duplex: "half",
    }),
    {
      PUBLIC_AUTH_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          limiterKey = key;
          return { success: false };
        },
      },
      ITX_ENVIRONMENT: "test",
    } as Env,
    executionContext,
  );

  if (response.status !== 429) {
    throw new Error(`Expected sign-in throttle response, received ${response.status}`);
  }
  if (bodyRead) {
    throw new Error("Expected rejected sign-in request body to remain unread");
  }
  if (limiterKey !== "better-auth-email-sign-in:203.0.113.9") {
    throw new Error(`Unexpected sign-in throttle key: ${limiterKey}`);
  }
});

Deno.test("rate limits public password resets before reading its form body", async () => {
  let bodyRead = false;
  let limiterKey = "";
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      bodyRead = true;
      controller.enqueue(new TextEncoder().encode("email=user@example.com"));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const response = await worker.fetch(
    new Request("https://edge.itemtraxx.com/api/auth//request-password-reset/", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cf-connecting-ip": "203.0.113.10",
      },
      body,
      duplex: "half",
    }),
    {
      PUBLIC_AUTH_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          limiterKey = key;
          return { success: false };
        },
      },
      ITX_ENVIRONMENT: "test",
    } as Env,
    executionContext,
  );

  if (response.status !== 429) {
    throw new Error(`Expected password reset throttle response, received ${response.status}`);
  }
  if (bodyRead) {
    throw new Error("Expected rejected password reset request body to remain unread");
  }
  if (limiterKey !== "better-auth-password-reset:203.0.113.10") {
    throw new Error(`Unexpected password reset throttle key: ${limiterKey}`);
  }
});

Deno.test("edge proxy CORS allows the explicitly configured demo workspace", async () => {
  const demoOrigin = "https://itxdemo.app.itemtraxx.com";
  const response = await worker.fetch(
    new Request("https://edge.itemtraxx.com/api/auth/get-session", {
      method: "OPTIONS",
      headers: {
        origin: demoOrigin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "content-type",
      },
    }),
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
    },
    executionContext,
  );

  if (
    response.status !== 200 ||
    response.headers.get("Access-Control-Allow-Origin") !== demoOrigin
  ) {
    throw new Error("Expected the demo workspace origin to be allowed");
  }
});

Deno.test("routes the internal Better Auth bridge before the public auth handler", async () => {
  const response = await worker.fetch(
    new Request("https://edge.itemtraxx.com/api/auth/internal-admin", {
      method: "POST",
      headers: {
        origin: "https://itemtraxx.com",
        "x-itx-internal-auth": "wrong-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "list_passkeys", profileId: "profile-1" }),
    }),
    {
      ITX_INTERNAL_AUTH_SECRET: "expected-secret",
    },
    executionContext,
  );

  if (response.status !== 401) {
    throw new Error(
      `Expected the internal bridge to reject an invalid secret, received ${response.status}`,
    );
  }
});

Deno.test("edge proxy CORS allows the explicitly routed development origins", async () => {
  for (const devOrigin of [
    "https://dennis-dev.itemtraxx.com",
    "https://leo-dev.itemtraxx.com",
    "https://dev.itemtraxx.com",
  ]) {
    const response = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/system-status", {
        method: "OPTIONS",
        headers: {
          origin: devOrigin,
        },
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
      },
      executionContext,
    );

    if (
      response.status !== 200 ||
      response.headers.get("Access-Control-Allow-Origin") !== devOrigin
    ) {
      throw new Error(`Expected development origin to be allowed: ${devOrigin}`);
    }
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
    throw new Error(
      "Expected wildcard subdomain configuration not to be expanded",
    );
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
    throw new Error(
      "Expected wildcard-like origin configuration not to be expanded",
    );
  }
});

Deno.test("dispatcher blocks canonicalized REST RPC variants without upstream fetch", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamFetches = 0;
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) => {
    upstreamFetches += 1;
    return Promise.resolve(
      new Response("unexpected upstream fetch", { status: 500 }),
    );
  }) as typeof fetch;

  try {
    for (
      const path of [
        "/rest/v1/%72pc/run_data_retention",
        "/rest/v1/rpc%2Frun_data_retention",
        "/rest/v1//rpc/run_data_retention",
        "/rest/v1/%2572pc/run_data_retention",
      ]
    ) {
      const response = await worker.fetch(
        new Request(`https://edge.itemtraxx.com${path}`, {
          headers: {
            Authorization: "Bearer fixture-token",
            origin: "https://itemtraxx.com",
          },
        }),
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "anon-key",
        },
        executionContext,
      );

      if (response.status !== 403) {
        throw new Error(
          `Expected canonicalized RPC path to return 403: ${path}`,
        );
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (upstreamFetches !== 0) {
    throw new Error(
      `Expected zero upstream fetches for blocked RPC paths, received ${upstreamFetches}`,
    );
  }
});

Deno.test("dispatcher blocks non-allowlisted PostgREST embeds before upstream fetch", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamFetches = 0;
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) => {
    upstreamFetches += 1;
    return Promise.resolve(
      new Response("unexpected upstream fetch", { status: 500 }),
    );
  }) as typeof fetch;

  try {
    for (
      const path of [
        "/rest/v1/items?select=id,workspace_policies(*)",
        "/rest/v1/workspaces?select=id,workspace_usage(*)",
      ]
    ) {
      const response = await worker.fetch(
        new Request(`https://edge.itemtraxx.com${path}`, {
          headers: {
            Authorization: "Bearer fixture-token",
            origin: "https://itemtraxx.com",
          },
        }),
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "anon-key",
        },
        executionContext,
      );

      if (response.status !== 403) {
        throw new Error(
          `Expected non-allowlisted relation query to return 403: ${path}`,
        );
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (upstreamFetches !== 0) {
    throw new Error(
      `Expected zero upstream fetches for blocked relation queries, received ${upstreamFetches}`,
    );
  }
});

Deno.test("dispatcher rejects allowed data paths without a verified Better Auth session", async () => {
  const originalFetch = globalThis.fetch;
  const upstreamUrls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
    upstreamUrls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    for (
      const path of [
        "/rest/v1/rpc/consume_rate_limit",
        "/rest/v1/profiles?select=id",
      ]
    ) {
      const response = await worker.fetch(
        new Request(`https://edge.itemtraxx.com${path}`, {
          headers: {
            Authorization: "Bearer fixture-token",
            origin: "https://itemtraxx.com",
          },
        }),
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "anon-key",
        },
        executionContext,
      );

      if (response.status !== 401) {
        throw new Error(`Expected unverified request to be rejected: ${path}`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const expected: string[] = [];
  if (JSON.stringify(upstreamUrls) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected upstream URLs: ${JSON.stringify(upstreamUrls)}`,
    );
  }
});
