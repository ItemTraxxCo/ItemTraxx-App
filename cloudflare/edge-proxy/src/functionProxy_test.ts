import { proxyFunctionRequest } from "./functionProxy.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

Deno.test("non-status function proxy preserves streamed response bytes, status, and headers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(new Uint8Array([222, 173, 190, 239]), {
    status: 418,
    headers: { "content-type": "application/octet-stream", "x-upstream": "kept" },
  }))) as typeof fetch;
  try {
    const response = await proxyFunctionRequest(
      new Request("https://edge.itemtraxx.com/functions/admin-ops"),
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" } as Env,
      { "Access-Control-Allow-Credentials": "true" },
      "request-2",
      "admin-ops",
    );
    assertEquals(response.status, 418, "response status");
    assertEquals(Array.from(new Uint8Array(await response.arrayBuffer())), [222, 173, 190, 239], "response bytes");
    assertEquals(response.headers.get("content-type"), "application/octet-stream", "content type");
    assertEquals(response.headers.get("x-upstream"), "kept", "upstream header");
    assertEquals(response.headers.get("x-request-id"), "request-2", "request ID");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
