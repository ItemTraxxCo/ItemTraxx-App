import {
  checkSessionRateLimit,
  handleSessionRequest,
  MAX_SESSION_EXCHANGE_BODY_BYTES,
  maybeRefreshSession,
} from "./session.ts";

Deno.test("session limiter uses only the trusted Cloudflare client IP and fails closed", async () => {
  let observed = "";
  const request = new Request(
    "https://edge.itemtraxx.com/auth/session/refresh",
    {
      headers: {
        "cf-connecting-ip": "203.0.113.42",
        "x-forwarded-for": "198.51.100.10",
      },
    },
  );
  const allowed = await checkSessionRateLimit({
    limit: ({ key }) => {
      observed = key;
      return Promise.resolve({ success: true });
    },
  }, request);
  if (allowed !== "allowed" || observed !== "203.0.113.42") {
    throw new Error(
      "Expected the Cloudflare connecting IP to be the limiter key",
    );
  }
  if (await checkSessionRateLimit(undefined, request) !== "unavailable") {
    throw new Error("Expected a missing limiter binding to fail closed");
  }
});

// ---- shared fixtures / helpers ----

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const SUPABASE_URL = "https://example.supabase.co";
const ORIGIN = "https://itemtraxx.com";
const ALLOWED_ORIGINS = [ORIGIN];
const ALLOWED_LIMITER = { limit: () => Promise.resolve({ success: true }) };
const LIMITED_LIMITER = { limit: () => Promise.resolve({ success: false }) };

const baseEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    SUPABASE_URL,
    SUPABASE_ANON_KEY: "anon-key",
    ...overrides,
  }) as unknown as Env;

// Mirrors the JWT-shaping convention already used for session claims fixtures
// (header/signature are opaque placeholders -- only the payload segment is read).
const jwt = (payload: Record<string, unknown>) =>
  [
    "header",
    btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_")
      .replaceAll("=", ""),
    "signature",
  ].join(".");

const mutationRequest = (
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
) =>
  new Request(`https://edge.itemtraxx.com${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "cf-connecting-ip": "203.0.113.42",
      "content-type": "application/json",
      "x-itx-session-request": "1",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const meRequest = (headers: Record<string, string> = {}) =>
  new Request("https://edge.itemtraxx.com/auth/session/me", {
    headers: {
      origin: ORIGIN,
      "cf-connecting-ip": "203.0.113.42",
      ...headers,
    },
  });

const installFetch = (
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

const getSetCookies = (response: Response) => {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return headers.getSetCookie?.() ??
    [response.headers.get("set-cookie") ?? ""];
};

const call = (
  request: Request,
  env: Env,
  action: string,
  allowedOrigins: string[] = ALLOWED_ORIGINS,
) => handleSessionRequest(request, env, {}, "request-id", action, allowedOrigins);

// ---- routing fallthrough ----

Deno.test("handleSessionRequest: unknown action returns 404", async () => {
  const response = await call(
    meRequest(),
    baseEnv(),
    "bogus",
  );
  assertEquals(response.status, 404, "unknown action status");
});

Deno.test("handleSessionRequest: known action with mismatched method returns 404", async () => {
  const response = await call(
    mutationRequest("/auth/session/me"),
    baseEnv(),
    "me",
  );
  assertEquals(response.status, 404, "wrong-method me status");
});

// ---- exchange ----

Deno.test("session exchange: rate-limited request is rejected before payload parsing", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response(null, { status: 500 }))
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/exchange", {}, {
        access_token: "a",
        refresh_token: "r",
      }),
      baseEnv({ SESSION_EXCHANGE_RATE_LIMITER: LIMITED_LIMITER }),
      "exchange",
    );
    assertEquals(response.status, 429, "rate-limited exchange status");
    assertEquals(
      response.headers.get("Retry-After"),
      "60",
      "retry-after header",
    );
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 0, "rate-limited exchange no upstream");
});

Deno.test("session exchange: missing rate limiter binding fails closed as unavailable", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response(null, { status: 500 }))
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/exchange", {}, {
        access_token: "a",
        refresh_token: "r",
      }),
      baseEnv(),
      "exchange",
    );
    assertEquals(response.status, 503, "unavailable exchange status");
    assertEquals(
      await response.json(),
      { error: "Session protection unavailable" },
      "unavailable exchange body",
    );
  } finally {
    fetchMock.restore();
  }
});

Deno.test("session exchange: invalid payload is rejected before contacting Supabase", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response(null, { status: 500 }))
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/exchange", {}, { access_token: "a" }),
      baseEnv({ SESSION_EXCHANGE_RATE_LIMITER: ALLOWED_LIMITER }),
      "exchange",
    );
    assertEquals(response.status, 400, "invalid exchange payload status");
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 0, "invalid payload no upstream call");
});

Deno.test("session exchange: unmarshalled JSON body falls back to empty payload and is rejected", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response(null, { status: 500 }))
  );
  try {
    const response = await call(
      new Request("https://edge.itemtraxx.com/auth/session/exchange", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "cf-connecting-ip": "203.0.113.42",
          "x-itx-session-request": "1",
        },
        body: "not-json",
      }),
      baseEnv({ SESSION_EXCHANGE_RATE_LIMITER: ALLOWED_LIMITER }),
      "exchange",
    );
    assertEquals(response.status, 400, "malformed JSON exchange status");
  } finally {
    fetchMock.restore();
  }
});

Deno.test("session exchange: JSON null payload is rejected without a Worker exception", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response(null, { status: 500 }))
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/exchange", {}, null),
      baseEnv({ SESSION_EXCHANGE_RATE_LIMITER: ALLOWED_LIMITER }),
      "exchange",
    );
    assertEquals(response.status, 400, "null exchange status");
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 0, "null body no upstream call");
});

Deno.test("session exchange: oversized declared bodies are rejected before parsing", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response(null, { status: 500 }))
  );
  try {
    const response = await call(
      mutationRequest(
        "/auth/session/exchange",
        { "content-length": String(MAX_SESSION_EXCHANGE_BODY_BYTES + 1) },
        { access_token: "a", refresh_token: "r" },
      ),
      baseEnv({ SESSION_EXCHANGE_RATE_LIMITER: ALLOWED_LIMITER }),
      "exchange",
    );
    assertEquals(response.status, 413, "oversized exchange status");
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 0, "oversized body no upstream call");
});

Deno.test("session exchange: failed upstream auth lookup short-circuits before loading the profile", async () => {
  const fetchMock = installFetch((url) => {
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(new Response(null, { status: 401 }));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      mutationRequest("/auth/session/exchange", {}, {
        access_token: "bad-token",
        refresh_token: "r",
      }),
      baseEnv({ SESSION_EXCHANGE_RATE_LIMITER: ALLOWED_LIMITER }),
      "exchange",
    );
    assertEquals(response.status, 401, "failed auth lookup exchange status");
    assertEquals(await response.json(), { error: "Unauthorized" }, "body");
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 1, "profile must not be queried");
  assert(
    fetchMock.calls[0].url.endsWith("/auth/v1/user"),
    "only the auth user lookup runs",
  );
});

// ---- refresh ----

Deno.test("session refresh: missing refresh cookie clears cookies without contacting Supabase", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response(null, { status: 500 }))
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/refresh"),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "refresh",
    );
    assertEquals(response.status, 401, "missing refresh cookie status");
    assertEquals(getSetCookies(response), [
      "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ], "missing refresh cookie clears cookies");
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 0, "no upstream call without a cookie");
});

Deno.test("session refresh: rate-limited request is rejected", async () => {
  const response = await call(
    mutationRequest("/auth/session/refresh", { cookie: "itx_refresh=old" }),
    baseEnv({ SESSION_REFRESH_RATE_LIMITER: LIMITED_LIMITER }),
    "refresh",
  );
  assertEquals(response.status, 429, "rate-limited refresh status");
});

Deno.test("session refresh: missing rate limiter binding fails closed", async () => {
  const response = await call(
    mutationRequest("/auth/session/refresh", { cookie: "itx_refresh=old" }),
    baseEnv(),
    "refresh",
  );
  assertEquals(response.status, 503, "unavailable refresh status");
});

Deno.test("session refresh: rejected refresh token clears cookies", async () => {
  const fetchMock = installFetch((url) => {
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(new Response(null, { status: 400 }));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      mutationRequest("/auth/session/refresh", {
        cookie: "itx_refresh=expired",
      }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "refresh",
    );
    assertEquals(response.status, 401, "rejected refresh status");
    assertEquals(getSetCookies(response), [
      "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ], "rejected refresh clears cookies");
  } finally {
    fetchMock.restore();
  }
});

Deno.test("session refresh: token response missing fields is treated as unauthorized", async () => {
  const fetchMock = installFetch((url) => {
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(Response.json({ access_token: "only-access" }));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      mutationRequest("/auth/session/refresh", {
        cookie: "itx_refresh=partial",
      }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "refresh",
    );
    assertEquals(response.status, 401, "incomplete token payload status");
  } finally {
    fetchMock.restore();
  }
});

const refreshFixture = (profileRows: unknown[], newAccessToken: string) =>
  installFetch((url) => {
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(
        Response.json({
          access_token: newAccessToken,
          refresh_token: "new-refresh",
        }),
      );
    }
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(Response.json({ id: "user-1" }));
    }
    if (url.includes("/rest/v1/profiles?")) {
      return Promise.resolve(Response.json(profileRows));
    }
    if (url.includes("/rest/v1/account_sessions?")) {
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });

Deno.test("session refresh: successful rotation with no matching profile skips the active-session check", async () => {
  const fetchMock = refreshFixture([], jwt({ session_id: "sess-1" }));
  try {
    const response = await call(
      mutationRequest("/auth/session/refresh", { cookie: "itx_refresh=old" }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "refresh",
    );
    assertEquals(response.status, 200, "no-profile refresh status");
    const body = await response.json() as { profile: unknown };
    assertEquals(body.profile, null, "no-profile refresh body");
  } finally {
    fetchMock.restore();
  }
  assert(
    !fetchMock.calls.some((entry) =>
      entry.url.includes("/rest/v1/account_sessions?")
    ),
    "account_sessions must not be queried when there is no profile row",
  );
});

Deno.test("session refresh: non-super-admin profile with no active application session is rejected", async () => {
  const fetchMock = refreshFixture(
    [{
      id: "user-1",
      role: "staff",
      workspace_id: "ws-1",
      auth_email: null,
      is_active: true,
      deleted_at: null,
    }],
    jwt({ session_id: "sess-1" }),
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/refresh", { cookie: "itx_refresh=old" }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "refresh",
    );
    assertEquals(response.status, 401, "no active session refresh status");
    assertEquals(getSetCookies(response), [
      "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ], "revoked-session refresh clears cookies");
  } finally {
    fetchMock.restore();
  }
  assert(
    fetchMock.calls.some((entry) =>
      entry.url.includes("/rest/v1/account_sessions?")
    ),
    "account_sessions must be queried for a non-super-admin profile",
  );
});

Deno.test("session refresh: staff profile whose access token has no session claim is rejected without a lookup", async () => {
  const fetchMock = refreshFixture(
    [{
      id: "user-1",
      role: "staff",
      workspace_id: "ws-1",
      auth_email: null,
      is_active: true,
      deleted_at: null,
    }],
    jwt({}),
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/refresh", { cookie: "itx_refresh=old" }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "refresh",
    );
    assertEquals(response.status, 401, "missing session claim status");
  } finally {
    fetchMock.restore();
  }
  assert(
    !fetchMock.calls.some((entry) =>
      entry.url.includes("/rest/v1/account_sessions?")
    ),
    "account_sessions must not be queried without a session_id claim",
  );
});

Deno.test("session refresh: super_admin profile bypasses the account_sessions lookup entirely", async () => {
  const fetchMock = refreshFixture(
    [{
      id: "user-1",
      role: "super_admin",
      workspace_id: null,
      auth_email: null,
      is_active: true,
      deleted_at: null,
    }],
    jwt({}),
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/refresh", { cookie: "itx_refresh=old" }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "refresh",
    );
    assertEquals(response.status, 200, "super_admin refresh status");
  } finally {
    fetchMock.restore();
  }
  assert(
    !fetchMock.calls.some((entry) =>
      entry.url.includes("/rest/v1/account_sessions?")
    ),
    "super_admin refresh must not consult account_sessions",
  );
});

Deno.test("session refresh: staff profile with a matching live device session succeeds", async () => {
  const fetchMock = installFetch((url) => {
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(
        Response.json({
          access_token: jwt({
            session_id: "sess-1",
            amr: [{ method: "password", timestamp: 1785021234 }],
          }),
          refresh_token: "new-refresh",
        }),
      );
    }
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(Response.json({ id: "user-1" }));
    }
    if (url.includes("/rest/v1/profiles?")) {
      return Promise.resolve(Response.json([{
        id: "user-1",
        role: "staff",
        workspace_id: "ws-1",
        auth_email: "staff@example.com",
        is_active: true,
        deleted_at: null,
      }]));
    }
    if (url.includes("/rest/v1/account_sessions?")) {
      return Promise.resolve(Response.json([{ id: "session-row-1" }]));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      mutationRequest("/auth/session/refresh", { cookie: "itx_refresh=old" }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "refresh",
    );
    assertEquals(response.status, 200, "active session refresh status");
    const body = await response.json() as {
      authenticated: boolean;
      password_authenticated_at: string | null;
    };
    assertEquals(body.authenticated, true, "active session authenticated");
    assertEquals(
      body.password_authenticated_at,
      new Date(1785021234 * 1000).toISOString(),
      "password_authenticated_at derived from amr claim",
    );
  } finally {
    fetchMock.restore();
  }
});

// ---- logout ----

Deno.test("session logout: with an access-token cookie revokes only this session and clears cookies", async () => {
  // Model two independent Supabase sessions so this contract catches a
  // regression to the API's global (default) logout scope.
  const activeSupabaseSessions = new Set(["access-1", "access-2"]);
  const fetchMock = installFetch((url, init) => {
    const upstreamUrl = new URL(url);
    if (upstreamUrl.pathname.endsWith("/auth/v1/logout")) {
      const token = new Headers(init?.headers).get("authorization")?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (upstreamUrl.searchParams.get("scope") === "local" && token) {
        activeSupabaseSessions.delete(token);
      } else {
        activeSupabaseSessions.clear();
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      mutationRequest("/auth/session/logout", {
        cookie: "itx_session=access-1",
      }),
      baseEnv(),
      "logout",
    );
    assertEquals(response.status, 200, "logout status");
    assertEquals(await response.json(), { ok: true }, "logout body");
    assertEquals(getSetCookies(response), [
      "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ], "logout clears cookies");
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 1, "logout notifies Supabase once");
  assertEquals(
    activeSupabaseSessions.has("access-1"),
    false,
    "logout revokes the current device session",
  );
  assertEquals(
    activeSupabaseSessions.has("access-2"),
    true,
    "logout preserves the other device session",
  );
  assertEquals(
    fetchMock.calls[0].url,
    `${SUPABASE_URL}/auth/v1/logout?scope=local`,
    "logout uses the local Supabase scope so other devices remain signed in",
  );
  assertEquals(
    new Headers(fetchMock.calls[0].init?.headers).get("authorization"),
    "Bearer access-1",
    "logout forwards the access token",
  );
});

Deno.test("session logout: without an access-token cookie skips the upstream call", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response("unexpected", { status: 500 }))
  );
  try {
    const response = await call(
      mutationRequest("/auth/session/logout"),
      baseEnv(),
      "logout",
    );
    assertEquals(response.status, 200, "cookie-less logout status");
    assertEquals(await response.json(), { ok: true }, "cookie-less logout body");
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 0, "no upstream call without a cookie");
});

// ---- me ----

Deno.test("session me: no cookies returns the unauthenticated summary without any Set-Cookie header", async () => {
  const fetchMock = installFetch(() =>
    Promise.resolve(new Response("unexpected", { status: 500 }))
  );
  try {
    const response = await call(meRequest(), baseEnv(), "me");
    assertEquals(response.status, 200, "no-cookie me status");
    assertEquals(await response.json(), {
      authenticated: false,
      user: null,
      profile: null,
      password_authenticated_at: null,
    }, "no-cookie me body");
    assertEquals(response.headers.get("set-cookie"), null, "no set-cookie");
  } finally {
    fetchMock.restore();
  }
  assertEquals(fetchMock.calls.length, 0, "no upstream call without cookies");
});

Deno.test("session me: a valid access-token cookie is used directly without refreshing", async () => {
  const fetchMock = installFetch((url) => {
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(Response.json({ id: "user-1" }));
    }
    if (url.includes("/rest/v1/profiles?")) {
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      meRequest({ cookie: "itx_session=good-access" }),
      baseEnv(),
      "me",
    );
    assertEquals(response.status, 200, "direct access token me status");
    const body = await response.json() as { authenticated: boolean };
    assertEquals(body.authenticated, true, "direct access token authenticated");
  } finally {
    fetchMock.restore();
  }
  assert(
    !fetchMock.calls.some((entry) =>
      entry.url.includes("/auth/v1/token?grant_type=refresh_token")
    ),
    "a present access token must not trigger a refresh",
  );
});

Deno.test("session me: an invalid access-token cookie falls back to the unauthenticated summary and clears cookies", async () => {
  const fetchMock = installFetch((url) => {
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(new Response(null, { status: 401 }));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      meRequest({ cookie: "itx_session=stale-access" }),
      baseEnv(),
      "me",
    );
    assertEquals(response.status, 200, "invalid access token me status");
    const body = await response.json() as { authenticated: boolean };
    assertEquals(body.authenticated, false, "invalid access token unauthenticated");
    assertEquals(getSetCookies(response), [
      "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ], "invalid access token clears cookies");
  } finally {
    fetchMock.restore();
  }
});

Deno.test("session me: rate-limited implicit refresh surfaces the rate-limit error", async () => {
  const response = await call(
    meRequest({ cookie: "itx_refresh=old" }),
    baseEnv({ SESSION_REFRESH_RATE_LIMITER: LIMITED_LIMITER }),
    "me",
  );
  assertEquals(response.status, 429, "me implicit refresh rate-limited status");
});

Deno.test("session me: only a refresh-token cookie present rotates cookies on success", async () => {
  const fetchMock = installFetch((url) => {
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(
        Response.json({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
        }),
      );
    }
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(Response.json({ id: "user-1" }));
    }
    if (url.includes("/rest/v1/profiles?")) {
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      meRequest({ cookie: "itx_refresh=old" }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "me",
    );
    assertEquals(response.status, 200, "me implicit refresh status");
    assertEquals(getSetCookies(response), [
      "itx_session=fresh-access; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=fresh-refresh; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
    ], "me implicit refresh cookies");
  } finally {
    fetchMock.restore();
  }
  assert(
    !fetchMock.calls.some((entry) =>
      entry.url.includes("/rest/v1/account_sessions?")
    ),
    "me does not require an active application session",
  );
});

Deno.test("session me: an expired refresh token falls back to the unauthenticated summary and clears cookies", async () => {
  const fetchMock = installFetch((url) => {
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return Promise.resolve(new Response(null, { status: 400 }));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
  try {
    const response = await call(
      meRequest({ cookie: "itx_refresh=expired" }),
      baseEnv({ SESSION_REFRESH_RATE_LIMITER: ALLOWED_LIMITER }),
      "me",
    );
    assertEquals(response.status, 200, "me expired refresh status");
    const body = await response.json() as { authenticated: boolean };
    assertEquals(body.authenticated, false, "me expired refresh unauthenticated");
    assertEquals(getSetCookies(response), [
      "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ], "me expired refresh clears cookies");
  } finally {
    fetchMock.restore();
  }
});

// ---- maybeRefreshSession (direct unit coverage) ----

Deno.test("maybeRefreshSession: no refresh cookie is a no-op", async () => {
  const result = await maybeRefreshSession(
    new Request("https://edge.itemtraxx.com/auth/session/me"),
    baseEnv(),
    { accessToken: null, refreshToken: null },
  );
  assertEquals(result, { session: null, headers: null, failure: null }, "no-op result");
});

Deno.test("maybeRefreshSession: unavailable rate limiter surfaces as a failure", async () => {
  const result = await maybeRefreshSession(
    new Request("https://edge.itemtraxx.com/auth/session/me", {
      headers: { "cf-connecting-ip": "203.0.113.42" },
    }),
    baseEnv(),
    { accessToken: null, refreshToken: "old" },
  );
  assertEquals(result.session, null, "unavailable session");
  assertEquals(result.failure, "unavailable", "unavailable failure");
});
