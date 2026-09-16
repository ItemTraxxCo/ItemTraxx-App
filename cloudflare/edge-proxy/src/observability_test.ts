import {
  createWorkerTraceContext,
  logWorkerRequestCompletion,
  maybeReportWorkerResponse,
  parseWorkerTraceparent,
  reportWorkerException,
  reportWorkerHttpFailure,
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

Deno.test("request completion emits a wide structured event with trace correlation", () => {
  const originalInfo = console.info;
  let output = "";
  console.info = (value?: unknown) => {
    output = String(value);
  };
  try {
    const request = new Request("https://edge.itemtraxx.com/functions/checkoutReturn?token=secret");
    const trace = createWorkerTraceContext(request, env());
    logWorkerRequestCompletion(env(), request, "request-1", trace, "POST /functions/checkoutReturn", 200, 42, {
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
  assert(typeof parsed.trace_id === "string" && typeof parsed.span_id === "string", "trace fields");
  assert(!output.includes("token=secret"), "telemetry must not export query secrets");
});
