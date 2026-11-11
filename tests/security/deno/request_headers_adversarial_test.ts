// Adversarial Worker header-forgery tests. Deliberately outside the CI test
// globs; run via `npm run test:security:adversarial`.
import {
  sanitizeRequestHeaders,
  sanitizeUpstreamHeaders,
} from "../../../cloudflare/edge-proxy/src/requestHeaders.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("forged authorization and tenant headers cannot replace resolved session identity", () => {
  const request = new Request(
    "https://edge.itemtraxx.com/functions/super-ops",
    {
      headers: {
        authorization: "Bearer forged-tenant-b-token",
        "x-itx-user-jwt": "Bearer forged-super-admin-token",
        "x-itx-workspace-id": "10000000-0000-4000-8000-000000000002",
        "x-itx-tenant-id": "10000000-0000-4000-8000-000000000002",
        "x-itx-user-id": "11000000-0000-4000-8000-000000000003",
        "x-supabase-role": "service_role",
        "x-auth-uid": "11000000-0000-4000-8000-000000000003",
      },
    },
  );

  const headers = sanitizeRequestHeaders(
    request,
    "anon-test-key",
    "worker-generated-request-id",
    "super-ops",
    "tenant-a-cookie-session",
  );
  assertEquals(
    headers.get("authorization"),
    "Bearer tenant-a-cookie-session",
    "verified cookie session overrides forged bearer",
  );
  assertEquals(
    headers.get("x-itx-user-jwt"),
    "Bearer tenant-a-cookie-session",
    "super-ops identity header is derived from the resolved session",
  );
  assertEquals(
    headers.get("x-request-id"),
    "worker-generated-request-id",
    "request ID is Worker-owned",
  );
  for (
    const name of [
      "x-itx-workspace-id",
      "x-itx-tenant-id",
      "x-itx-user-id",
      "x-supabase-role",
      "x-auth-uid",
    ]
  ) {
    assertEquals(
      headers.get(name),
      null,
      `${name} must not reach the Edge Function`,
    );
  }

  const dataHeaders = sanitizeUpstreamHeaders(
    request,
    "anon-test-key",
    "worker-generated-request-id",
    "tenant-a-cookie-session",
  );
  assertEquals(
    dataHeaders.get("authorization"),
    "Bearer tenant-a-cookie-session",
    "Data API uses only the resolved session token",
  );
  assertEquals(
    dataHeaders.get("x-itx-user-jwt"),
    null,
    "super-ops-only identity header is not sent to PostgREST",
  );
  for (
    const name of [
      "x-itx-workspace-id",
      "x-itx-tenant-id",
      "x-itx-user-id",
      "x-supabase-role",
      "x-auth-uid",
    ]
  ) {
    assertEquals(
      dataHeaders.get(name),
      null,
      `${name} must not reach PostgREST`,
    );
  }
});
