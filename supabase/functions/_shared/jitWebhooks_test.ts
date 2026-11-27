import {
  buildBreakGlassSecurityEmailHtml,
  computeExponentialBackoffMs,
  dispatchJitSecurityEvent,
  signJitWebhookEvent,
  verifyJitWebhookSignature,
  type JitWebhookPayload,
} from "./jitWebhooks.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const samplePayload = (
  eventType: JitWebhookPayload["event_type"] = "jit.break_glass.invoked",
): JitWebhookPayload => ({
  event_id: "50000000-0000-4000-8000-000000000001",
  event_type: eventType,
  timestamp_utc: "2026-11-26T12:00:00.000Z",
  actor: {
    id: "10000000-0000-4000-8000-000000000001",
    email: "ops@itemtraxx.com",
  },
  target_workspace_id: "20000000-0000-4000-8000-000000000001",
  ticket_id: "30000000-0000-4000-8000-000000000001",
  scope: "break_glass",
  action: "invoke_break_glass",
  reason: "Emergency borrower recovery requested by district admin",
  incident_id: null,
  acknowledged_by: "Dennis Frenkel",
  client: {
    ip_hash: "abc123",
    user_agent: "TestBrowser/1.0",
    request_id: "req-123",
  },
});

Deno.test("webhook HMAC-SHA256 signatures verify cleanly and reject tampering", async () => {
  const body = JSON.stringify(samplePayload("jit.ticket.granted"));
  const secret = "s".repeat(48);
  const sig = await signJitWebhookEvent(body, 1_700_000_000, secret);
  assert(sig.startsWith("t=1700000000,v1="), "unexpected signature format");
  assert(await verifyJitWebhookSignature(body, sig, secret), "signature should verify");
  assert(!(await verifyJitWebhookSignature(body + " ", sig, secret)), "tampered body must fail");
});

Deno.test("exponential backoff doubles per attempt and caps at max", () => {
  assert(computeExponentialBackoffMs(1) === 30_000, "attempt 1 = 30s");
  assert(computeExponentialBackoffMs(2) === 60_000, "attempt 2 = 60s");
  assert(computeExponentialBackoffMs(3) === 120_000, "attempt 3 = 120s");
  assert(computeExponentialBackoffMs(12) === 3_600_000, "capped at 1h");
});

Deno.test("break-glass email reuses branded ItemTraxx email theme and escapes HTML", () => {
  const payload = samplePayload("jit.break_glass.invoked");
  payload.reason = "Restore <script>alert(1)</script> record";
  const html = buildBreakGlassSecurityEmailHtml(payload);
  assert(html.includes("cid:itemtraxx-logo-light"), "expected branded logo CID");
  assert(html.includes("border-radius:12px"), "expected applyEmailTheme styling");
  assert(!html.includes("<script>"), "HTML must be escaped");
  assert(html.includes("Not provided"), "optional incident_id should render cleanly");
});

Deno.test("Slack webhook URLs format payload with top-level text and never page Incident.io", async () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const envMap: Record<string, string> = {
    ITX_AUDIT_WEBHOOK_SIGNING_SECRET: "w".repeat(48),
    ITX_JIT_AUDIT_WEBHOOK_URLS: "https://hooks.slack.com/services/T000/B000/XXX",
    INCIDENT_IO_SECURITY_WEBHOOK_URL: "https://api.incident.io/v2/alert_events/http/test",
    INCIDENT_IO_SECURITY_API_KEY: "inc_secret",
  };

  const result = await dispatchJitSecurityEvent(
    {
      payload: samplePayload("jit.break_glass.invoked"),
      isBreakGlass: true,
    },
    {
      getEnv: (name) => envMap[name],
      sleep: async () => {},
      inlineBackoffMs: [0],
      fetcher: async (input, init) => {
        seen.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return new Response("ok", { status: 200 });
      },
    },
  );

  assert(result.quorumMet === true, "Slack webhook should satisfy quorum");
  assert(seen.length === 1, `expected only Slack webhook (never Incident.io), got ${seen.length}`);
  assert(seen[0].url.startsWith("https://hooks.slack.com/services/"), "expected Slack URL");
  assert(typeof seen[0].body.text === "string" && seen[0].body.text.includes("BREAK-GLASS"), "expected Slack text field");
});

Deno.test("break-glass multi-channel quorum succeeds when >=1 channel delivers and queues failed secondary", async () => {
  const queued: Array<Record<string, unknown>> = [];
  const adminClient = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === "async_jobs") queued.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };

  const envMap: Record<string, string> = {
    ITX_AUDIT_WEBHOOK_SIGNING_SECRET: "w".repeat(48),
    ITX_JIT_AUDIT_WEBHOOK_URLS: "https://hooks.slack.com/services/T000/B000/HOG,https://siem.example.test/jit",
    ITX_RESEND_API_KEY: "re_test_key",
  };

  const seenUrls: string[] = [];
  const result = await dispatchJitSecurityEvent(
    {
      payload: samplePayload("jit.break_glass.invoked"),
      adminClient,
      isBreakGlass: true,
    },
    {
      getEnv: (name) => envMap[name],
      sleep: async () => {},
      inlineBackoffMs: [0, 1, 2],
      sendResendEmail: async () => ({ id: "email-1" }),
      fetcher: async (input) => {
        const url = String(input);
        seenUrls.push(url);
        if (url.includes("siem.example.test")) {
          return new Response("down", { status: 503 });
        }
        return new Response("ok", { status: 200 });
      },
    },
  );

  assert(result.quorumMet === true, "quorum should be met when Slack + email delivered");
  assert(result.deliveryStatus === "partial", `expected partial, got ${result.deliveryStatus}`);
  assert(result.deliveredChannels.includes("webhook:0"), "Slack webhook delivered");
  assert(result.deliveredChannels.includes("resend_email"), "email delivered");
  assert(result.failedChannels.length === 1 && result.failedChannels[0].channel === "webhook:1", "secondary webhook failed");
  assert(result.failedChannels[0].attempts === 3, "secondary webhook should retry 3 times inline");
  assert(queued.length === 1 && queued[0].job_type === "jit_audit_webhook", "failed secondary should be enqueued");
  assert(seenUrls.filter((u) => u.includes("siem.example.test")).length === 3, "expected 3 retries");
});

Deno.test("break-glass fails closed when zero alerting channels confirm delivery", async () => {
  const queued: Array<Record<string, unknown>> = [];
  const adminClient = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        queued.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };

  const envMap: Record<string, string> = {
    ITX_AUDIT_WEBHOOK_SIGNING_SECRET: "w".repeat(48),
    ITX_JIT_AUDIT_WEBHOOK_URLS: "https://hooks.slack.com/services/T000/B000/HOG,https://siem.example.test/jit",
  };

  const result = await dispatchJitSecurityEvent(
    {
      payload: samplePayload("jit.break_glass.invoked"),
      adminClient,
      isBreakGlass: true,
    },
    {
      getEnv: (name) => envMap[name],
      sleep: async () => {},
      inlineBackoffMs: [0, 1],
      fetcher: async () => new Response("unavailable", { status: 503 }),
    },
  );

  assert(result.quorumMet === false, "zero delivered channels must fail closed");
  assert(result.deliveryStatus === "failed", "expected failed status");
  assert(queued.length === 2, "both failed channels should enqueue retries");
});
