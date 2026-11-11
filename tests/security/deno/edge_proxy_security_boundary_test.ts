import worker from "../../../cloudflare/edge-proxy/src/index.ts";
import { getBetterAuth } from "../../../cloudflare/edge-proxy/src/auth.ts";

const executionContext = { waitUntil: (_promise: Promise<unknown>) => {} };

const assertJsonError = async (
  response: Response,
  status: number,
  error: string,
) => {
  if (response.status !== status) {
    throw new Error(`Expected HTTP ${status}, received ${response.status}`);
  }
  const payload = await response.json();
  if (JSON.stringify(payload) !== JSON.stringify({ error })) {
    throw new Error(
      `Expected { error: ${JSON.stringify(error)} }, received ${
        JSON.stringify(payload)
      }`,
    );
  }
};

Deno.test("Security: unauthenticated privileged RPC requests return HTTP 401", async () => {
  const response = await worker.fetch(
    new Request("https://edge.itemtraxx.com/rest/v1/rpc/consume_rate_limit", {
      headers: { origin: "https://itemtraxx.com" },
    }),
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-test-key",
    },
    executionContext,
  );

  await assertJsonError(response, 401, "Unauthorized");
});

// A fully configured Better Auth instance, so a 401 below comes from session
// resolution rejecting the credential rather than from missing configuration
// (getBetterAuth throws without these values and the proxy maps that to 401).
const configuredBetterAuthEnv = async () => {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = {
    ...await crypto.subtle.exportKey("jwk", privateKey),
    kid: "itx-security-boundary-test",
    alg: "ES256",
  };
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-test-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
    BETTER_AUTH_URL: "https://edge.itemtraxx.com",
    BETTER_AUTH_SECRET: "security-boundary-test-secret-0123456789abcdef",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://itemtraxx.com",
    BETTER_AUTH_JWT_ISSUER: "https://edge.itemtraxx.com",
    BETTER_AUTH_JWT_AUDIENCE: "authenticated",
    BETTER_AUTH_JWT_PRIVATE_JWK: JSON.stringify(privateJwk),
    BETTER_AUTH_PASSKEY_RP_ID: "itemtraxx.com",
    BETTER_AUTH_PASSKEY_ORIGIN: "https://itemtraxx.com",
  };
};

Deno.test("Security: forged bearer tokens and session cookies cannot reach protected Data API routes", async () => {
  const env = await configuredBetterAuthEnv();
  // Positive control: configuration is complete, so the auth layer is live.
  getBetterAuth(env as Parameters<typeof getBetterAuth>[0]);

  const forgedToken = "forged-service-role-token";
  const originalFetch = globalThis.fetch;
  const outbound: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    outbound.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
    });
    // Any session/user lookup the auth layer performs finds nothing.
    return Promise.resolve(
      Response.json([], { headers: { "content-type": "application/json" } }),
    );
  }) as typeof fetch;

  const send = (headers: Record<string, string>) =>
    worker.fetch(
      new Request("https://edge.itemtraxx.com/rest/v1/profiles?select=id", {
        headers: { origin: "https://itemtraxx.com", ...headers },
      }),
      env,
      executionContext,
    );

  try {
    // Baseline: an anonymous caller is rejected.
    await assertJsonError(await send({}), 401, "Unauthorized");
    // A forged bearer must be indistinguishable from no credential at all.
    await assertJsonError(
      await send({ authorization: `Bearer ${forgedToken}` }),
      401,
      "Unauthorized",
    );
    // A forged (unsigned/mis-signed) Better Auth session cookie is rejected.
    for (
      const cookieName of [
        "__Secure-better-auth.session_token",
        "better-auth.session_token",
      ]
    ) {
      await assertJsonError(
        await send({ cookie: `${cookieName}=${forgedToken}.forged-signature` }),
        401,
        "Unauthorized",
      );
    }

    const protectedUpstream = outbound.filter(({ url }) =>
      new URL(url).pathname === "/rest/v1/profiles"
    );
    if (protectedUpstream.length !== 0) {
      throw new Error(
        `Forged credential reached the protected upstream: ${
          protectedUpstream.map(({ url }) => url).join(", ")
        }`,
      );
    }
    const forwardedForgery = outbound.filter(({ authorization }) =>
      authorization?.includes(forgedToken)
    );
    if (forwardedForgery.length !== 0) {
      throw new Error(
        `Forged credential was forwarded upstream: ${
          forwardedForgery.map(({ url }) => url).join(", ")
        }`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Security: removed legacy session endpoints return indistinguishable HTTP 404 errors", async () => {
  for (const action of ["exchange", "refresh", "me", "logout"]) {
    const response = await worker.fetch(
      new Request(`https://edge.itemtraxx.com/auth/session/${action}`, {
        method: action === "me" ? "GET" : "POST",
        headers: { origin: "https://itemtraxx.com" },
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-test-key",
      },
      executionContext,
    );

    await assertJsonError(response, 404, "Not found");
  }
});
