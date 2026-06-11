import { canRegisterAdminStepUpFromTrustedHandoff } from "./privilegedStepUp.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const authClient = (claims: Record<string, unknown> | null) => ({
  auth: {
    getClaims: () => Promise.resolve({
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
