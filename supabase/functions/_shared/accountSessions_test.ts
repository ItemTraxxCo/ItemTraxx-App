import {
  isAccountTokenBlockedBySessionRevocation,
  resolveAccountAuthSessionBinding,
  validateAccountDeviceSession,
} from "./accountSessions.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

type QueryResponse = {
  data: Record<string, unknown> | null;
  error: unknown | null;
};

class QueryBuilder {
  constructor(private readonly response: QueryResponse) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  not() {
    return this;
  }
  gte() {
    return this;
  }
  is() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve(this.response);
  }
}

class MockClient {
  auth: {
    getClaims: () => Promise<{
      data: { claims: Record<string, unknown> } | null;
      error: Error | null;
    }>;
  };

  constructor(
    private readonly responses: QueryResponse[],
    claims: Record<string, unknown> | null,
  ) {
    this.auth = {
      getClaims: () =>
        Promise.resolve({
          data: claims ? { claims } : null,
          error: claims ? null : new Error("invalid jwt"),
        }),
    };
  }
  from() {
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected query");
    return new QueryBuilder(response);
  }
}

Deno.test("workspace admin device session rejects active row bound to another auth session", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    { data: null, error: null },
    { data: null, error: null },
    {
      data: { id: "active-row", auth_session_id: "other-session" },
      error: null,
    },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(!result.valid, "expected mismatched auth session to be rejected");
  assert(
    result.reason === "missing_session",
    "expected missing_session reason",
  );
});

Deno.test("workspace admin device session accepts active row bound to presented auth session", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    { data: null, error: null },
    { data: null, error: null },
    {
      data: { id: "active-row", auth_session_id: "current-session" },
      error: null,
    },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(result.valid, "expected matching auth session to be accepted");
});

Deno.test("workspace admin device session accepts no-session-id tokens only when token hash matches", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("verified-token"),
  );
  const tokenHash = `token:${
    Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;

  const client = new MockClient([
    { data: null, error: null },
    {
      data: {
        id: "active-row",
        auth_session_id: null,
        auth_token_hash: tokenHash,
        auth_token_issued_at: new Date(claims.iat * 1000).toISOString(),
      },
      error: null,
    },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(result.valid, "expected matching token hash fallback to be accepted");
});

Deno.test("workspace admin device session rejects no-session-id tokens when issued-at does not match", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("verified-token"),
  );
  const tokenHash = `token:${
    Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;

  const client = new MockClient([
    { data: null, error: null },
    {
      data: {
        id: "active-row",
        auth_session_id: null,
        auth_token_hash: tokenHash,
        auth_token_issued_at: new Date((claims.iat - 60) * 1000).toISOString(),
      },
      error: null,
    },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(!result.valid, "expected stale token hash fallback to be rejected");
  assert(
    result.reason === "missing_session",
    "expected missing_session reason",
  );
});

Deno.test("workspace admin device session rejects no-session-id tokens when token hash is missing", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
  };
  const client = new MockClient([
    { data: null, error: null },
    {
      data: {
        id: "active-row",
        auth_session_id: null,
        auth_token_hash: null,
      },
      error: null,
    },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(!result.valid, "expected missing token hash fallback to be rejected");
  assert(
    result.reason === "missing_session",
    "expected missing_session reason",
  );
});

Deno.test("workspace admin device session rejects unverified tokens", async () => {
  const client = new MockClient([], null);
  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "forged-token",
  });

  assert(!result.valid, "expected unverified token rejection");
  assert(result.reason === "revoked_token", "expected revoked_token reason");
});

Deno.test("workspace admin revocation check fails closed when session table is missing", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    {
      data: null,
      error: {
        code: "42P01",
        message: 'relation "account_sessions" does not exist',
      },
    },
  ], claims);

  const result = await isAccountTokenBlockedBySessionRevocation(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    authToken: "verified-token",
  });

  assert(result.blocked, "expected missing session schema to block access");
  assert(result.relationMissing, "expected relationMissing marker");
});

Deno.test("resolveAccountAuthSessionBinding returns nulls when claims cannot be verified", async () => {
  const client = new MockClient([], null);
  const binding = await resolveAccountAuthSessionBinding(client, "forged-token");
  assert(binding.sessionId === null, "expected null sessionId for unverified token");
  assert(binding.issuedAt === null, "expected null issuedAt for unverified token");
});

Deno.test("resolveAccountAuthSessionBinding returns nulls when claims omit session_id and iat", async () => {
  const client = new MockClient([], { sub: "user-1" });
  const binding = await resolveAccountAuthSessionBinding(client, "verified-token");
  assert(binding.sessionId === null, "expected null sessionId when absent from claims");
  assert(binding.issuedAt === null, "expected null issuedAt when absent from claims");
});

Deno.test("resolveAccountAuthSessionBinding normalizes a valid session and issuedAt", async () => {
  const iat = Math.floor(Date.now() / 1000);
  const client = new MockClient([], {
    iat,
    session_id: "  session-77  ",
  });
  const binding = await resolveAccountAuthSessionBinding(client, "verified-token");
  assert(binding.sessionId === "session-77", "expected trimmed session id");
  assert(
    binding.issuedAt === new Date(iat * 1000).toISOString(),
    "expected issuedAt to be converted to an ISO string",
  );
});

Deno.test("isAccountTokenBlockedBySessionRevocation blocks fully unverified tokens without a query", async () => {
  const client = new MockClient([], null);
  const result = await isAccountTokenBlockedBySessionRevocation(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    authToken: "forged-token",
  });
  assert(result.blocked, "expected unverified tokens to block access");
  assert(!result.relationMissing, "expected no relationMissing marker");
});

Deno.test("isAccountTokenBlockedBySessionRevocation blocks immediately when the session-id row is revoked", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    { data: { id: "revoked-row" }, error: null },
  ], claims);

  const result = await isAccountTokenBlockedBySessionRevocation(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    authToken: "verified-token",
  });

  assert(result.blocked, "expected a revoked session-id row to block access");
  assert(!result.relationMissing, "expected no relationMissing marker");
});

Deno.test("isAccountTokenBlockedBySessionRevocation surfaces missing auth_session_id column as relationMissing", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    {
      data: null,
      error: {
        code: "42703",
        message: 'column "auth_session_id" does not exist',
      },
    },
  ], claims);

  const result = await isAccountTokenBlockedBySessionRevocation(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    authToken: "verified-token",
  });

  assert(result.blocked, "expected missing column to block access");
  assert(result.relationMissing, "expected relationMissing marker");
});

Deno.test("isAccountTokenBlockedBySessionRevocation throws on unrelated session-id query errors", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    { data: null, error: { code: "08006", message: "connection failure" } },
  ], claims);

  try {
    await isAccountTokenBlockedBySessionRevocation(client, {
      workspaceId: "tenant-1",
      profileId: "profile-1",
      authToken: "verified-token",
    });
  } catch (error) {
    assert(
      error instanceof Error &&
        error.message === "Unable to validate admin session revocation.",
      "expected the generic revocation failure message",
    );
    return;
  }
  throw new Error("expected unrelated session-id query error to throw");
});

Deno.test("isAccountTokenBlockedBySessionRevocation falls through to unblocked when no issuedAt is available", async () => {
  const claims = { session_id: "current-session" };
  const client = new MockClient([
    { data: null, error: null },
  ], claims);

  const result = await isAccountTokenBlockedBySessionRevocation(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    authToken: "verified-token",
  });

  assert(!result.blocked, "expected no issuedAt fallback to remain unblocked");
  assert(!result.relationMissing, "expected no relationMissing marker");
});

Deno.test("isAccountTokenBlockedBySessionRevocation blocks via the issuedAt-only revocation check", async () => {
  const claims = { iat: Math.floor(Date.now() / 1000) };
  const client = new MockClient([
    { data: { id: "revoked-row" }, error: null },
  ], claims);

  const result = await isAccountTokenBlockedBySessionRevocation(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    authToken: "verified-token",
  });

  assert(result.blocked, "expected a revoked issuedAt-bound row to block access");
  assert(!result.relationMissing, "expected no relationMissing marker");
});

Deno.test("isAccountTokenBlockedBySessionRevocation is not blocked when the issuedAt-only check finds nothing", async () => {
  const claims = { iat: Math.floor(Date.now() / 1000) };
  const client = new MockClient([
    { data: null, error: null },
  ], claims);

  const result = await isAccountTokenBlockedBySessionRevocation(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    authToken: "verified-token",
  });

  assert(!result.blocked, "expected no revoked row to remain unblocked");
});

Deno.test("isAccountTokenBlockedBySessionRevocation surfaces missing relation on the issuedAt-only path", async () => {
  const claims = { iat: Math.floor(Date.now() / 1000) };
  const client = new MockClient([
    {
      data: null,
      error: {
        code: "42P01",
        message: 'relation "account_sessions" does not exist',
      },
    },
  ], claims);

  const result = await isAccountTokenBlockedBySessionRevocation(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    authToken: "verified-token",
  });

  assert(result.blocked, "expected missing relation to block access");
  assert(result.relationMissing, "expected relationMissing marker");
});

Deno.test("isAccountTokenBlockedBySessionRevocation throws on unrelated issuedAt-only query errors", async () => {
  const claims = { iat: Math.floor(Date.now() / 1000) };
  const client = new MockClient([
    { data: null, error: { code: "08006", message: "connection failure" } },
  ], claims);

  try {
    await isAccountTokenBlockedBySessionRevocation(client, {
      workspaceId: "tenant-1",
      profileId: "profile-1",
      authToken: "verified-token",
    });
  } catch (error) {
    assert(
      error instanceof Error &&
        error.message === "Unable to validate admin session revocation.",
      "expected the generic revocation failure message",
    );
    return;
  }
  throw new Error("expected unrelated issuedAt-only query error to throw");
});

Deno.test("validateAccountDeviceSession rejects requests without a device id", async () => {
  const client = new MockClient([], { iat: Math.floor(Date.now() / 1000) });
  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: null,
    authToken: "verified-token",
  });
  assert(!result.valid, "expected missing device id to be rejected");
  assert(result.reason === "missing_device", "expected missing_device reason");
});

Deno.test("validateAccountDeviceSession reports missing_table when the revocation check finds no schema", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    {
      data: null,
      error: {
        code: "42P01",
        message: 'relation "account_sessions" does not exist',
      },
    },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(!result.valid, "expected missing schema to be rejected");
  assert(result.reason === "missing_table", "expected missing_table reason");
  assert(result.relationMissing, "expected relationMissing marker");
});

Deno.test("validateAccountDeviceSession reports revoked_token when the session-id row is revoked", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    { data: { id: "revoked-row" }, error: null },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(!result.valid, "expected a revoked binding to be rejected");
  assert(result.reason === "revoked_token", "expected revoked_token reason");
  assert(!result.relationMissing, "expected no relationMissing marker");
});

Deno.test("validateAccountDeviceSession reports missing_table when the active-session lookup finds no schema", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    { data: null, error: null },
    { data: null, error: null },
    {
      data: null,
      error: {
        code: "42P01",
        message: 'relation "account_sessions" does not exist',
      },
    },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(!result.valid, "expected missing schema to be rejected");
  assert(result.reason === "missing_table", "expected missing_table reason");
  assert(result.relationMissing, "expected relationMissing marker");
});

Deno.test("validateAccountDeviceSession throws when the active-session lookup errors unexpectedly", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: { code: "08006", message: "connection failure" } },
  ], claims);

  try {
    await validateAccountDeviceSession(client, {
      workspaceId: "tenant-1",
      profileId: "profile-1",
      deviceId: "device-1",
      authToken: "verified-token",
    });
  } catch (error) {
    assert(
      error instanceof Error &&
        error.message === "Unable to validate admin session.",
      "expected the generic session validation failure message",
    );
    return;
  }
  throw new Error("expected unrelated active-session query error to throw");
});

Deno.test("validateAccountDeviceSession reports missing_session when no active row exists", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: null },
  ], claims);

  const result = await validateAccountDeviceSession(client, {
    workspaceId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(!result.valid, "expected no active row to be rejected");
  assert(result.reason === "missing_session", "expected missing_session reason");
});
