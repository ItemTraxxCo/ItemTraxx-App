import {
  flushEventExports,
  flushTraceExports,
  logError,
  logInfo,
  startRequestSpan,
  withRequestSpan,
  withSecurityLogging,
} from "./observability.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const capture = (
  level: "info" | "error",
  run: () => void,
) => {
  const original = console[level];
  const calls: unknown[][] = [];
  console[level] = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    run();
  } finally {
    console[level] = original;
  }
  return calls;
};

Deno.test("observability logs control characters as one JSON line", () => {
  const infoCalls = capture("info", () => {
    logInfo("event\nforged", "request\r\nforged", {
      detail: "value\nforged",
    });
  });
  assert(infoCalls.length === 1, "expected one info log call");
  assert(infoCalls[0].length === 1, "expected one serialized info argument");
  const infoLine = infoCalls[0][0];
  if (typeof infoLine !== "string") {
    throw new Error("expected serialized info output");
  }
  assert(
    !infoLine.includes("\n") && !infoLine.includes("\r"),
    "info output must stay on one line",
  );
  const parsedInfo = JSON.parse(infoLine);
  assert(
    parsedInfo.event === "event\nforged",
    "event should round-trip through JSON",
  );
  assert(
    parsedInfo.request_id === "request\r\nforged",
    "request ID should round-trip through JSON",
  );
  assert(
    parsedInfo.detail === "value\nforged",
    "extra data should round-trip through JSON",
  );

  const errorCalls = capture("error", () => {
    logError(
      "error\nforged",
      "request\r\nforged",
      new Error("failure\nforged"),
    );
  });
  assert(errorCalls.length === 1, "expected one error log call");
  assert(errorCalls[0].length === 1, "expected one serialized error argument");
  const errorLine = errorCalls[0][0];
  if (typeof errorLine !== "string") {
    throw new Error("expected serialized error output");
  }
  assert(
    !errorLine.includes("\n") && !errorLine.includes("\r"),
    "error output must stay on one line",
  );
  const parsedError = JSON.parse(errorLine);
  assert(
    parsedError.event === "error\nforged",
    "error event should round-trip through JSON",
  );
  assert(
    parsedError.request_id === "request\r\nforged",
    "error request ID should round-trip through JSON",
  );
  assert(
    parsedError.message === undefined && parsedError.stack === undefined,
    "error messages and stack traces are excluded from structured logs",
  );
});

Deno.test("request middleware captures safe metadata and emits validation and payload security events", async () => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const previous = {
    token: Deno.env.get("ITX_POSTHOG_PROJECT_TOKEN"),
    capture: Deno.env.get("ITX_POSTHOG_CAPTURE_ENDPOINT"),
    ingressSecret: Deno.env.get("ITX_EDGE_PROXY_SHARED_SECRET"),
    sampleRate: Deno.env.get("ITX_OTEL_TRACE_SAMPLE_RATE"),
    incidentUrl: Deno.env.get("INCIDENT_IO_SECURITY_WEBHOOK_URL"),
    incidentKey: Deno.env.get("INCIDENT_IO_SECURITY_API_KEY"),
  };
  const captures: Array<Record<string, unknown>> = [];
  const incidentPages: Array<{ headers: Headers; payload: Record<string, unknown> }> = [];
  const logs: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(input) === "https://incident.example/security") {
      incidentPages.push({ headers: new Headers(init?.headers), payload });
      return Promise.resolve(new Response("{}", { status: 202 }));
    }
    captures.push(payload);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  console.info = (value?: unknown) => logs.push(String(value));
  console.warn = (value?: unknown) => logs.push(String(value));
  Deno.env.set("ITX_POSTHOG_PROJECT_TOKEN", "project-token");
    Deno.env.set("ITX_POSTHOG_CAPTURE_ENDPOINT", "https://posthog.example/i/v0/e/");
  Deno.env.set("ITX_EDGE_PROXY_SHARED_SECRET", "test-shared-secret");
  Deno.env.set("ITX_OTEL_TRACE_SAMPLE_RATE", "0");
  Deno.env.set("INCIDENT_IO_SECURITY_WEBHOOK_URL", "https://incident.example/security");
  Deno.env.set("INCIDENT_IO_SECURITY_API_KEY", "incident-test-key");
  try {
    const request = new Request(
      "https://edge.itemtraxx.com/functions/admin-ops?search=%3Cscript%3E&token=raw-query-secret&workspace_id=workspace-secret",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.17",
          authorization: "Bearer eyJraw-jwt-value",
          "user-agent": "ItemTraxx test agent",
          "x-request-id": "request-security-1",
        },
        body: JSON.stringify({ search: "<script>alert(1)</script>", password: "raw-password", safe_field: "visible only by name" }),
      },
    );
    const response = await withSecurityLogging(
      request,
      "POST /functions/admin-ops",
      () => withRequestSpan(request, "POST /functions/admin-ops", async () =>
        new Response(JSON.stringify({ code: "invalid_input" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        })),
    );
    await flushEventExports();

    assert(response.status === 422, "handler response status must be preserved");
    const eventRecords = captures.flatMap((capture) =>
      (Array.isArray(capture.batch) ? capture.batch as Array<Record<string, unknown>> : [])
        .map((event) => ({
          event: event.event,
          properties: event.properties as Record<string, unknown>,
        }))
    );
    assert(eventRecords.some((record) => record.event === "edge_request"), "request event captured");
    assert(
      eventRecords.some((record) => record.event === "security_event" && record.properties.category === "validation_failure"),
      "validation failure emitted",
    );
    assert(
      eventRecords.some((record) => record.event === "security_event" && record.properties.category === "suspicious_payload"),
      "suspicious payload emitted even when the request is rejected",
    );
    const serialized = JSON.stringify({ captures, logs });
    assert(!serialized.includes("203.0.113.17"), "raw client IP must not be retained");
    assert(!serialized.includes("eyJraw-jwt-value"), "raw JWT must not be retained");
    assert(!serialized.includes("raw-password"), "raw password must not be retained");
    assert(!serialized.includes("raw-query-secret"), "secret query value must not be retained");
    assert(!serialized.includes("<script>alert(1)</script>"), "payload content must not be retained");
    const requestRecord = eventRecords.find((record) => record.event === "edge_request");
    assert(Boolean(requestRecord?.properties.client_ip_hash), "request includes keyed IP hash");
    assert(Boolean(requestRecord?.properties.session_hash), "request includes keyed session hash");
    assert(
      (requestRecord?.properties.query_keys as string[]).includes("search"),
      "safe query parameter names are captured",
    );
    assert(
      (requestRecord?.properties.rejected_fields as string[]).includes("safe_field"),
      "rejected payload field names are captured",
    );
    assert(requestRecord?.properties.error_code === "invalid_input", "response error code is captured");
    assert(
      (requestRecord?.properties.rejected_input_snippets as string[]).includes("<script"),
      "only the fixed suspicious signature is retained as a rejected-input snippet",
    );
    assert(
      captures.every((capture) => capture.token === "project-token" && Array.isArray(capture.batch)),
      "PostHog receives the batch capture payload",
    );
    assert(incidentPages.length === 1, "the active XSS signature pages immediately");
    const page = incidentPages[0];
    assert(page.headers.get("authorization") === "Bearer incident-test-key", "incident API key is sent as bearer auth");
    assert(page.headers.get("content-type") === "application/json", "incident payload is JSON");
    assert(page.payload.title === "[SECURITY CRITICAL] XSS on /functions/admin-ops", "incident title includes attack and route");
    assert(page.payload.deduplication_key === "itx-sec-xss-functions-admin-ops", "incident key is stable for the route");
    assert(page.payload.status === "firing" && page.payload.severity === "critical", "incident pages at critical severity");
    const pageMetadata = page.payload.metadata as Record<string, unknown>;
    assert(pageMetadata.attack_type === "xss", "incident carries its attack type");
    assert(pageMetadata.actor_id === "anon", "unresolved actors are labeled anon");
    assert(typeof pageMetadata.client_ip_hash === "string", "incident carries a keyed client IP");
    assert(!JSON.stringify(page.payload).includes("203.0.113.17"), "incident excludes the raw client IP");
    assert(!JSON.stringify(page.payload).includes("eyJraw-jwt-value"), "incident excludes the bearer token");
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.warn = originalWarn;
    for (const [name, value] of Object.entries({
      ITX_POSTHOG_PROJECT_TOKEN: previous.token,
      ITX_POSTHOG_CAPTURE_ENDPOINT: previous.capture,
      ITX_EDGE_PROXY_SHARED_SECRET: previous.ingressSecret,
      ITX_OTEL_TRACE_SAMPLE_RATE: previous.sampleRate,
      INCIDENT_IO_SECURITY_WEBHOOK_URL: previous.incidentUrl,
      INCIDENT_IO_SECURITY_API_KEY: previous.incidentKey,
    })) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("sampled request spans export OTLP with W3C correlation and resource identity", async () => {
  const originalFetch = globalThis.fetch;
  const previous = {
    token: Deno.env.get("ITX_POSTHOG_PROJECT_TOKEN"),
    endpoint: Deno.env.get("ITX_POSTHOG_TRACES_ENDPOINT"),
    service: Deno.env.get("ITX_OTEL_SERVICE_NAME"),
    environment: Deno.env.get("ITX_ENVIRONMENT"),
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  Deno.env.set("ITX_POSTHOG_PROJECT_TOKEN", "project-token");
  Deno.env.set("ITX_POSTHOG_TRACES_ENDPOINT", "https://posthog.example/i/v1/traces");
  Deno.env.set("ITX_OTEL_SERVICE_NAME", "itemtraxx-test-function");
  Deno.env.set("ITX_ENVIRONMENT", "test");
  try {
    const request = new Request("https://edge.itemtraxx.com/functions/admin-ops", {
      method: "POST",
      headers: {
        "x-request-id": "request-1",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    });
    const span = startRequestSpan(request, "POST /functions/admin-ops", "request-1");
    span.setStatus("ok").end();
    await flushTraceExports();

    assert(calls.length === 1, "expected one OTLP export");
    assert(calls[0].url === "https://posthog.example/i/v1/traces", "trace endpoint");
    assert(new Headers(calls[0].init?.headers).get("authorization") === "Bearer project-token", "trace auth header");
    const payload = JSON.parse(String(calls[0].init?.body)) as {
      resourceSpans?: Array<{
        resource?: { attributes?: Array<{ key: string; value: Record<string, unknown> }> };
        scopeSpans?: Array<{ spans?: Array<Record<string, unknown>> }>;
      }>;
    };
    const resourceAttributes = payload.resourceSpans?.[0]?.resource?.attributes ?? [];
    const spanRecord = payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
    assert(resourceAttributes.some((attribute) => attribute.key === "service.name"), "service resource attribute");
    assert(resourceAttributes.some((attribute) => attribute.key === "deployment.environment"), "environment resource attribute");
    assert(spanRecord?.traceId === "4bf92f3577b34da6a3ce929d0e0e4736", "continued trace id");
    assert(spanRecord?.parentSpanId === "00f067aa0ba902b7", "continued parent span id");

    const rootRequest = new Request("https://edge.itemtraxx.com/functions/admin-ops", {
      method: "POST",
      headers: {
        "x-request-id": "request-2",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "x-itx-trace-parent-exported": "false",
      },
    });
    const rootSpan = startRequestSpan(rootRequest, "POST /functions/admin-ops", "request-2");
    rootSpan.setStatus("ok").end();
    await flushTraceExports();

    assert(calls.length === 2, "expected one export per sampled span");
    const rootPayload = JSON.parse(String(calls[1].init?.body)) as {
      resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: Array<Record<string, unknown>> }> }>;
    };
    const rootSpanRecord = rootPayload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
    assert(rootSpanRecord?.traceId === "4bf92f3577b34da6a3ce929d0e0e4736", "root span keeps trace id");
    assert(rootSpanRecord?.parentSpanId === undefined, "unexported Worker parent is omitted");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries({
      ITX_POSTHOG_PROJECT_TOKEN: previous.token,
      ITX_POSTHOG_TRACES_ENDPOINT: previous.endpoint,
      ITX_OTEL_SERVICE_NAME: previous.service,
      ITX_ENVIRONMENT: previous.environment,
    })) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
