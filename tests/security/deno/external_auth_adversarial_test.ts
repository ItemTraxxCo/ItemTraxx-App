import { exportJWK, generateKeyPair, SignJWT } from "npm:jose@6.1.3";
import {
  getExternalAuthUser,
  verifyExternalAuthClaims,
} from "../../../supabase/functions/_shared/externalAuth.ts";

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

const encodeBase64Url = (value: string) =>
  btoa(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const previousEnv = (name: string) => Deno.env.get(name);
const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
};

Deno.test("Better Auth rejects forged claim edits and resolves identity through a profile lookup", async () => {
  const oldJwksUrl = previousEnv("BETTER_AUTH_JWKS_URL");
  const oldIssuer = previousEnv("BETTER_AUTH_JWT_ISSUER");
  const oldAudience = previousEnv("BETTER_AUTH_JWT_AUDIENCE");
  const issuer = "https://better-auth.security-test.invalid";
  const audience = "itemtraxx-edge-security-test";
  const subjectA = "11000000-0000-4000-8000-000000000002";
  const subjectB = "11000000-0000-4000-8000-000000000003";
  const kid = "itx-security-jwks-test";
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const originalFetch = globalThis.fetch;
  const publicJwk = {
    ...await exportJWK(publicKey),
    kid,
    alg: "ES256",
    use: "sig",
  };
  const jwksUrl = "https://better-auth.security-test.invalid/jwks.json";
  globalThis.fetch = ((input: string | URL | Request) => {
    const requestedUrl = input instanceof Request ? input.url : String(input);
    if (requestedUrl !== jwksUrl) {
      return Promise.reject(
        new Error(`Unexpected external-auth test fetch: ${requestedUrl}`),
      );
    }
    return Promise.resolve(
      Response.json({ keys: [publicJwk] }, {
        headers: { "cache-control": "public, max-age=60" },
      }),
    );
  }) as typeof fetch;

  Deno.env.set("BETTER_AUTH_JWKS_URL", jwksUrl);
  Deno.env.set("BETTER_AUTH_JWT_ISSUER", issuer);
  Deno.env.set("BETTER_AUTH_JWT_AUDIENCE", audience);

  const signedToken = async (input: {
    subject?: string;
    tokenIssuer?: string;
    tokenAudience?: string;
    expires?: string;
  } = {}) =>
    await new SignJWT({
      role: "super_admin",
      org_id: "itx-security-org-b",
      workspace_id: "10000000-0000-4000-8000-000000000002",
      app_metadata: { role: "super_admin" },
      session_id: "itx-security-session-forged-claims",
    })
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuer(input.tokenIssuer ?? issuer)
      .setAudience(input.tokenAudience ?? audience)
      .setSubject(input.subject ?? subjectA)
      .setIssuedAt()
      .setExpirationTime(input.expires ?? "2m")
      .sign(privateKey);

  try {
    const validToken = await signedToken();
    const verified = await verifyExternalAuthClaims(`Bearer ${validToken}`);
    assert(
      verified?.sub === subjectA,
      "valid issuer/audience/signature should resolve the subject",
    );
    assert(
      verified?.role === "super_admin",
      "test token should carry the forged role claim",
    );
    assert(
      verified?.org_id === "itx-security-org-b",
      "test token should carry the foreign org claim",
    );

    let lookedUpProfileId = "";
    const matchingProfileClient = {
      from: (table: string) => {
        assert(
          table === "profiles",
          "external subject must be resolved through public.profiles",
        );
        return {
          select: (columns: string) => {
            assert(
              columns === "id,auth_email",
              "profile lookup must not trust role or workspace claims",
            );
            return {
              eq: (column: string, value: string) => {
                assert(
                  column === "id",
                  "profile lookup must bind to the verified subject",
                );
                lookedUpProfileId = value;
                return {
                  maybeSingle: async () => ({
                    data: { id: subjectA, auth_email: "member-a@example.test" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    };
    const resolved = await getExternalAuthUser(
      matchingProfileClient,
      `Bearer ${validToken}`,
    );
    assert(
      lookedUpProfileId === subjectA,
      "lookup must use only the cryptographically verified sub",
    );
    assert(
      resolved.error === null,
      "a matching active profile lookup should succeed",
    );
    assert(
      resolved.data.user?.id === subjectA,
      "role/org claims must not replace the resolved profile ID",
    );
    assert(
      Object.keys(resolved.data.user ?? {}).sort().join(",") === "email,id",
      "external identity result must contain no caller-controlled role or workspace authorization fields",
    );

    const [header, encodedPayload, signature] = validToken.split(".");
    const forgedPayload = JSON.parse(
      atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as Record<string, unknown>;
    forgedPayload.sub = subjectB;
    forgedPayload.role = "service_role";
    forgedPayload.org_id = "itx-security-org-b";
    const tamperedToken = `${header}.${
      encodeBase64Url(JSON.stringify(forgedPayload))
    }.${signature}`;
    assert(
      await verifyExternalAuthClaims(`Bearer ${tamperedToken}`) === null,
      "changing sub/role/org claims without the Better Auth signing key must fail signature verification",
    );

    assert(
      await verifyExternalAuthClaims(
        `Bearer ${await signedToken({
          tokenIssuer: "https://attacker.invalid",
        })}`,
      ) === null,
      "wrong issuer must be rejected",
    );
    assert(
      await verifyExternalAuthClaims(
        `Bearer ${await signedToken({ tokenAudience: "attacker-client" })}`,
      ) === null,
      "wrong audience must be rejected",
    );
    assert(
      await verifyExternalAuthClaims(
        `Bearer ${await signedToken({ expires: "-1s" })}`,
      ) === null,
      "expired Better Auth token must be rejected",
    );

    const noMatchingProfileClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
    const unknownSubject = await getExternalAuthUser(
      noMatchingProfileClient,
      `Bearer ${await signedToken({ subject: subjectB })}`,
    );
    assert(
      unknownSubject.data.user === null,
      "valid signature alone must not create an application identity",
    );
    assert(
      unknownSubject.error instanceof Error,
      "missing profile must return an identity resolution error",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("BETTER_AUTH_JWKS_URL", oldJwksUrl);
    restoreEnv("BETTER_AUTH_JWT_ISSUER", oldIssuer);
    restoreEnv("BETTER_AUTH_JWT_AUDIENCE", oldAudience);
  }
});
