import worker from "./index.ts";

const ORIGIN = "https://itemtraxx.com";
const SUPABASE_URL = "https://example.supabase.co";

const baseEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    SUPABASE_URL,
    SUPABASE_ANON_KEY: "anon-key",
    SESSION_EXCHANGE_RATE_LIMITER: {
      limit: () => Promise.resolve({ success: true }),
    },
    SESSION_REFRESH_RATE_LIMITER: {
      limit: () => Promise.resolve({ success: true }),
    },
    ...overrides,
  }) as unknown as Env;

const createContext = () => {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        promises.push(promise);
      },
    } as unknown as ExecutionContext,
  };
};

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

const setCookies = (response: Response) => {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
};

const sessionMutation = (
  action: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`https://edge.itemtraxx.com/auth/session/${action}`, {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.42",
      "content-type": "application/json",
      origin: ORIGIN,
      "x-itx-session-request": "1",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

Deno.test("session exchange validates the user/profile and emits exact configured cookies", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(
        Response.json({
          id: "user-1",
          email: "user@example.com",
          last_sign_in_at: "stamp",
        }),
      );
    }
    if (url.includes("/rest/v1/profiles?")) {
      return Promise.resolve(Response.json([{
        id: "user-1",
        role: "tenant_admin",
        tenant_id: "tenant-1",
        district_id: null,
        auth_email: "user@example.com",
        is_active: true,
      }]));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  }) as typeof fetch;

  try {
    const response = await worker.fetch(
      sessionMutation("exchange", {
        access_token: "access token",
        refresh_token: "refresh/token",
      }),
      baseEnv({
        SESSION_COOKIE_DOMAIN: ".itemtraxx.com",
        SESSION_COOKIE_SAMESITE: "strict",
        SESSION_REFRESH_COOKIE_MAX_AGE_SECONDS: "999999999",
      }),
      createContext().ctx,
    );
    assertEquals(response.status, 200, "exchange status");
    assertEquals(await response.json(), {
      authenticated: true,
      user: {
        id: "user-1",
        email: "user@example.com",
        last_sign_in_at: "stamp",
      },
      profile: {
        role: "tenant_admin",
        tenant_id: "tenant-1",
        district_id: null,
        auth_email: "user@example.com",
        is_active: true,
      },
    }, "exchange response");
    assertEquals(setCookies(response), [
      "itx_session=access%20token; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Strict; Domain=.itemtraxx.com",
      "itx_refresh=refresh%2Ftoken; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Strict; Domain=.itemtraxx.com",
    ], "exchange cookies");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert(
    calls[0]?.endsWith("/auth/v1/user"),
    "exchange must validate auth user first",
  );
  assert(
    calls[1]?.includes("/rest/v1/profiles?"),
    "exchange must load the profile second",
  );
});

Deno.test("session exchange rejects invalid origin, mutation header, and payload before auth", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;
  try {
    const invalidOrigin = await worker.fetch(
      sessionMutation("exchange", { access_token: "a", refresh_token: "r" }, {
        origin: "https://attacker.example",
      }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(invalidOrigin.status, 403, "invalid origin status");

    const missingHeader = await worker.fetch(
      new Request("https://edge.itemtraxx.com/auth/session/exchange", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "cf-connecting-ip": "203.0.113.42",
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: "a", refresh_token: "r" }),
      }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(missingHeader.status, 400, "missing session header status");

    const invalidPayload = await worker.fetch(
      sessionMutation("exchange", { access_token: "a" }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(invalidPayload.status, 400, "invalid exchange payload status");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(fetches, 0, "invalid session requests must not call upstream");
});

Deno.test("session refresh rotates cookies and rejects invalid or expired refresh tokens", async () => {
  const originalFetch = globalThis.fetch;
  let mode: "success" | "invalid" = "success";
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(
        mode === "success"
          ? Response.json({
            access_token: "new-access",
            refresh_token: "new-refresh",
          })
          : new Response(JSON.stringify({ error: "expired" }), { status: 400 }),
      );
    }
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(Response.json({ id: "user-1" }));
    }
    if (url.includes("/rest/v1/profiles?")) {
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;

  try {
    const success = await worker.fetch(
      sessionMutation("refresh", undefined, {
        cookie: "itx_refresh=old-refresh",
      }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(success.status, 200, "refresh status");
    assertEquals(setCookies(success), [
      "itx_session=new-access; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=new-refresh; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
    ], "rotated cookies");

    mode = "invalid";
    const expired = await worker.fetch(
      sessionMutation("refresh", undefined, { cookie: "itx_refresh=expired" }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(expired.status, 401, "expired refresh status");
    assertEquals(setCookies(expired), [
      "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ], "expired refresh clears cookies");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("session me refreshes a missing access token and logout remains best effort", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(
        Response.json({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
        }),
      );
    }
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(Response.json({ id: "user-1", email: null }));
    }
    if (url.includes("/rest/v1/profiles?")) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith("/auth/v1/logout")) {
      return Promise.reject(new Error("upstream logout unavailable"));
    }
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;

  try {
    const me = await worker.fetch(
      new Request("https://edge.itemtraxx.com/auth/session/me", {
        headers: {
          origin: ORIGIN,
          "cf-connecting-ip": "203.0.113.42",
          cookie: "itx_refresh=refresh",
        },
      }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(me.status, 200, "me status");
    assertEquals(
      (await me.json() as { authenticated: boolean }).authenticated,
      true,
      "me authenticated",
    );
    assertEquals(setCookies(me), [
      "itx_session=fresh-access; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=fresh-refresh; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
    ], "me refresh cookies");

    const logout = await worker.fetch(
      sessionMutation("logout", undefined, {
        cookie: "itx_session=access; itx_refresh=refresh",
      }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(logout.status, 200, "best effort logout status");
    assertEquals(
      await logout.json(),
      { ok: true },
      "best effort logout payload",
    );
    assertEquals(setCookies(logout), [
      "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ], "logout cookies");
  } finally {
    globalThis.fetch = originalFetch;
  }
  const logoutCall = calls.find((call) => call.url.endsWith("/auth/v1/logout"));
  assertEquals(
    new Headers(logoutCall?.init?.headers).get("authorization"),
    "Bearer access",
    "logout auth",
  );
});

Deno.test("direct and REST RPC dispatch require caller auth and preserve canonical blocking order", async () => {
  const originalFetch = globalThis.fetch;
  const upstream: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    upstream.push(String(input));
    return Promise.resolve(
      new Response("rpc-ok", {
        status: 201,
        headers: { "x-upstream": "kept" },
      }),
    );
  }) as typeof fetch;
  try {
    for (
      const path of [
        "/rpc/consume_rate_limit",
        "/rest/v1/rpc/consume_rate_limit",
      ]
    ) {
      const unauthenticated = await worker.fetch(
        new Request(`https://edge.itemtraxx.com${path}`, {
          headers: { origin: ORIGIN },
        }),
        baseEnv(),
        createContext().ctx,
      );
      assertEquals(unauthenticated.status, 401, `unauthenticated RPC ${path}`);

      const authenticated = await worker.fetch(
        new Request(`https://edge.itemtraxx.com${path}`, {
          headers: { origin: ORIGIN, authorization: "Bearer caller" },
        }),
        baseEnv(),
        createContext().ctx,
      );
      assertEquals(authenticated.status, 201, `authenticated RPC ${path}`);
      assertEquals(
        await authenticated.text(),
        "rpc-ok",
        `streamed RPC body ${path}`,
      );
      assertEquals(
        authenticated.headers.get("x-upstream"),
        "kept",
        `RPC upstream header ${path}`,
      );
    }

    const blocked = await worker.fetch(
      new Request(
        "https://edge.itemtraxx.com/rest/v1/%72pc/run_data_retention",
        {
          headers: { origin: ORIGIN, authorization: "Bearer caller" },
        },
      ),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(blocked.status, 403, "canonical blocked RPC");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(upstream, [
    `${SUPABASE_URL}/rest/v1/rpc/consume_rate_limit`,
    `${SUPABASE_URL}/rest/v1/rpc/consume_rate_limit`,
  ], "RPC upstream URLs");
});

Deno.test("Data API mutations require the explicit mutation header", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches += 1;
    return Promise.resolve(new Response("created", { status: 201 }));
  }) as typeof fetch;
  try {
    const rejected = await worker.fetch(
      new Request("https://edge.itemtraxx.com/rest/v1/items", {
        method: "POST",
        headers: { origin: ORIGIN, authorization: "Bearer caller" },
        body: "fixture",
      }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(rejected.status, 400, "missing data mutation header");

    const allowed = await worker.fetch(
      new Request("https://edge.itemtraxx.com/rest/v1/items", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          authorization: "Bearer caller",
          "content-type": "application/octet-stream",
          "x-itx-data-request": "1",
        },
        body: "fixture",
      }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(allowed.status, 201, "valid data mutation header");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(fetches, 1, "only valid mutation reaches upstream");
});

Deno.test("function allowlist and kill switch deny before the upstream", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches += 1;
    return Promise.resolve(new Response("unexpected"));
  }) as typeof fetch;
  try {
    const disallowed = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/admin-ops", {
        headers: { origin: ORIGIN },
      }),
      baseEnv({ ALLOWED_FUNCTIONS: "system-status" }),
      createContext().ctx,
    );
    assertEquals(disallowed.status, 403, "function allowlist status");

    const killed = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/admin-ops", {
        headers: { origin: ORIGIN },
      }),
      baseEnv({
        ITX_ITEMTRAXX_KILLSWITCH_ENABLED: "true",
        ITX_ITEMTRAXX_KILLSWITCH_MESSAGE: "maintenance fixture",
      }),
      createContext().ctx,
    );
    assertEquals(killed.status, 503, "kill switch status");
    assertEquals(
      await killed.json(),
      { error: "maintenance fixture" },
      "kill switch message",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(fetches, 0, "function gates must precede upstream fetch");
});

Deno.test("function proxy signs exact cloned bytes and streams upstream response", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let capturedInit: RequestInit | undefined;
  const bytes = new Uint8Array([0, 255, 10, 42]);
  Date.now = () => 1712345678901;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(
      new Response(new Uint8Array([9, 8, 7]), {
        status: 202,
        headers: {
          "content-type": "application/octet-stream",
          "x-upstream": "kept",
        },
      }),
    );
  }) as typeof fetch;
  try {
    const response = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/checkout", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/octet-stream",
          "x-request-id": "request-123",
        },
        body: bytes,
      }),
      baseEnv({ ITX_EDGE_PROXY_SHARED_SECRET: "fixture-secret" }),
      createContext().ctx,
    );
    assertEquals(response.status, 202, "function response status");
    assertEquals(Array.from(new Uint8Array(await response.arrayBuffer())), [
      9,
      8,
      7,
    ], "function response bytes");
    assertEquals(
      response.headers.get("x-upstream"),
      "kept",
      "function upstream header",
    );
    assertEquals(
      Array.from(new Uint8Array(capturedInit?.body as Uint8Array)),
      Array.from(bytes),
      "forwarded request bytes",
    );
    const headers = new Headers(capturedInit?.headers);
    assertEquals(
      headers.get("x-itx-edge-proxy"),
      "1",
      "trusted ingress marker",
    );
    assert(
      headers.get("x-itx-edge-proxy-signature"),
      "trusted ingress signature",
    );
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

Deno.test("function proxy retries one upstream 401 after a fail-closed refresh", async () => {
  const originalFetch = globalThis.fetch;
  const authHeaders: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(
        Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
        }),
      );
    }
    if (url.endsWith("/functions/v1/admin-ops")) {
      authHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
      return Promise.resolve(
        authHeaders.length === 1
          ? new Response("unauthorized", { status: 401 })
          : new Response("retried", { status: 200 }),
      );
    }
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;
  try {
    const response = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/admin-ops", {
        headers: {
          origin: ORIGIN,
          "cf-connecting-ip": "203.0.113.42",
          cookie: "itx_session=old-access; itx_refresh=old-refresh",
        },
      }),
      baseEnv(),
      createContext().ctx,
    );
    assertEquals(response.status, 200, "retried function status");
    assertEquals(await response.text(), "retried", "retried function body");
    assertEquals(
      authHeaders,
      ["Bearer old-access", "Bearer new-access"],
      "refresh retry authorization",
    );
    assertEquals(setCookies(response), [
      "itx_session=new-access; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=new-refresh; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
    ], "refresh retry cookies");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("system-status uses the bounded cached fallback when upstream throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.reject(new Error("upstream unavailable"))) as typeof fetch;
  const cached = {
    enabled: true,
    message: "Scheduled work",
    updated_at: "2026-07-13T00:00:00Z",
  };
  const kv = {
    get: (_key: string, type?: string) =>
      Promise.resolve(type === "json" ? cached : JSON.stringify(cached)),
  };
  try {
    const response = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/system-status", {
        headers: { origin: ORIGIN },
      }),
      baseEnv({ MAINTENANCE_FALLBACK_KV: kv }),
      createContext().ctx,
    );
    assertEquals(response.status, 503, "status fallback response");
    const payload = await response.json() as Record<string, unknown>;
    assertEquals(payload.maintenance, cached, "cached maintenance payload");
    assertEquals(payload.maintenance_fallback, true, "fallback marker");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("unhandled upstream exceptions return 500 and schedule exception observability", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("boom"))) as typeof fetch;
  const context = createContext();
  try {
    const response = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/admin-ops", {
        headers: { origin: ORIGIN },
      }),
      baseEnv(),
      context.ctx,
    );
    assertEquals(response.status, 500, "exception status");
    assertEquals(
      await response.json(),
      { error: "Internal worker error" },
      "exception envelope",
    );
    assertEquals(context.promises.length, 1, "exception waitUntil count");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await Promise.all(context.promises);
});

Deno.test("proxied 5xx responses preserve bytes and schedule non-awaited observability", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 502,
        headers: { "content-type": "application/octet-stream" },
      }),
    )) as typeof fetch;
  const context = createContext();
  try {
    const response = await worker.fetch(
      new Request("https://edge.itemtraxx.com/functions/admin-ops", {
        headers: { origin: ORIGIN },
      }),
      baseEnv(),
      context.ctx,
    );
    assertEquals(response.status, 502, "upstream 5xx status");
    assertEquals(Array.from(new Uint8Array(await response.arrayBuffer())), [
      1,
      2,
      3,
    ], "upstream 5xx bytes");
    assertEquals(context.promises.length, 1, "5xx waitUntil count");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await Promise.all(context.promises);
});
