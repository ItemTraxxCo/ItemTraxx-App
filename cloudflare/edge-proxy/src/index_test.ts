import worker from "./index.ts";
import {
  isBlockedRpcProxyPath,
  isUnauthorizedRpcProxyPath,
} from "./routing.ts";

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
