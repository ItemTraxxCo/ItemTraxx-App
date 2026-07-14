import {
  enforcePreloginRateLimit,
  resolveClientFingerprint,
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
    "tenant-login",
    5,
    60,
  );

  assert(result.ok, "expected the allowed RPC result");
  const observedCall = calls[0];
  if (!observedCall) throw new Error("expected an observed RPC call");
  assert(observedCall.name === "consume_rate_limit_prelogin", "expected the prelogin RPC");
  assert(observedCall.p_key === "ip-203-0-113-42", "expected the client key");
  assert(observedCall.p_scope === "tenant-login", "expected the rate-limit scope");
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

  const fingerprint = resolveClientFingerprint(request, null);
  assert(
    fingerprint === "ip-203-0-113-42",
    "expected trusted Cloudflare IP fingerprint",
  );
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
