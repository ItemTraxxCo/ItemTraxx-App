import {
  canRegisterAdminStepUp,
  canRegisterAdminStepUpFromTrustedHandoff,
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
  registerPrivilegedStepUp,
} from "./privilegedStepUp.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const authClient = (claims: Record<string, unknown> | null) =>
  ({
    auth: {
      getClaims: () =>
        Promise.resolve({
          data: claims ? { claims } : null,
          error: claims ? null : new Error("invalid jwt"),
        }),
    },
  }) as never;

Deno.test("admin step-up registration accepts fresh verified handoff claims", async () => {
  const client = authClient({
    iat: Math.floor(Date.now() / 1000),
    session_id: "session-1",
    amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }],
  });

  assert(
    await canRegisterAdminStepUpFromTrustedHandoff(client, "verified-token"),
    "expected trusted handoff token",
  );
});

Deno.test("admin step-up registration rejects fresh password-only claims", async () => {
  const client = authClient({
    iat: Math.floor(Date.now() / 1000),
    session_id: "session-1",
    amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
  });

  assert(
    !await canRegisterAdminStepUpFromTrustedHandoff(client, "verified-token"),
    "expected password-only token rejection",
  );
});

Deno.test("admin step-up registration rejects unverified tokens", async () => {
  try {
    await canRegisterAdminStepUpFromTrustedHandoff(
      authClient(null),
      "forged-token",
    );
  } catch {
    return;
  }
  throw new Error("expected unverified token rejection");
});

Deno.test("canRegisterAdminStepUp accepts a freshly issued token", async () => {
  const client = authClient({ iat: Math.floor(Date.now() / 1000) });
  assert(
    await canRegisterAdminStepUp(client, "token"),
    "expected a fresh token to be within the registration window",
  );
});

Deno.test("canRegisterAdminStepUp rejects a stale token", async () => {
  const client = authClient({
    iat: Math.floor((Date.now() - 10 * 60 * 1000) / 1000),
  });
  assert(
    !await canRegisterAdminStepUp(client, "token"),
    "expected a stale token to be rejected",
  );
});

Deno.test("canRegisterAdminStepUp tolerates small future clock skew", async () => {
  const client = authClient({
    iat: Math.floor((Date.now() + 20 * 1000) / 1000),
  });
  assert(
    await canRegisterAdminStepUp(client, "token"),
    "expected small future skew to be tolerated",
  );
});

Deno.test("canRegisterAdminStepUp rejects tokens issued too far in the future", async () => {
  const client = authClient({
    iat: Math.floor((Date.now() + 5 * 60 * 1000) / 1000),
  });
  assert(
    !await canRegisterAdminStepUp(client, "token"),
    "expected large future skew to be rejected",
  );
});

Deno.test("canRegisterAdminStepUp rejects claims with a missing or invalid iat", async () => {
  const missingIat = authClient({});
  assert(
    !await canRegisterAdminStepUp(missingIat, "token"),
    "expected missing iat to be rejected",
  );

  const nonNumericIat = authClient({ iat: "not-a-number" });
  assert(
    !await canRegisterAdminStepUp(nonNumericIat, "token"),
    "expected non-numeric iat to be rejected",
  );
});

Deno.test("isMissingPrivilegedStepUpTable detects the missing-relation error", () => {
  assert(
    isMissingPrivilegedStepUpTable({
      code: "42P01",
      message: 'relation "privileged_session_stepups" does not exist',
    }),
    "expected missing-relation error to match",
  );
});

Deno.test("isMissingPrivilegedStepUpTable ignores unrelated errors", () => {
  assert(
    !isMissingPrivilegedStepUpTable({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    }),
    "expected unrelated error codes to not match",
  );
  assert(
    !isMissingPrivilegedStepUpTable(null),
    "expected a null error to not match",
  );
});

type UpsertResponse = { error: unknown };
type SelectResponse = { data: unknown; error: unknown };

const adminClient = (options: {
  claims: Record<string, unknown> | null;
  upsertResponse?: UpsertResponse;
  selectResponse?: SelectResponse;
}) => {
  const upsertCalls: Array<{ payload: Record<string, unknown>; opts: unknown }> = [];
  const client = {
    auth: {
      getClaims: () =>
        Promise.resolve({
          data: options.claims ? { claims: options.claims } : null,
          error: options.claims ? null : new Error("invalid jwt"),
        }),
    },
    from: () => ({
      upsert: (payload: Record<string, unknown>, opts: unknown) => {
        upsertCalls.push({ payload, opts });
        return Promise.resolve(options.upsertResponse ?? { error: null });
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              gt: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve(
                      options.selectResponse ?? { data: null, error: null },
                    ),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as never;
  return { client, upsertCalls };
};

Deno.test("registerPrivilegedStepUp binds to the session id when present", async () => {
  const { client, upsertCalls } = adminClient({
    claims: { session_id: "session-42" },
  });

  const result = await registerPrivilegedStepUp(client, {
    userId: "user-1",
    roleScope: "super_admin",
    authToken: "verified-token",
    source: "test",
  });

  assert(
    new Date(result.expiresAt).getTime() > Date.now(),
    "expected expiresAt to be in the future",
  );
  assert(upsertCalls.length === 1, "expected a single upsert call");
  assert(
    upsertCalls[0].payload.binding_key === "session:session-42",
    "expected binding key to use the session id",
  );
  assert(
    upsertCalls[0].payload.user_id === "user-1" &&
      upsertCalls[0].payload.role_scope === "super_admin",
    "expected upsert payload to carry the caller-provided identity",
  );
});

Deno.test("registerPrivilegedStepUp falls back to a hashed token binding key", async () => {
  const { client, upsertCalls } = adminClient({ claims: {} });

  await registerPrivilegedStepUp(client, {
    userId: "user-1",
    roleScope: "workspace_admin",
    authToken: "verified-token",
    source: "test",
  });

  const bindingKey = upsertCalls[0].payload.binding_key as string;
  assert(
    bindingKey.startsWith("token:") && bindingKey.length > "token:".length,
    "expected a hashed token binding key fallback",
  );
});

Deno.test("registerPrivilegedStepUp throws when the upsert fails", async () => {
  const { client } = adminClient({
    claims: { session_id: "session-1" },
    upsertResponse: { error: new Error("insert failed") },
  });

  try {
    await registerPrivilegedStepUp(client, {
      userId: "user-1",
      roleScope: "super_admin",
      authToken: "verified-token",
      source: "test",
    });
  } catch (error) {
    assert(
      error instanceof Error && error.message === "insert failed",
      "expected the underlying upsert error to propagate",
    );
    return;
  }
  throw new Error("expected upsert failure to throw");
});

Deno.test("hasPrivilegedStepUp returns true when an active row exists", async () => {
  const { client } = adminClient({
    claims: { session_id: "session-1" },
    selectResponse: { data: { id: "row-1" }, error: null },
  });

  assert(
    await hasPrivilegedStepUp(client, {
      userId: "user-1",
      roleScope: "super_admin",
      authToken: "verified-token",
    }),
    "expected an active step-up row to be recognized",
  );
});

Deno.test("hasPrivilegedStepUp returns false when no row is found", async () => {
  const { client } = adminClient({
    claims: { session_id: "session-1" },
    selectResponse: { data: null, error: null },
  });

  assert(
    !await hasPrivilegedStepUp(client, {
      userId: "user-1",
      roleScope: "super_admin",
      authToken: "verified-token",
    }),
    "expected no active row to resolve to false",
  );
});

Deno.test("hasPrivilegedStepUp throws when the lookup errors", async () => {
  const { client } = adminClient({
    claims: { session_id: "session-1" },
    selectResponse: { data: null, error: new Error("lookup failed") },
  });

  try {
    await hasPrivilegedStepUp(client, {
      userId: "user-1",
      roleScope: "super_admin",
      authToken: "verified-token",
    });
  } catch (error) {
    assert(
      error instanceof Error && error.message === "lookup failed",
      "expected the underlying lookup error to propagate",
    );
    return;
  }
  throw new Error("expected lookup failure to throw");
});
