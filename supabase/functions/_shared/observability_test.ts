import {
  flushTraceExports,
  logError,
  logInfo,
  startRequestSpan,
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
    parsedError.message === "failure\nforged",
    "error message should round-trip through JSON",
  );
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
