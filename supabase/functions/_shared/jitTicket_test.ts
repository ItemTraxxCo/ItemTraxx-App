import {
  JIT_TICKET_HEADER,
  requireValidJitTicket,
  signJitTicket,
  verifyJitTicketSignature,
} from "./jitTicket.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const generateEs256KeyPair = async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
  const publicJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey));
  return { privateJwk, publicJwk };
};

const ADMIN_ID = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_A = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_B = "20000000-0000-4000-8000-000000000002";
const TICKET_ID = "30000000-0000-4000-8000-000000000001";
const TOKEN_JTI = "40000000-0000-4000-8000-000000000001";

Deno.test("ES256 signed JIT ticket verifies before expiry and rejects at T and T+1s", async () => {
  const { privateJwk, publicJwk } = await generateEs256KeyPair();
  const iat = 1_700_000_000;
  const exp = iat + 900;
  const token = await signJitTicket(
    {
      jti: TOKEN_JTI,
      tid: TICKET_ID,
      sub: ADMIN_ID,
      ws: WORKSPACE_A,
      scope: "read_only",
      rsn: "SUP-102",
      iat,
      exp,
    },
    { privateJwk },
  );

  const atBefore = await verifyJitTicketSignature(token, { publicJwk }, (exp - 1) * 1000);
  assert(atBefore.ok === true, "expected ticket valid at T-1s");
  assert(atBefore.claims.ws === WORKSPACE_A, "workspace claim mismatch");

  const atExact = await verifyJitTicketSignature(token, { publicJwk }, exp * 1000);
  assert(atExact.ok === false && atExact.reason === "expired", "expected rejection at T");

  const atAfter = await verifyJitTicketSignature(token, { publicJwk }, (exp + 1) * 1000);
  assert(atAfter.ok === false && atAfter.reason === "expired", "expected rejection at T+1s");
});

Deno.test("tampered JIT ticket signature is rejected", async () => {
  const { privateJwk, publicJwk } = await generateEs256KeyPair();
  const iat = 1_700_000_000;
  const exp = iat + 900;
  const token = await signJitTicket(
    {
      jti: TOKEN_JTI,
      tid: TICKET_ID,
      sub: ADMIN_ID,
      ws: WORKSPACE_A,
      scope: "read_only",
      rsn: "SUP-102",
      iat,
      exp,
    },
    { privateJwk },
  );

  const [header, , sig] = token.split(".");
  const tamperedPayload = btoa(
    JSON.stringify({
      iss: "itemtraxx-jit",
      aud: "itemtraxx-sgw",
      jti: TOKEN_JTI,
      tid: TICKET_ID,
      sub: ADMIN_ID,
      ws: WORKSPACE_A,
      scope: "break_glass",
      rsn: "SUP-102",
      iat,
      exp,
    }),
  ).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

  const result = await verifyJitTicketSignature(
    `${header}.${tamperedPayload}.${sig}`,
    { publicJwk },
    (iat + 10) * 1000,
  );
  assert(result.ok === false && result.reason === "invalid_signature", "tampered scope should fail");
});

Deno.test("requireValidJitTicket enforces scope, workspace isolation, and DB revocation", async () => {
  const { privateJwk, publicJwk } = await generateEs256KeyPair();
  const iat = 1_700_000_000;
  const exp = iat + 900;
  const token = await signJitTicket(
    {
      jti: TOKEN_JTI,
      tid: TICKET_ID,
      sub: ADMIN_ID,
      ws: WORKSPACE_A,
      scope: "read_only",
      rsn: "SUP-200",
      iat,
      exp,
    },
    { privateJwk },
  );

  const deniedEvents: Array<Record<string, unknown>> = [];
  let dbActive = true;
  const adminClient = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "append_jit_audit_log") {
        deniedEvents.push(args);
        return Promise.resolve({ data: crypto.randomUUID(), error: null });
      }
      if (name === "verify_jit_support_ticket") {
        return Promise.resolve({ data: dbActive, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  const makeReq = (withToken = true) =>
    new Request("https://example.test/functions/v1/super-borrower-mutate", {
      method: "POST",
      headers: withToken ? { [JIT_TICKET_HEADER]: token } : {},
    });

  // Missing ticket -> 403
  const missing = await requireValidJitTicket({
    req: makeReq(false),
    adminClient,
    actorId: ADMIN_ID,
    workspaceId: WORKSPACE_A,
    requiredScope: "read_only",
    action: "list",
    verificationConfig: { publicJwk },
    nowMs: (iat + 5) * 1000,
  });
  assert(missing.ok === false && missing.status === 403, "missing ticket must fail closed with 403");

  // Read-only ticket cannot trigger break_glass mutation -> 403
  const insufficientScope = await requireValidJitTicket({
    req: makeReq(true),
    adminClient,
    actorId: ADMIN_ID,
    workspaceId: WORKSPACE_A,
    requiredScope: "break_glass",
    action: "create",
    verificationConfig: { publicJwk },
    nowMs: (iat + 5) * 1000,
  });
  assert(
    insufficientScope.ok === false &&
      insufficientScope.status === 403 &&
      insufficientScope.reason === "insufficient_scope",
    "read_only ticket must be blocked for break_glass mutations",
  );

  // Wrong workspace -> 403
  const wrongWorkspace = await requireValidJitTicket({
    req: makeReq(true),
    adminClient,
    actorId: ADMIN_ID,
    workspaceId: WORKSPACE_B,
    requiredScope: "read_only",
    action: "list",
    verificationConfig: { publicJwk },
    nowMs: (iat + 5) * 1000,
  });
  assert(
    wrongWorkspace.ok === false && wrongWorkspace.reason === "workspace_mismatch",
    "cross-workspace ticket reuse must fail",
  );

  // Valid read_only ticket succeeds while active in DB
  const valid = await requireValidJitTicket({
    req: makeReq(true),
    adminClient,
    actorId: ADMIN_ID,
    workspaceId: WORKSPACE_A,
    requiredScope: "read_only",
    action: "list",
    verificationConfig: { publicJwk },
    nowMs: (iat + 5) * 1000,
  });
  assert(valid.ok === true && valid.claims.tid === TICKET_ID, "valid ticket should pass");

  // Revoked in DB -> immediate 403 before TTL expiry
  dbActive = false;
  const revoked = await requireValidJitTicket({
    req: makeReq(true),
    adminClient,
    actorId: ADMIN_ID,
    workspaceId: WORKSPACE_A,
    requiredScope: "read_only",
    action: "list",
    verificationConfig: { publicJwk },
    nowMs: (iat + 10) * 1000,
  });
  assert(
    revoked.ok === false &&
      revoked.status === 403 &&
      revoked.reason === "revoked_or_expired",
    "revoked ticket must fail immediately before TTL",
  );
  assert(deniedEvents.length === 4, `expected 4 denied audit entries, got ${deniedEvents.length}`);
});
