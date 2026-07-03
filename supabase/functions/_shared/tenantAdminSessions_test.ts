import {
  isTenantAdminTokenBlockedBySessionRevocation,
  validateTenantAdminDeviceSession,
} from "./tenantAdminSessions.ts";

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
      getClaims: () => Promise.resolve({
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

Deno.test("tenant admin device session rejects active row bound to another auth session", async () => {
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

  const result = await validateTenantAdminDeviceSession(client, {
    tenantId: "tenant-1",
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

Deno.test("tenant admin device session accepts active row bound to presented auth session", async () => {
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

  const result = await validateTenantAdminDeviceSession(client, {
    tenantId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(result.valid, "expected matching auth session to be accepted");
});

Deno.test("tenant admin device session accepts no-session-id tokens only when token hash matches", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("verified-token"),
  );
  const tokenHash = `token:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

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

  const result = await validateTenantAdminDeviceSession(client, {
    tenantId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "verified-token",
  });

  assert(result.valid, "expected matching token hash fallback to be accepted");
});

Deno.test("tenant admin device session rejects no-session-id tokens when issued-at does not match", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("verified-token"),
  );
  const tokenHash = `token:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

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

  const result = await validateTenantAdminDeviceSession(client, {
    tenantId: "tenant-1",
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

Deno.test("tenant admin device session rejects no-session-id tokens when token hash is missing", async () => {
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

  const result = await validateTenantAdminDeviceSession(client, {
    tenantId: "tenant-1",
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

Deno.test("tenant admin device session rejects unverified tokens", async () => {
  const client = new MockClient([], null);
  const result = await validateTenantAdminDeviceSession(client, {
    tenantId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken: "forged-token",
  });

  assert(!result.valid, "expected unverified token rejection");
  assert(result.reason === "revoked_token", "expected revoked_token reason");
});

Deno.test("tenant admin revocation check fails closed when session table is missing", async () => {
  const claims = {
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  };
  const client = new MockClient([
    {
      data: null,
      error: {
        code: "42P01",
        message: 'relation "tenant_admin_sessions" does not exist',
      },
    },
  ], claims);

  const result = await isTenantAdminTokenBlockedBySessionRevocation(client, {
    tenantId: "tenant-1",
    profileId: "profile-1",
    authToken: "verified-token",
  });

  assert(result.blocked, "expected missing session schema to block access");
  assert(result.relationMissing, "expected relationMissing marker");
});
