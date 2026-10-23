import {
  createSsoLoginProof,
  isSessionCreatedDuringSsoCallback,
  verifySsoLoginProof,
} from "./ssoLoginProvenance.ts";

const assertEquals = (actual: unknown, expected: unknown, message?: string) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ?? `Expected ${expectedJson} but got ${actualJson}`,
    );
  }
};

const SECRET = "test-only-sso-provenance-secret";
const IDENTITY = {
  betterAuthUserId: "better-auth-user-1",
  sessionId: "better-auth-session-1",
};
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

Deno.test("new auth sessions must be created during the SSO callback request", () => {
  assertEquals(
    isSessionCreatedDuringSsoCallback(NOW, NOW, NOW + 100, null, "new-session"),
    true,
  );
  assertEquals(
    isSessionCreatedDuringSsoCallback(
      NOW - 60_000,
      NOW,
      NOW + 100,
      null,
      "old-session",
    ),
    false,
  );
  assertEquals(
    isSessionCreatedDuringSsoCallback(
      NOW,
      NOW,
      NOW + 100,
      "same-session",
      "same-session",
    ),
    false,
  );
});

Deno.test("SSO login proof verifies the callback provider and exact auth session", async () => {
  for (const protocol of ["SAML2.0", "OpenID Connect (OIDC)"] as const) {
    const proof = await createSsoLoginProof(
      SECRET,
      { ...IDENTITY, providerId: "contoso-sso", protocol },
      NOW,
    );
    const verified = await verifySsoLoginProof(proof, SECRET, IDENTITY, NOW);

    assertEquals(verified, { providerId: "contoso-sso", protocol });
  }
});

Deno.test("SSO login proof rejects invented, altered, and cross-session claims", async () => {
  const proof = await createSsoLoginProof(
    SECRET,
    {
      ...IDENTITY,
      providerId: "contoso-sso",
      protocol: "SAML2.0",
    },
    NOW,
  );
  if (!proof) throw new Error("Expected a signed test proof");

  const [encodedPayload, encodedSignature] = proof.split(".");
  const payloadBytes = atob(
    encodedPayload.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - encodedPayload.length % 4) % 4),
  );
  const payload = JSON.parse(payloadBytes) as Record<string, unknown>;
  payload.providerId = "invented-provider";
  const alteredPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const alteredProof = `${alteredPayload}.${encodedSignature}`;

  assertEquals(
    await verifySsoLoginProof(alteredProof, SECRET, IDENTITY, NOW),
    null,
  );
  assertEquals(
    await verifySsoLoginProof(proof, SECRET, {
      ...IDENTITY,
      sessionId: "different-session",
    }, NOW),
    null,
  );
  assertEquals(
    await verifySsoLoginProof(proof, SECRET, {
      ...IDENTITY,
      betterAuthUserId: "different-user",
    }, NOW),
    null,
  );
  assertEquals(
    await verifySsoLoginProof(proof, SECRET, IDENTITY, NOW + 5 * 60_000),
    null,
  );
});
