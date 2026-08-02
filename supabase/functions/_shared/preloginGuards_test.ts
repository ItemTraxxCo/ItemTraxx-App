import {
  enforcePreloginRateLimit,
  resolveClientFingerprint,
  resolveClientIp,
  resolveRateLimitResult,
  verifyTurnstileToken,
} from "./preloginGuards.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("prelogin rate limit uses the service-side RPC contract", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, ...args });
      return { data: [{ allowed: true, retry_after_seconds: null }], error: null };
    },
  };

  const result = await enforcePreloginRateLimit(
    client,
    "ip-203-0-113-42",
    "workspace-login",
    5,
    60,
  );

  assert(result.ok, "expected the allowed RPC result");
  const observedCall = calls[0];
  if (!observedCall) throw new Error("expected an observed RPC call");
  assert(observedCall.name === "consume_rate_limit_prelogin", "expected the prelogin RPC");
  assert(observedCall.p_key === "ip-203-0-113-42", "expected the client key");
  assert(observedCall.p_scope === "workspace-login", "expected the rate-limit scope");
  assert(observedCall.p_limit === 5, "expected the rate-limit limit");
  assert(observedCall.p_window_seconds === 60, "expected the rate-limit window");
});

Deno.test("resolveClientFingerprint prefers trusted Cloudflare IP", () => {
  const request = new Request("https://example.com", {
    headers: {
      "cf-connecting-ip": "203.0.113.42",
      "user-agent": "AttackerBot/1.0",
    },
  });

  const fingerprint = resolveClientFingerprint(request, null, {
    trustProxyHeader: true,
  });
  assert(
    fingerprint === "ip-203-0-113-42",
    "expected trusted Cloudflare IP fingerprint",
  );
});

Deno.test("per-IP status buckets keep distinct client addresses separate", () => {
  const first = resolveClientFingerprint(
    new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.42" },
    }),
    null,
    { trustProxyHeader: true },
  );
  const second = resolveClientFingerprint(
    new Request("https://example.com", {
      headers: { "cf-connecting-ip": "198.51.100.7" },
    }),
    null,
    { trustProxyHeader: true },
  );
  assert(first !== second, "expected distinct client IPs to use distinct buckets");
});

Deno.test("resolveClientFingerprint does not fall back to user-agent", () => {
  const request = new Request("https://example.com", {
    headers: {
      "user-agent": "AttackerBot/1.0",
    },
  });

  const fingerprint = resolveClientFingerprint(request, null);
  assert(
    fingerprint === "unknown-client",
    "expected non-IP clients to share the unknown-client bucket",
  );
});

Deno.test("resolveClientFingerprint ignores proxy headers for direct callers", () => {
  const request = new Request("https://example.com", {
    headers: { "cf-connecting-ip": "203.0.113.42" },
  });

  const fingerprint = resolveClientFingerprint(request, null, {
    trustProxyHeader: false,
  });
  assert(
    fingerprint === "unknown-client",
    "expected forged direct proxy headers to remain in the anonymous bucket",
  );
});

Deno.test("resolveClientIp trims and returns the trusted Cloudflare header", () => {
  const request = new Request("https://example.com", {
    headers: { "cf-connecting-ip": "  203.0.113.42  " },
  });
  assert(
    resolveClientIp(request) === "203.0.113.42",
    "expected trimmed connecting IP",
  );
});

Deno.test("resolveClientIp returns empty string when header is absent", () => {
  const request = new Request("https://example.com");
  assert(resolveClientIp(request) === "", "expected empty client IP fallback");
});

Deno.test("prelogin rate limit surfaces RPC errors", async () => {
  const client = {
    rpc: async () => ({ data: null, error: { message: "db unavailable" } }),
  };

  const result = await enforcePreloginRateLimit(client, "ip-1", "scope", 5, 60);
  assert(!result.ok, "expected RPC error to fail closed");
  assert(
    result.error?.message === "db unavailable",
    "expected the underlying RPC error to be surfaced",
  );
});

Deno.test("prelogin rate limit reports no-rows RPC responses as failures", async () => {
  const client = {
    rpc: async () => ({ data: [], error: null }),
  };

  const result = await enforcePreloginRateLimit(client, "ip-1", "scope", 5, 60);
  assert(!result.ok, "expected no-rows RPC response to fail closed");
  assert(
    result.error?.message === "Rate limit RPC returned no rows.",
    "expected the no-rows fallback message",
  );
});

Deno.test("prelogin rate limit rejects when the limit is exceeded", async () => {
  const client = {
    rpc: async () => ({
      data: { allowed: false, retry_after_seconds: 30 },
      error: null,
    }),
  };

  const result = await enforcePreloginRateLimit(client, "ip-1", "scope", 5, 60);
  assert(!result.ok, "expected disallowed result to fail");
  assert(result.error === null, "expected no error object for a clean denial");
});

Deno.test("resolveRateLimitResult returns a failure response on RPC error", () => {
  const responses: Array<{ status: number; body: Record<string, unknown> }> = [];
  const jsonResponse = (status: number, body: Record<string, unknown>) => {
    responses.push({ status, body });
    return new Response(JSON.stringify(body), { status });
  };

  const outcome = resolveRateLimitResult({
    data: null,
    error: { message: "boom" },
    jsonResponse,
  });

  assert(outcome.result === null, "expected no result on error");
  assert(outcome.response?.status === 500, "expected default failure status");
  assert(
    responses[0]?.body.error === "Rate limit check failed",
    "expected default failure message",
  );
});

Deno.test("resolveRateLimitResult honors custom failure status and message", () => {
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status });

  const outcome = resolveRateLimitResult({
    data: null,
    error: { message: "boom" },
    jsonResponse,
    failureStatus: 503,
    failureMessage: "Try again later",
  });

  assert(outcome.response?.status === 503, "expected custom failure status");
});

Deno.test("resolveRateLimitResult treats empty rows as a failure", () => {
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status });

  const outcome = resolveRateLimitResult({
    data: [],
    error: null,
    jsonResponse,
  });

  assert(outcome.result === null, "expected empty array data to fail closed");
  assert(outcome.response?.status === 500, "expected a failure response");
});

Deno.test("resolveRateLimitResult unwraps array and object row shapes", () => {
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status });

  const fromArray = resolveRateLimitResult({
    data: [{ allowed: true, retry_after_seconds: null }],
    error: null,
    jsonResponse,
  });
  assert(fromArray.response === null, "expected no failure response");
  assert(fromArray.result?.allowed === true, "expected allowed result from array data");

  const fromObject = resolveRateLimitResult({
    data: { allowed: false, retry_after_seconds: 12 },
    error: null,
    jsonResponse,
  });
  assert(fromObject.response === null, "expected no failure response for object data");
  assert(
    fromObject.result?.retry_after_seconds === 12,
    "expected object data to pass through unchanged",
  );
});

const withTurnstileSecret = async (run: () => Promise<void>) => {
  const previous = Deno.env.get("ITX_TURNSTILE_SECRET");
  Deno.env.set("ITX_TURNSTILE_SECRET", "turnstile-test-secret");
  try {
    await run();
  } finally {
    if (previous === undefined) {
      Deno.env.delete("ITX_TURNSTILE_SECRET");
    } else {
      Deno.env.set("ITX_TURNSTILE_SECRET", previous);
    }
  }
};

const withStubbedFetch = async (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

Deno.test("verifyTurnstileToken fails closed when no secret is configured", async () => {
  const previousA = Deno.env.get("ITX_TURNSTILE_SECRET");
  const previousB = Deno.env.get("ITX_TURNSTILE_SECRET_KEY");
  Deno.env.delete("ITX_TURNSTILE_SECRET");
  Deno.env.delete("ITX_TURNSTILE_SECRET_KEY");
  let fetchCalled = false;
  try {
    await withStubbedFetch(
      async () => {
        fetchCalled = true;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
      async () => {
        const result = await verifyTurnstileToken("token", "203.0.113.1", "ctx");
        assert(!result, "expected missing-secret verification to fail");
      },
    );
  } finally {
    if (previousA !== undefined) Deno.env.set("ITX_TURNSTILE_SECRET", previousA);
    if (previousB !== undefined) {
      Deno.env.set("ITX_TURNSTILE_SECRET_KEY", previousB);
    }
  }
  assert(!fetchCalled, "expected no verification request without a secret");
});

Deno.test("verifyTurnstileToken accepts a successful initial verification", async () => {
  await withTurnstileSecret(async () => {
    await withStubbedFetch(
      async () =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      async () => {
        const result = await verifyTurnstileToken(
          "good-token",
          "203.0.113.1",
          "ctx",
        );
        assert(result, "expected successful verification to pass");
      },
    );
  });
});

Deno.test("verifyTurnstileToken retries without remote IP and succeeds", async () => {
  await withTurnstileSecret(async () => {
    let callCount = 0;
    await withStubbedFetch(
      async (_input, init) => {
        callCount += 1;
        const body = new URLSearchParams(String(init?.body ?? ""));
        const usedRemoteIp = body.has("remoteip");
        return new Response(
          JSON.stringify({ success: !usedRemoteIp }),
          { status: 200 },
        );
      },
      async () => {
        const result = await verifyTurnstileToken(
          "retry-token",
          "203.0.113.1",
          "ctx",
        );
        assert(result, "expected the no-remote-ip retry to succeed");
        assert(callCount === 2, "expected exactly one retry attempt");
      },
    );
  });
});

Deno.test("verifyTurnstileToken fails when both attempts are rejected", async () => {
  await withTurnstileSecret(async () => {
    await withStubbedFetch(
      async () =>
        new Response(
          JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
          { status: 200 },
        ),
      async () => {
        const result = await verifyTurnstileToken(
          "bad-token",
          "203.0.113.1",
          "ctx",
        );
        assert(!result, "expected both failed attempts to reject the token");
      },
    );
  });
});

Deno.test("verifyTurnstileToken fails closed without a retry when remote IP is absent", async () => {
  await withTurnstileSecret(async () => {
    let callCount = 0;
    await withStubbedFetch(
      async () => {
        callCount += 1;
        return new Response(JSON.stringify({ success: false }), { status: 200 });
      },
      async () => {
        const result = await verifyTurnstileToken("bad-token", "", "ctx");
        assert(!result, "expected verification to fail without a remote IP retry");
        assert(callCount === 1, "expected no retry when no remote IP was supplied");
      },
    );
  });
});

Deno.test("verifyTurnstileToken treats a non-OK verification response as a failure", async () => {
  await withTurnstileSecret(async () => {
    await withStubbedFetch(
      async () => new Response("upstream error", { status: 502 }),
      async () => {
        const result = await verifyTurnstileToken("token", "", "ctx");
        assert(!result, "expected a non-OK upstream response to fail closed");
      },
    );
  });
});
