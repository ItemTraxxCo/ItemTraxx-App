import { proxyFunctionRequest } from "./functionProxy.ts";
import { MAX_PROXY_REQUEST_BODY_BYTES } from "./requestBody.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("non-status function proxy preserves streamed response bytes, status, and headers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(new Uint8Array([222, 173, 190, 239]), {
        status: 418,
        headers: {
          "content-type": "application/octet-stream",
          "x-upstream": "kept",
        },
      }),
    )) as typeof fetch;
  try {
    const response = await proxyFunctionRequest(
      new Request("https://edge.itemtraxx.com/functions/contact-support-submit"),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
      } as Env,
      { "Access-Control-Allow-Credentials": "true" },
      "request-2",
      "contact-support-submit",
    );
    assertEquals(response.status, 418, "response status");
    assertEquals(Array.from(new Uint8Array(await response.arrayBuffer())), [
      222,
      173,
      190,
      239,
    ], "response bytes");
    assertEquals(
      response.headers.get("content-type"),
      "application/octet-stream",
      "content type",
    );
    assertEquals(response.headers.get("x-upstream"), "kept", "upstream header");
    assertEquals(
      response.headers.get("x-request-id"),
      "request-2",
      "request ID",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("support function proxy preserves the attachment payload limit", async () => {
  const originalFetch = globalThis.fetch;
  let receivedBytes = 0;
  const body = "x".repeat(MAX_PROXY_REQUEST_BODY_BYTES + 1);
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const forwardedBody = init?.body as Uint8Array | undefined;
    receivedBytes = forwardedBody?.byteLength ?? 0;
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;
  try {
    const response = await proxyFunctionRequest(
      new Request("https://edge.itemtraxx.com/functions/contact-support-submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        PUBLIC_SUBMISSION_RATE_LIMITER: {
          limit: async () => ({ success: true }),
        },
      } as Env,
      {},
      "request-support-large",
      "contact-support-submit",
    );
    assertEquals(response.status, 200, "support response status");
    assertEquals(receivedBytes, body.length, "support forwarded body size");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("default function proxy limit still rejects oversized non-support bodies", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = (() => {
    upstreamCalled = true;
    return Promise.resolve(new Response("unexpected", { status: 200 }));
  }) as typeof fetch;
  try {
    const response = await proxyFunctionRequest(
      new Request("https://edge.itemtraxx.com/functions/admin-ops", {
        method: "POST",
        body: "x".repeat(MAX_PROXY_REQUEST_BODY_BYTES + 1),
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
      } as Env,
      {},
      "request-admin-large",
      "admin-ops",
    );
    assertEquals(response.status, 413, "default oversized response status");
    assertEquals(upstreamCalled, false, "default oversized request must not reach upstream");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const cachedMaintenance = {
  enabled: true,
  message: "Scheduled work",
  updated_at: "2026-07-13T00:00:00Z",
};

const statusEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  PUBLIC_STATUS_RATE_LIMITER: {
    limit: async () => ({ success: true }),
  },
  MAINTENANCE_FALLBACK_KV: {
    get: (_key: string, type?: string) =>
      Promise.resolve(
        type === "json" ? cachedMaintenance : JSON.stringify(cachedMaintenance),
      ),
  },
} as unknown as Env;

Deno.test("rejects a public support request before reading or forwarding its body", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  let bodyRead = false;
  globalThis.fetch = (() => {
    upstreamCalled = true;
    return Promise.resolve(new Response("unexpected", { status: 200 }));
  }) as typeof fetch;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      bodyRead = true;
      controller.enqueue(new TextEncoder().encode("{}"));
      controller.close();
    },
  }, { highWaterMark: 0 });
  try {
    const response = await proxyFunctionRequest(
      new Request("https://edge.itemtraxx.com/functions/contact-support-submit", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.8" },
        body,
        duplex: "half",
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        PUBLIC_SUBMISSION_RATE_LIMITER: {
          limit: async ({ key }: { key: string }) => ({
            success: key === "contact-support-submit:203.0.113.8" ? false : true,
          }),
        },
      } as Env,
      {},
      "request-support-throttled",
      "contact-support-submit",
    );
    assertEquals(response.status, 429, "over-budget status");
    assertEquals(bodyRead, false, "body is rejected before it is read");
    assertEquals(upstreamCalled, false, "over-budget body is not proxied");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("invitation and email-change token routes are public but rate limited before proxying", async () => {
  const originalFetch = globalThis.fetch;
  const proxied: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    proxied.push(String(input));
    return Promise.resolve(new Response("{\"success\":true}", { status: 200 }));
  }) as typeof fetch;
  const rateLimitKeys: string[] = [];
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    ITX_EDGE_PROXY_SHARED_SECRET: "trusted-edge-secret",
    PUBLIC_SUBMISSION_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        rateLimitKeys.push(key);
        return { success: true };
      },
    },
  } as Env;
  try {
    for (const functionName of ["workspace-invitation", "account-email-change"]) {
      const response = await proxyFunctionRequest(
        new Request(`https://edge.itemtraxx.com/functions/${functionName}`, {
          method: "POST",
          headers: { "cf-connecting-ip": "203.0.113.9" },
          body: "{}",
        }),
        env,
        {},
        `request-${functionName}`,
        functionName,
      );
      assertEquals(response.status, 200, `${functionName} public response`);
    }
    assertEquals(proxied.length, 2, "both token routes reach the Edge Function without a session");
    assertEquals(rateLimitKeys, [
      "workspace-invitation:203.0.113.9",
      "account-email-change:203.0.113.9",
    ], "each token route is rate limited under its own IP scope");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("system-status skips fallback mutation when declared Content-Length exceeds the JSON cap", async () => {
  const originalFetch = globalThis.fetch;
  const raw = JSON.stringify({ status: "down", checks: { db: "failed" } });
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(raw, {
        status: 503,
        headers: {
          "content-length": String(64 * 1024 + 1),
          "content-type": "application/json",
          "x-upstream": "kept",
        },
      }),
    )) as typeof fetch;
  try {
    const response = await proxyFunctionRequest(
      new Request("https://edge.itemtraxx.com/functions/system-status"),
      statusEnv,
      {},
      "request-declared-large",
      "system-status",
    );
    assertEquals(response.status, 503, "response status");
    assertEquals(await response.text(), raw, "original body");
    assertEquals(
      response.headers.get("content-length"),
      String(64 * 1024 + 1),
      "content length",
    );
    assertEquals(response.headers.get("x-upstream"), "kept", "upstream header");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("system-status stops an unknown-length clone after the JSON cap and streams the original body", async () => {
  const originalFetch = globalThis.fetch;
  const raw = JSON.stringify({
    status: "down",
    checks: { db: "failed" },
    padding: "x".repeat(64 * 1024),
  });
  const bytes = new TextEncoder().encode(raw);
  globalThis.fetch = (() => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 32 * 1024));
        controller.enqueue(bytes.slice(32 * 1024));
        controller.close();
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 503,
        headers: {
          "content-length": "not-a-number",
          "content-type": "application/json",
          "x-upstream": "kept",
        },
      }),
    );
  }) as typeof fetch;
  try {
    const response = await proxyFunctionRequest(
      new Request("https://edge.itemtraxx.com/functions/system-status"),
      statusEnv,
      {},
      "request-stream-large",
      "system-status",
    );
    assertEquals(response.status, 503, "response status");
    assertEquals(await response.text(), raw, "original streamed body");
    assertEquals(
      response.headers.get("content-length"),
      "not-a-number",
      "invalid length preserved",
    );
    assertEquals(response.headers.get("x-upstream"), "kept", "upstream header");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("small system-status JSON retains maintenance fallback mutation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(Response.json(
      { status: "down", checks: { db: "failed" } },
      { status: 503 },
    ))) as typeof fetch;
  try {
    const response = await proxyFunctionRequest(
      new Request("https://edge.itemtraxx.com/functions/system-status"),
      statusEnv,
      {},
      "request-small",
      "system-status",
    );
    assertEquals(await response.json(), {
      status: "down",
      checks: { db: "failed" },
      maintenance: cachedMaintenance,
      maintenance_fallback: true,
    }, "small status fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
