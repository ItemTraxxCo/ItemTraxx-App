import { validateTenantAdminDeviceSession } from "./tenantAdminSessions.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const base64Url = (value: Record<string, unknown>) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );

const unsignedJwt = (payload: Record<string, unknown>) =>
  `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url(payload)}.signature`;

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
  constructor(private readonly responses: QueryResponse[]) {}
  from() {
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected query");
    return new QueryBuilder(response);
  }
}

Deno.test("tenant admin device session rejects active row bound to another auth session", async () => {
  const authToken = unsignedJwt({
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  });
  const client = new MockClient([
    { data: null, error: null },
    { data: null, error: null },
    {
      data: { id: "active-row", auth_session_id: "other-session" },
      error: null,
    },
  ]);

  const result = await validateTenantAdminDeviceSession(client, {
    tenantId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken,
  });

  assert(!result.valid, "expected mismatched auth session to be rejected");
  assert(
    result.reason === "missing_session",
    "expected missing_session reason",
  );
});

Deno.test("tenant admin device session accepts active row bound to presented auth session", async () => {
  const authToken = unsignedJwt({
    iat: Math.floor(Date.now() / 1000),
    session_id: "current-session",
  });
  const client = new MockClient([
    { data: null, error: null },
    { data: null, error: null },
    {
      data: { id: "active-row", auth_session_id: "current-session" },
      error: null,
    },
  ]);

  const result = await validateTenantAdminDeviceSession(client, {
    tenantId: "tenant-1",
    profileId: "profile-1",
    deviceId: "device-1",
    authToken,
  });

  assert(result.valid, "expected matching auth session to be accepted");
});
