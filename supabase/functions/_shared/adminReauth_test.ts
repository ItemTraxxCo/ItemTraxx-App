import {
  ADMIN_REAUTH_MAX_AGE_MS,
  checkRecentAdminAuth,
  readLatestAuthTimestampMs,
  requireRecentAdminAuth,
} from "./adminReauth.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
};

const secondsAgo = (seconds: number) =>
  Math.floor((Date.now() - seconds * 1000) / 1000);

const claimsClient = (
  claims: Record<string, unknown> | null,
  error: unknown = null,
) => ({
  auth: {
    getClaims: () =>
      Promise.resolve({
        data: claims ? { claims } : null,
        error,
      }),
  },
});

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status });

Deno.test("latest amr timestamp wins across multiple authentication methods", () => {
  const latest = readLatestAuthTimestampMs({
    amr: [
      { method: "password", timestamp: secondsAgo(600) },
      { method: "magiclink", timestamp: secondsAgo(60) },
    ],
  });
  assert(latest !== null, "a timestamp must be resolved");
  const ageMs = Date.now() - (latest as number);
  assert(
    ageMs < 90_000,
    `most recent method must win, resolved age was ${ageMs}ms`,
  );
});

Deno.test("malformed amr entries never produce a usable timestamp", () => {
  for (
    const claims of [
      {},
      { amr: null },
      { amr: "password" },
      { amr: [] },
      { amr: [null, "password", 42] },
      { amr: [{ method: "password" }] },
      { amr: [{ method: "password", timestamp: "recent" }] },
      { amr: [{ method: "password", timestamp: 0 }] },
      { amr: [{ method: "password", timestamp: Number.NaN }] },
    ]
  ) {
    assertEquals(
      readLatestAuthTimestampMs(claims as Record<string, unknown>),
      null,
      `malformed amr must not yield a timestamp: ${JSON.stringify(claims)}`,
    );
  }
});

Deno.test("a recent interactive authentication passes", async () => {
  const result = await checkRecentAdminAuth(
    claimsClient({ amr: [{ method: "password", timestamp: secondsAgo(60) }] }),
    "token",
  );
  assert(result.fresh, "a 60s-old password authentication must be fresh");
});

Deno.test("passkey and magic-link sign-ins are accepted, not just passwords", async () => {
  for (const method of ["magiclink", "otp", "passkey", "webauthn"]) {
    const result = await checkRecentAdminAuth(
      claimsClient({ amr: [{ method, timestamp: secondsAgo(30) }] }),
      "token",
    );
    assert(result.fresh, `${method} sign-in must satisfy admin re-auth`);
  }
});

Deno.test("an authentication older than the window is refused", async () => {
  const result = await checkRecentAdminAuth(
    claimsClient({
      amr: [{
        method: "password",
        timestamp: secondsAgo(ADMIN_REAUTH_MAX_AGE_MS / 1000 + 60),
      }],
    }),
    "token",
  );
  assert(!result.fresh, "a stale authentication must be refused");
  assertEquals(result.fresh ? "" : result.reason, "stale", "reason");
});

Deno.test("admin re-auth fails closed on unverifiable or timestamp-free tokens", async () => {
  const unverified = await checkRecentAdminAuth(
    claimsClient(null, new Error("bad signature")),
    "token",
  );
  assert(!unverified.fresh, "an unverifiable token must be refused");
  assertEquals(
    unverified.fresh ? "" : unverified.reason,
    "unverified",
    "reason",
  );

  const noTimestamp = await checkRecentAdminAuth(claimsClient({}), "token");
  assert(!noTimestamp.fresh, "a token without amr must be refused");
  assertEquals(
    noTimestamp.fresh ? "" : noTimestamp.reason,
    "no_auth_timestamp",
    "reason",
  );
});

Deno.test("a far-future authentication timestamp is refused", async () => {
  const result = await checkRecentAdminAuth(
    claimsClient({
      amr: [{ method: "password", timestamp: secondsAgo(-3600) }],
    }),
    "token",
  );
  assert(!result.fresh, "a future-dated authentication must not be trusted");
});

Deno.test("requireRecentAdminAuth returns 401 only when the window has lapsed", async () => {
  const allowed = await requireRecentAdminAuth(
    claimsClient({ amr: [{ method: "password", timestamp: secondsAgo(10) }] }),
    "token",
    jsonResponse,
  );
  assertEquals(allowed, null, "a fresh session must not be blocked");

  const blocked = await requireRecentAdminAuth(
    claimsClient({ amr: [{ method: "password", timestamp: secondsAgo(3600) }] }),
    "token",
    jsonResponse,
  );
  assert(blocked !== null, "a stale session must be blocked");
  // 403 matches the step_up_required contract in
  // tests/e2e/admin-mutation-guards.spec.ts and avoids the pointless
  // token-refresh retry that a 401 would trigger in edgeFunctionClient.
  assertEquals(blocked?.status, 403, "status matches the guard contract");
  assertEquals(
    JSON.parse(await (blocked as Response).text()).error,
    "Admin verification required.",
    "message matches the guard contract",
  );
});
