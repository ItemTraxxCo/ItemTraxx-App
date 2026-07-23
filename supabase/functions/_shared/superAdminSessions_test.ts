import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { isSuperAdminTokenBlockedBySessionRevocation } from "./superAdminSessions.ts";

type QueryResponse = { data: Record<string, unknown> | null; error: unknown | null };

class QueryBuilder {
  constructor(private readonly response: QueryResponse) {}
  select() { return this; }
  eq() { return this; }
  not() { return this; }
  gte() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve(this.response); }
}

class MockClient {
  auth: { getClaims: () => Promise<{ data: { claims: Record<string, unknown> } | null; error: Error | null }> };
  constructor(private readonly responses: QueryResponse[], claims: Record<string, unknown> | null) {
    this.auth = { getClaims: () => Promise.resolve({ data: claims ? { claims } : null, error: claims ? null : new Error("invalid jwt") }) };
  }
  from() {
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected query");
    return new QueryBuilder(response);
  }
}

Deno.test("super-admin revocation blocks the matching auth session", async () => {
  const client = new MockClient([{ data: { id: "revoked-row" }, error: null }], {
    iat: Math.floor(Date.now() / 1000), session_id: "revoked-auth-session",
  });
  const result = await isSuperAdminTokenBlockedBySessionRevocation(client, {
    profileId: "profile-1", authToken: "verified-token",
  });
  assertEquals(result, { blocked: true, relationMissing: false });
});

Deno.test("super-admin revocation permits an unrelated active auth session", async () => {
  const client = new MockClient([
    { data: null, error: null },
    { data: null, error: null },
  ], { iat: Math.floor(Date.now() / 1000), session_id: "active-auth-session" });
  const result = await isSuperAdminTokenBlockedBySessionRevocation(client, {
    profileId: "profile-1", authToken: "verified-token",
  });
  assertEquals(result, { blocked: false, relationMissing: false });
});

Deno.test("super-admin revocation fails closed when the session schema is absent", async () => {
  const client = new MockClient([{
    data: null,
    error: { code: "42P01", message: 'relation "super_admin_sessions" does not exist' },
  }], { iat: Math.floor(Date.now() / 1000), session_id: "active-auth-session" });
  const result = await isSuperAdminTokenBlockedBySessionRevocation(client, {
    profileId: "profile-1", authToken: "verified-token",
  });
  assertEquals(result, { blocked: true, relationMissing: true });
});
