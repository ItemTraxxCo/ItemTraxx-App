import { handleJitAccessAction, JIT_ACCESS_ACTIONS } from "./jitAccess.ts";
import { verifyJitTicketSignature } from "../../_shared/jitTicket.ts";
import type { SuperOpsContext } from "../context.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: status < 400, ...body }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const generateKeys = async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    publicJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey)),
  };
};

const ADMIN_ID = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "20000000-0000-4000-8000-000000000001";
const TICKET_ID = "30000000-0000-4000-8000-000000000001";
const BG_EVENT_ID = "40000000-0000-4000-8000-000000000001";

const contextFor = (
  action: string,
  payload: Record<string, unknown>,
  adminClient: unknown,
) => ({
  req: new Request("https://example.test/functions/v1/super-ops", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.10",
      "user-agent": "DenoTest/1.0",
      "x-request-id": "req-jit-test",
    },
  }),
  action,
  payload,
  adminClient,
  user: { id: ADMIN_ID, email: "super@itemtraxx.com" },
  profile: { auth_email: "super@itemtraxx.com" },
  accessToken: "token",
  supabaseUrl: "https://example.test",
  publishableKey: "key",
  jsonResponse,
  writeAudit: async () => {},
} as unknown as SuperOpsContext);

Deno.test("JIT_ACCESS_ACTIONS exposes all 5 ticket and audit actions", () => {
  assert(JIT_ACCESS_ACTIONS.length === 5, "expected 5 JIT actions");
});

Deno.test("request_jit_ticket issues signed ES256 read_only ticket and dispatches webhooks", async () => {
  const { privateJwk, publicJwk } = await generateKeys();
  const webhookEvents: string[] = [];
  const rpcCalls: string[] = [];
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  const adminClient = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push(name);
      if (name === "issue_jit_support_ticket") {
        return Promise.resolve({
          data: {
            id: TICKET_ID,
            admin_user_id: args.p_admin_user_id,
            workspace_id: args.p_workspace_id,
            scope: "read_only",
            status: "active",
            reason: args.p_reason,
            external_ticket_id: args.p_external_ticket_id,
            ttl_minutes: args.p_ttl_minutes,
            token_jti: args.p_token_jti,
            issued_at: issuedAt,
            expires_at: expiresAt,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: crypto.randomUUID(), error: null });
    },
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };

  const envMap: Record<string, string> = {
    ITX_JIT_AUDIT_WEBHOOK_URLS: "https://hooks.example.test/jit",
    ITX_AUDIT_WEBHOOK_SIGNING_SECRET: "k".repeat(48),
  };

  const response = await handleJitAccessAction(
    contextFor(
      "request_jit_ticket",
      {
        workspace_id: WORKSPACE_ID,
        reason: "Support ticket investigation for checkout barcode",
        external_ticket_id: "SUP-442",
        ttl_minutes: 15,
      },
      adminClient,
    ),
    {
      signingConfig: { privateJwk },
      getEnv: (name) => envMap[name],
      webhookDeps: {
        getEnv: (name) => envMap[name],
        sleep: async () => {},
        fetcher: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { event_type: string };
          webhookEvents.push(body.event_type);
          return new Response("ok", { status: 200 });
        },
      },
    },
  );

  assert(response !== null && response.status === 200, "expected 200");
  const json = await response.json() as {
    ok: boolean;
    data: { token: string; ticket: { id: string; scope: string } };
  };
  assert(json.ok === true && json.data.ticket.scope === "read_only", "expected read_only ticket");
  const verified = await verifyJitTicketSignature(json.data.token, { publicJwk });
  assert(verified.ok === true && verified.claims.ws === WORKSPACE_ID, "issued token must verify");
  assert(
    webhookEvents.includes("jit.ticket.requested") && webhookEvents.includes("jit.ticket.granted"),
    "requested and granted webhooks must fire",
  );
  assert(rpcCalls.includes("issue_jit_support_ticket"), "expected issue RPC");
});

Deno.test("invoke_break_glass succeeds with optional incident_id omitted when alert quorum is met", async () => {
  const { privateJwk, publicJwk } = await generateKeys();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  const adminClient = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "invoke_break_glass_access") {
        assert(args.p_incident_id === null, "incident_id should be optional/null");
        return Promise.resolve({
          data: [{
            ticket_id: TICKET_ID,
            break_glass_event_id: BG_EVENT_ID,
            token_jti: args.p_token_jti,
            issued_at: issuedAt,
            expires_at: expiresAt,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: crypto.randomUUID(), error: null });
    },
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };

  const envMap: Record<string, string> = {
    ITX_JIT_AUDIT_WEBHOOK_URLS: "https://hooks.example.test/bg",
    ITX_AUDIT_WEBHOOK_SIGNING_SECRET: "k".repeat(48),
  };

  const response = await handleJitAccessAction(
    contextFor(
      "invoke_break_glass",
      {
        workspace_id: WORKSPACE_ID,
        justification: "Emergency borrower record restoration requested by school IT",
        acknowledged_by: "Dennis Frenkel",
      },
      adminClient,
    ),
    {
      signingConfig: { privateJwk },
      getEnv: (name) => envMap[name],
      webhookDeps: {
        getEnv: (name) => envMap[name],
        sleep: async () => {},
        inlineBackoffMs: [0, 1],
        fetcher: async () => new Response("ok", { status: 200 }),
      },
    },
  );

  assert(response !== null && response.status === 200, "expected 200");
  const json = await response.json() as {
    data: { token: string; break_glass_event_id: string; alert_delivery: { status: string } };
  };
  assert(json.data.break_glass_event_id === BG_EVENT_ID, "event ID mismatch");
  assert(json.data.alert_delivery.status === "delivered", "expected delivered status");
  const verified = await verifyJitTicketSignature(json.data.token, { publicJwk });
  assert(verified.ok === true && verified.claims.scope === "break_glass", "expected break_glass scope");
});

Deno.test("invoke_break_glass fails closed (503) when zero alert channels deliver", async () => {
  const { privateJwk } = await generateKeys();
  const auditTypes: string[] = [];
  let invokedRpc = false;

  const adminClient = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "invoke_break_glass_access") invokedRpc = true;
      if (name === "append_jit_audit_log") auditTypes.push(String(args.p_event_type));
      return Promise.resolve({ data: crypto.randomUUID(), error: null });
    },
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };

  const envMap: Record<string, string> = {
    ITX_JIT_AUDIT_WEBHOOK_URLS: "https://hooks.example.test/bg",
    ITX_AUDIT_WEBHOOK_SIGNING_SECRET: "k".repeat(48),
  };

  const response = await handleJitAccessAction(
    contextFor(
      "invoke_break_glass",
      {
        workspace_id: WORKSPACE_ID,
        justification: "Emergency borrower record restoration requested by school IT",
        acknowledged_by: "Dennis Frenkel",
      },
      adminClient,
    ),
    {
      signingConfig: { privateJwk },
      getEnv: (name) => envMap[name],
      webhookDeps: {
        getEnv: (name) => envMap[name],
        sleep: async () => {},
        inlineBackoffMs: [0, 1],
        fetcher: async () => new Response("down", { status: 503 }),
      },
    },
  );

  assert(response !== null && response.status === 503, "must fail closed with 503");
  assert(invokedRpc === false, "must NOT grant break-glass ticket when zero alerts delivered");
  assert(auditTypes.includes("jit.break_glass.alert_failed"), "expected alert_failed audit log");
});
