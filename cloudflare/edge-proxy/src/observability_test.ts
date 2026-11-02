import {
  createWorkerTraceContext,
  dispatchIncidentIoSecurityPage,
  logWorkerRequestCompletion,
  maybeReportWorkerResponse,
  parseWorkerTraceparent,
  reportWorkerException,
  reportWorkerHttpFailure,
  withWorkerRequestTelemetry,
  withTraceHeaders,
} from "./observability.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
};

const env = (extra: Partial<Env> = {}) => ({
  ITX_ENVIRONMENT: "test",
  ITX_OTEL_TRACE_SAMPLE_RATE: "1",
  ITX_LOG_SUCCESS_SAMPLE_RATE: "1",
  ITX_EDGE_PROXY_SHARED_SECRET: "test-secret",
  ...extra,
} as Env);

Deno.test("W3C traceparent parsing validates IDs, version, and sampled flag", () => {
  assertEquals(
    parseWorkerTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
    {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: "01",
    },
    "valid traceparent",
  );
  assertEquals(
    parseWorkerTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"),
    undefined,
    "zero trace id",
  );
  assertEquals(parseWorkerTraceparent("ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"), undefined, "invalid version");
  assertEquals(parseWorkerTraceparent("not-a-trace"), undefined, "malformed header");
});

Deno.test("Worker trace context continues inbound W3C context and injects a child header", () => {
  const request = new Request("https://edge.itemtraxx.com/functions/checkoutReturn", {
    headers: {
      "x-request-id": "request-1",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    },
  });
  const trace = createWorkerTraceContext(request, env());
  assertEquals(trace.traceId, "4bf92f3577b34da6a3ce929d0e0e4736", "trace id continuation");
  assertEquals(trace.parentSpanId, "00f067aa0ba902b7", "parent span continuation");
  assert(trace.spanId.length === 16 && trace.spanId !== trace.parentSpanId, "new span id");
  const traced = withTraceHeaders(request, trace);
  assertEquals(traced.headers.get("traceparent"), trace.traceparent, "injected traceparent");
  assertEquals(traced.headers.get("tracestate"), "vendor=value", "injected tracestate");
  assertEquals(
    traced.headers.get("x-itx-trace-parent-exported"),
    "false",
    "Worker parent export marker",
  );
});

Deno.test("simple browser request IDs correlate with Worker telemetry without exporting the query", async () => {
  const originalInfo = console.info;
  let output = "";
  console.info = (value?: unknown) => {
    output = String(value);
  };
  const expectedRequestId = "14aa123a-227e-4cba-b554-0b10abd2a10f";
  try {
    await withWorkerRequestTelemetry(
      new Request(
        `https://edge.itemtraxx.com/functions/admin-ops?itx_request_id=${expectedRequestId}`,
      ),
      env(),
      { waitUntil: (_promise: Promise<unknown>) => {} } as unknown as ExecutionContext,
      async ({ requestId }) => {
        assertEquals(requestId, expectedRequestId, "query request ID is retained");
        return new Response("ok");
      },
    );
  } finally {
    console.info = originalInfo;
  }
  const parsed = JSON.parse(output) as Record<string, unknown>;
  assertEquals(parsed.request_id, expectedRequestId, "completion log request ID");
  assert(!output.includes("itx_request_id"), "request ID query is not exported in the log");
});

Deno.test("Worker ignores unsafe query request IDs", async () => {
  let resolvedRequestId = "";
  await withWorkerRequestTelemetry(
    new Request("https://edge.itemtraxx.com/functions/admin-ops?itx_request_id=bad%0Aid"),
    env(),
    { waitUntil: (_promise: Promise<unknown>) => {} } as unknown as ExecutionContext,
    async ({ requestId }) => {
      resolvedRequestId = requestId;
      return new Response("ok");
    },
  );
  assert(
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(resolvedRequestId),
    "Worker generates a UUID fallback for an unsafe query ID",
  );
});

Deno.test("Worker exports deduplicable, privacy-safe request and security events", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const captures: Array<Record<string, unknown>> = [];
  const pending: Promise<unknown>[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== "https://us.i.posthog.com/batch/") {
      throw new Error(`Unexpected telemetry URL: ${String(input)}`);
    }
    captures.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  console.warn = () => {};
  try {
    await withWorkerRequestTelemetry(
      new Request("https://edge.itemtraxx.com/rest/v1/items?q=%3Cscript%3E", {
        headers: {
          "x-request-id": "14aa123a-227e-4cba-b554-0b10abd2a10f",
          "cf-connecting-ip": "203.0.113.17",
          authorization: "Bearer eyJraw-jwt-value",
          "user-agent": "ItemTraxx observability test",
        },
      }),
      env({
        ITX_POSTHOG_PROJECT_TOKEN: "phc_test",
        ITX_POSTHOG_CAPTURE_ENDPOINT: "https://us.i.posthog.com/i/v0/e/",
      } as Partial<Env>),
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
      async () => new Response("forbidden", { status: 403 }),
    );
    await Promise.all(pending);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
  const batch = captures[0]?.batch as Array<Record<string, unknown>> | undefined;
  assert(batch?.some((event) => event.event === "edge_request"), "request event is captured");
  assert(batch?.some((event) => event.event === "security_event"), "403 security event is captured");
  const security = batch?.find((event) => event.event === "security_event")?.properties as Record<string, unknown> | undefined;
  assert(security?.category === "auth_forbidden", "403 has auth_forbidden category");
  assert(security?.request_id === "14aa123a-227e-4cba-b554-0b10abd2a10f", "request ID supports cross-layer dedupe");
  assert(typeof security?.client_ip_hash === "string", "client address is HMAC-hashed");
  assert(!JSON.stringify(captures).includes("203.0.113.17"), "raw client IP is not captured");
  assert(!JSON.stringify(captures).includes("eyJraw-jwt-value"), "raw bearer token is not captured");
  assert(security?.["$process_person_profile"] === false, "service events do not create PostHog person profiles");
});

Deno.test("Worker dispatches SQLi pages asynchronously with privacy-safe incident metadata", async () => {
  const originalFetch = globalThis.fetch;
  const pending: Promise<unknown>[] = [];
  const captures: Array<Record<string, unknown>> = [];
  let resolveIncidentResponse: ((response: Response) => void) | undefined;
  let incidentStarted = false;
  let incidentStartedResolve: (() => void) | undefined;
  const incidentStartedPromise = new Promise<void>((resolve) => {
    incidentStartedResolve = resolve;
  });
  let incidentRequest: { headers: Headers; payload: Record<string, unknown> } | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === "https://incident.example/security") {
      incidentStarted = true;
      incidentStartedResolve?.();
      incidentRequest = {
        headers: new Headers(init?.headers),
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return new Promise<Response>((resolve) => {
        resolveIncidentResponse = resolve;
      });
    }
    captures.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  try {
    const requestPromise = withWorkerRequestTelemetry(
      new Request("https://edge.itemtraxx.com/rest/v1/items?q=union%20select", {
        headers: {
          "x-request-id": "14aa123a-227e-4cba-b554-0b10abd2a10f",
          "cf-connecting-ip": "203.0.113.99",
          authorization: "Bearer eyJworker-jwt-secret",
        },
      }),
      env({
        ITX_POSTHOG_PROJECT_TOKEN: "phc_test",
        ITX_POSTHOG_CAPTURE_ENDPOINT: "https://us.i.posthog.com/i/v0/e/",
        INCIDENT_IO_SECURITY_WEBHOOK_URL: "https://incident.example/security",
        INCIDENT_IO_SECURITY_API_KEY: "incident-worker-key",
      } as Partial<Env>),
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
      async () => new Response("ok", { status: 200 }),
    );
    const outcome = await Promise.race([
      requestPromise.then((response) => ({ response })),
      new Promise<{ response?: Response }>((resolve) =>
        setTimeout(() => resolve({}), 50)
      ),
    ]);
    if (!outcome.response) {
      await incidentStartedPromise;
      resolveIncidentResponse?.(new Response("accepted", { status: 202 }));
    }
    const response = await requestPromise;
    await incidentStartedPromise;
    resolveIncidentResponse?.(new Response("accepted", { status: 202 }));
    await Promise.all(pending);

    assert(outcome.response instanceof Response, "client response does not await incident.io");
    assertEquals(response.status, 200, "original response status is unchanged");
    assert(incidentStarted, "an SQLi signature starts an immediate incident request");
    const page = incidentRequest;
    assert(page, "incident request payload captured");
    assertEquals(page.headers.get("authorization"), "Bearer incident-worker-key", "incident API key uses bearer auth");
    assertEquals(page.headers.get("content-type"), "application/json", "incident payload uses JSON");
    assertEquals(page.payload.title, "[SECURITY CRITICAL] SQLi on /rest/v1/items", "SQLi title includes normalized route");
    assertEquals(page.payload.deduplication_key, "itx-sec-sqli-rest-v1-items", "incident deduplication key");
    assertEquals(page.payload.status, "firing", "incident is firing");
    assertEquals(page.payload.severity, "critical", "incident severity");
    const metadata = page.payload.metadata as Record<string, unknown>;
    assertEquals(metadata.attack_type, "sqli", "attack type");
    assertEquals(metadata.exploitation_status, "SUSPECTED EXPLOITATION", "successful response remains a suspicion");
    assertEquals(metadata.outcome, "SUSPECTED SUCCESS", "suspicious signature plus 2xx is not confirmed");
    assertEquals(metadata.http_status, 200, "incident includes the observed response status");
    assertEquals(metadata.request_id, "14aa123a-227e-4cba-b554-0b10abd2a10f", "incident includes the actual request ID");
    assertEquals(metadata.actor_id, "anon", "unresolved actor label");
    assert(typeof page.payload.description === "string" &&
      page.payload.description.includes("Exploitation Status: SUSPECTED EXPLOITATION") &&
      page.payload.description.includes("Security Outcome: SUSPECTED SUCCESS"),
      "both classifications are visible in the incident description");
    assert(typeof metadata.client_ip_hash === "string", "IP is represented by its keyed hash");
    assert(!JSON.stringify(page.payload).includes("203.0.113.99"), "raw IP is excluded from incident metadata");
    assert(!JSON.stringify(page.payload).includes("eyJworker-jwt-secret"), "raw JWT is excluded from incident metadata");
  } finally {
    resolveIncidentResponse?.(new Response("accepted", { status: 202 }));
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Worker can resolve a reclassified incident with the same deduplication key", async () => {
  const originalFetch = globalThis.fetch;
  const pending: Promise<unknown>[] = [];
  const payloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== "https://incident.example/security") {
      return Promise.reject(new Error("unexpected fetch target"));
    }
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(new Response("accepted", { status: 202 }));
  }) as typeof fetch;
  const pageEnv = env({
    INCIDENT_IO_SECURITY_WEBHOOK_URL: "https://incident.example/security",
    INCIDENT_IO_SECURITY_API_KEY: "incident-worker-key",
  } as Partial<Env>);
  const request = new Request("https://edge.itemtraxx.com/rest/v1/items", {
    headers: { "x-request-id": "14aa123a-227e-4cba-b554-0b10abd2a10f" },
  });
  const context = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as unknown as ExecutionContext;
  try {
    dispatchIncidentIoSecurityPage(
      pageEnv,
      request,
      "14aa123a-227e-4cba-b554-0b10abd2a10f",
      "sqli",
      context,
      403,
      "payload_signature",
      "firing",
    );
    dispatchIncidentIoSecurityPage(
      pageEnv,
      request,
      "14aa123a-227e-4cba-b554-0b10abd2a10f",
      "sqli",
      context,
      403,
      "payload_signature",
      "resolved",
    );
    await Promise.all(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(payloads.length, 2, "both alert lifecycle updates are delivered");
  assertEquals(payloads[0]?.status, "firing", "first event opens the alert");
  assertEquals(payloads[1]?.status, "resolved", "review can resolve the alert");
  assertEquals(
    payloads[0]?.deduplication_key,
    payloads[1]?.deduplication_key,
    "reclassification uses the original stable deduplication key",
  );
});

Deno.test("Worker scans rejected JSON for safe input signatures without exporting payload values", async () => {
  const originalFetch = globalThis.fetch;
  const pending: Promise<unknown>[] = [];
  const captures: Array<Record<string, unknown>> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== "https://us.i.posthog.com/batch/") {
      throw new Error(`Unexpected telemetry URL: ${String(input)}`);
    }
    captures.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await withWorkerRequestTelemetry(
      new Request("https://edge.itemtraxx.com/rest/v1/items", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "14aa123a-227e-4cba-b554-0b10abd2a10f",
        },
        body: JSON.stringify({
          name: "<script>alert(1)</script> attacker@example.com",
          password: "super-secret-password",
        }),
      }),
      env({
        ITX_POSTHOG_PROJECT_TOKEN: "phc_test",
        ITX_POSTHOG_CAPTURE_ENDPOINT: "https://us.i.posthog.com/i/v0/e/",
      } as Partial<Env>),
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
      async () => new Response("invalid", { status: 422 }),
    );
    await Promise.all(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const batch = captures.flatMap((capture) => capture.batch as Array<Record<string, unknown>>);
  const requestEvent = batch.find((event) => event.event === "edge_request");
  const requestProperties = requestEvent?.properties as Record<string, unknown>;
  assertEquals(requestProperties.rejected_fields, ["name"], "sensitive body fields are omitted");
  assertEquals(requestProperties.rejected_input_snippets, ["<script"], "only fixed safe snippets are retained");
  const serialized = JSON.stringify(captures);
  assert(!serialized.includes("attacker@example.com"), "email values are not exported");
  assert(!serialized.includes("super-secret-password"), "password values are not exported");
  assert(!serialized.includes("<script>alert"), "attacker-controlled payload is not exported");
});

Deno.test("worker exception logs redact query secrets and do not send a remote payload", async () => {
  const originalError = console.error;
  let output = "";
  console.error = (value?: unknown) => {
    output = String(value);
  };
  try {
    await reportWorkerException(
      env(),
      new Request("https://edge.itemtraxx.com/functions/system-status?token=secret"),
      "request-1",
      new Error("backend token=secret"),
    );
  } finally {
    console.error = originalError;
  }
  assert(output.includes("worker.request.exception"), "structured exception event");
  assert(!output.includes("token=secret"), "query secret redacted");
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

  maybeReportWorkerResponse(env(), request, "request-ok", new Response(null, { status: 499 }), ctx);
  assertEquals(waitCount, 0, "non-5xx wait count");
  maybeReportWorkerResponse(env(), request, "request-failed", new Response(null, { status: 503 }), ctx, { type: "function" });
  assertEquals(waitCount, 1, "5xx wait count");
  assert(ownedContext, "waitUntil must be invoked on its ExecutionContext owner");
});

Deno.test("Worker HTTP failure records carry the request trace correlation", async () => {
  const originalError = console.error;
  let output = "";
  console.error = (value?: unknown) => {
    output = String(value);
  };
  try {
    const request = new Request("https://edge.itemtraxx.com/functions/checkoutReturn");
    const trace = createWorkerTraceContext(request, env());
    await reportWorkerHttpFailure(
      env(),
      request,
      "request-failed",
      503,
      "upstream failed",
      { type: "function" },
      trace,
    );
    const parsed = JSON.parse(output) as Record<string, unknown>;
    assertEquals(parsed.trace_id, trace.traceId, "failure trace id");
    assertEquals(parsed.span_id, trace.spanId, "failure span id");
  } finally {
    console.error = originalError;
  }
});

Deno.test("request completion records safe request metadata at full sampling", async () => {
  const originalInfo = console.info;
  let output = "";
  console.info = (value?: unknown) => {
    output = String(value);
  };
  try {
    const request = new Request("https://edge.itemtraxx.com/functions/checkoutReturn?search=drill&token=secret", {
      headers: {
        "cf-connecting-ip": "203.0.113.17",
        authorization: "Bearer eyJsecret-token-value",
        "user-agent": "ItemTraxx test agent",
      },
    });
    const trace = createWorkerTraceContext(request, env());
    await logWorkerRequestCompletion(env(), request, "request-1", trace, "POST /functions/checkoutReturn", 200, 42, {
      retry_count: 0,
      error_code: undefined,
    });
  } finally {
    console.info = originalInfo;
  }
  const parsed = JSON.parse(output) as Record<string, unknown>;
  assertEquals(parsed.service, "itemtraxx-edge-proxy", "service");
  assertEquals(parsed.route, "/functions/checkoutReturn", "query-free route");
  assertEquals(parsed.status, 200, "status");
  assertEquals(parsed.request_id, "request-1", "request id");
  assertEquals(parsed.method, "GET", "method");
  assertEquals(parsed.user_agent, "ItemTraxx test agent", "user agent");
  assert(typeof parsed.client_ip_hash === "string", "client IP is keyed-hashed");
  assert(typeof parsed.session_hash === "string", "session credential is keyed-hashed");
  assertEquals(parsed.query_keys, ["search"], "safe query key is retained");
  assert(typeof parsed.trace_id === "string" && typeof parsed.span_id === "string", "trace fields");
  assert(!output.includes("203.0.113.17"), "raw client IP must not be logged");
  assert(!output.includes("eyJsecret-token-value"), "raw session token must not be logged");
  assert(!output.includes("token=secret"), "telemetry must not export query secrets");
});

Deno.test("Worker emits categorized security events for unauthorized responses", async () => {
  const originalWarn = console.warn;
  const output: string[] = [];
  console.warn = (value?: unknown) => output.push(String(value));
  try {
    await withWorkerRequestTelemetry(
      new Request("https://edge.itemtraxx.com/rest/v1/items", {
        headers: { "cf-connecting-ip": "203.0.113.17" },
      }),
      env(),
      { waitUntil: (_promise: Promise<unknown>) => {} } as unknown as ExecutionContext,
      async () => new Response("forbidden", { status: 403 }),
    );
  } finally {
    console.warn = originalWarn;
  }
  const security = output.map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((event) => event.event === "security_event");
  assert(security, "security event should be emitted");
  assertEquals(security.category, "auth_forbidden", "security category");
  assertEquals(security.status, 403, "security status");
  assert(typeof security.client_ip_hash === "string", "security event has keyed IP hash");
});
