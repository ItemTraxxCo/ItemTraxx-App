import {
  auditSuccessfulSupabaseRead,
  proxySupabaseApiRequest,
} from "./supabaseApiProxy.ts";
import {
  hashTrustedIngressBody,
  signTrustedIngress,
} from "./trustedIngress.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("Data API proxy rejects legacy Supabase cookies", async () => {
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
          cookie: "__Host-itx_session=old-access; __Host-itx_refresh=old-refresh",
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
    assertEquals(response.status, 401, "response status");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assertEquals(calls, [], "legacy tokens never reach upstream");
});

Deno.test("successful targeted item reads create signed, actor-scoped audit requests", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)) as Record<string, unknown>,
    });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    await auditSuccessfulSupabaseRead(
      new Request("https://edge.itemtraxx.com/rest/v1/items?id=eq.00000000-0000-4000-8000-000000000001", {
        headers: { origin: "https://itemtraxx.com" },
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        ITX_EDGE_PROXY_SHARED_SECRET: "shared-test-secret",
      } as Env,
      "request-audit-1",
      "/rest/v1/items",
      "signed-better-auth-session",
      Response.json([{ id: "00000000-0000-4000-8000-000000000002" }]),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (calls.length !== 1) throw new Error("Expected one signed audit-function request");
  if (calls[0]?.url !== "https://example.supabase.co/functions/v1/security-audit") {
    throw new Error("Audit must use the internal Supabase Edge Function route");
  }
  if (calls[0]?.body.action !== "read_item_target") {
    throw new Error("An explicit item-ID filter must be classified as a targeted read");
  }
  if (JSON.stringify(calls[0]?.body.item_ids) !== JSON.stringify([
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000001",
  ])) {
    throw new Error("Audit requests retain both returned and queried resource IDs");
  }
  if (JSON.stringify(calls[0]?.body.returned_item_ids) !== JSON.stringify([
    "00000000-0000-4000-8000-000000000002",
  ])) {
    throw new Error("Only IDs read from the upstream response are marked returned");
  }
  if (calls[0]?.body.http_status !== 200) {
    throw new Error("The upstream HTTP status is correlated with the audit request");
  }
  const signature = calls[0]?.headers.get("x-itx-edge-proxy-signature");
  if (!signature) {
    throw new Error("Audit request must carry a trusted-ingress signature");
  }
  // The audit call must be signed with the internal-only target. A signature
  // over the routed function name is what the generic function proxy produces
  // for browser requests, so it must never match.
  const timestamp = calls[0]?.headers.get("x-itx-edge-proxy-ts") ?? "";
  const bodyHash = await hashTrustedIngressBody(
    new TextEncoder().encode(JSON.stringify(calls[0]?.body)),
  );
  const signFor = (target: string) =>
    signTrustedIngress(
      "shared-test-secret",
      `${timestamp}.request-audit-1.POST.${target}.${bodyHash}`,
    );
  if (signature !== await signFor("security-audit:internal")) {
    throw new Error("Audit request must be signed for the internal-only target");
  }
  if (signature === await signFor("security-audit")) {
    throw new Error("Audit request must not be signed as a routed function call");
  }
  if (calls[0]?.headers.get("authorization") !== "Bearer signed-better-auth-session") {
    throw new Error("Audit request must retain caller authorization for RLS validation");
  }
});

Deno.test("item status-history reads are sent to the audit endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let auditBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    auditBody = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await auditSuccessfulSupabaseRead(
      new Request("https://edge.itemtraxx.com/rest/v1/item_status_history?select=item_id", {
        method: "GET",
        headers: { origin: "https://itemtraxx.com" },
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        ITX_EDGE_PROXY_SHARED_SECRET: "shared-test-secret",
      } as Env,
      "request-history-audit",
      "/rest/v1/item_status_history",
      "signed-better-auth-session",
      Response.json([{ item_id: "00000000-0000-4000-8000-000000000004" }]),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (auditBody?.action !== "read_status_history") {
    throw new Error("Status-history reads must use the explicit audit action");
  }
  if (JSON.stringify(auditBody.item_ids) !== JSON.stringify(["00000000-0000-4000-8000-000000000004"])) {
    throw new Error("The audit request must contain only returned item target IDs");
  }
});

Deno.test("ID-filtered activity reads are classified as targeted reads", async () => {
  const originalFetch = globalThis.fetch;
  let auditBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    auditBody = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await auditSuccessfulSupabaseRead(
      new Request("https://edge.itemtraxx.com/rest/v1/item_logs?item_id=eq.00000000-0000-4000-8000-000000000005", {
        method: "GET",
        headers: { origin: "https://itemtraxx.com" },
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        ITX_EDGE_PROXY_SHARED_SECRET: "shared-test-secret",
      } as Env,
      "request-activity-target-audit",
      "/rest/v1/item_logs",
      "signed-better-auth-session",
      Response.json([{ item_id: "00000000-0000-4000-8000-000000000005" }]),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (auditBody?.action !== "read_item_target") {
    throw new Error("An explicit item-ID filter must be classified as a targeted read on activity endpoints");
  }
});
