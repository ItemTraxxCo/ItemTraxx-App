import { proxySupabaseApiRequest } from "./supabaseApiProxy.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("Data API proxy retries 401 with a refreshed cookie session and streams response bytes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<
    { url: string; auth: string | null; body: string | null }
  > = [];
  globalThis.fetch =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization");
      const body = typeof init?.body === "string" ? init.body : null;
      calls.push({ url, auth, body });
      if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
        });
      }
      if (auth === "Bearer old-access") {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(new Uint8Array([0, 255, 7]), {
        status: 206,
        headers: {
          "content-type": "application/octet-stream",
          "x-upstream": "kept",
        },
      });
    }) as typeof fetch;

  try {
    const request = new Request(
      "https://edge.itemtraxx.com/rest/v1/items?select=id",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.42",
          cookie: "itx_session=old-access; itx_refresh=old-refresh",
          "content-type": "application/json",
        },
        body: '{"fixture":true}',
      },
    );
    const response = await proxySupabaseApiRequest(
      request,
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SESSION_REFRESH_RATE_LIMITER: {
          limit: () => Promise.resolve({ success: true }),
        },
      } as Env,
      { "Access-Control-Allow-Origin": "https://itemtraxx.com" },
      "request-1",
      "/rest/v1/items",
    );
    assertEquals(response.status, 206, "response status");
    assertEquals(Array.from(new Uint8Array(await response.arrayBuffer())), [
      0,
      255,
      7,
    ], "streamed bytes");
    assertEquals(response.headers.get("x-upstream"), "kept", "upstream header");
    assertEquals(
      response.headers.get("x-request-id"),
      "request-1",
      "request ID",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assertEquals(calls.map(({ url, auth, body }) => ({ url, auth, body })), [
    {
      url: "https://example.supabase.co/rest/v1/items?select=id",
      auth: "Bearer old-access",
      body: '{"fixture":true}',
    },
    {
      url: "https://example.supabase.co/auth/v1/token?grant_type=refresh_token",
      auth: null,
      body: '{"refresh_token":"old-refresh"}',
    },
    {
      url: "https://example.supabase.co/rest/v1/items?select=id",
      auth: "Bearer new-access",
      body: '{"fixture":true}',
    },
  ], "refresh retry calls");
});
