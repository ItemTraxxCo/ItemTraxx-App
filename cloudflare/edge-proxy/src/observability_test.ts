import {
  buildSentryEnvelope,
  maybeReportWorkerResponse,
  parseSentryDsn,
  reportWorkerEvent,
} from "./observability.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

Deno.test("Sentry DSN parsing preserves public key, project ID, and envelope endpoint", () => {
  assertEquals(parseSentryDsn("https://public-key@o123.ingest.sentry.io/456"), {
    publicKey: "public-key",
    projectId: "456",
    storeUrl: "https://o123.ingest.sentry.io/api/456/envelope/",
  }, "valid DSN");

  for (const dsn of [undefined, null, "", "not a URL", "https://o123.ingest.sentry.io/456", "https://public@o123.ingest.sentry.io/"]) {
    assertEquals(parseSentryDsn(dsn), null, `invalid DSN: ${String(dsn)}`);
  }
});

Deno.test("Sentry envelope creation uses deterministic UUID and timestamp dependencies", () => {
  const sentry = parseSentryDsn("https://public-key@o123.ingest.sentry.io/456");
  if (!sentry) throw new Error("Expected valid fixture DSN");
  const envelope = buildSentryEnvelope(
    sentry,
    { level: "error", message: "fixture failure", extra: { requestId: "request-123" } },
    {
      randomUUID: () => "123e4567-e89b-12d3-a456-426614174000",
      now: () => 1712345678901,
    },
  );
  const [rawEnvelopeHeaders, rawItemHeaders, rawPayload] = envelope.split("\n");
  assertEquals(JSON.parse(rawEnvelopeHeaders ?? ""), {
    event_id: "123e4567e89b12d3a456426614174000",
    sent_at: "2024-04-05T19:34:38.901Z",
  }, "envelope headers");
  assertEquals(JSON.parse(rawItemHeaders ?? ""), { type: "event" }, "item headers");
  assertEquals(JSON.parse(rawPayload ?? ""), {
    event_id: "123e4567e89b12d3a456426614174000",
    timestamp: 1712345678,
    platform: "javascript",
    logger: "itemtraxx-edge-proxy",
    level: "error",
    message: "fixture failure",
    extra: { requestId: "request-123" },
  }, "event payload");
});

Deno.test("worker event reporting sends the unchanged Sentry envelope request", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  try {
    await reportWorkerEvent(
      { SENTRY_DSN: " https://public-key@o123.ingest.sentry.io/456 " } as Env,
      { message: "fixture failure" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assertEquals(capturedUrl, "https://o123.ingest.sentry.io/api/456/envelope/", "Sentry endpoint");
  assertEquals(capturedInit?.method, "POST", "Sentry method");
  const headers = new Headers(capturedInit?.headers);
  assertEquals(headers.get("content-type"), "application/x-sentry-envelope", "Sentry content type");
  assertEquals(
    headers.get("x-sentry-auth"),
    "Sentry sentry_version=7, sentry_client=itemtraxx-edge-proxy/1.0, sentry_key=public-key",
    "Sentry auth header",
  );
  assert(typeof capturedInit?.body === "string" && capturedInit.body.split("\n").length === 3, "Sentry envelope body");
});

Deno.test("5xx response reporting keeps ExecutionContext waitUntil ownership", () => {
  let waitCount = 0;
  let ownedContext = false;
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      waitCount += 1;
      ownedContext = this === ctx;
      void promise;
    },
  } as unknown as ExecutionContext;
  const request = new Request("https://edge.itemtraxx.com/functions/system-status", {
    headers: { origin: "https://itemtraxx.com" },
  });

  maybeReportWorkerResponse({} as Env, request, "request-ok", new Response(null, { status: 499 }), ctx);
  assertEquals(waitCount, 0, "non-5xx wait count");

  maybeReportWorkerResponse(
    {} as Env,
    request,
    "request-failed",
    new Response(null, { status: 503 }),
    ctx,
    { type: "function" },
  );
  assertEquals(waitCount, 1, "5xx wait count");
  assert(ownedContext, "waitUntil must be invoked on its ExecutionContext owner");
});
