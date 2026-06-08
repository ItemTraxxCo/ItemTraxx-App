import { canRegisterAdminStepUpFromTrustedHandoff } from "./privilegedStepUp.ts";

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

Deno.test("admin step-up registration accepts fresh trusted handoff tokens", () => {
  const token = unsignedJwt({
    iat: Math.floor(Date.now() / 1000),
    session_id: "session-1",
    amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }],
  });

  assert(
    canRegisterAdminStepUpFromTrustedHandoff(token),
    "expected trusted handoff token",
  );
});

Deno.test("admin step-up registration rejects fresh password-only tokens", () => {
  const token = unsignedJwt({
    iat: Math.floor(Date.now() / 1000),
    session_id: "session-1",
    amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
  });

  assert(
    !canRegisterAdminStepUpFromTrustedHandoff(token),
    "expected password-only token rejection",
  );
});
