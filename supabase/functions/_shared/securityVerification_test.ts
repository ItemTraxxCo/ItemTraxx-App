import { flushEventExports, withSecurityLogging } from "./observability.ts";
import { enforcePublicRequestLimit } from "../../../cloudflare/edge-proxy/src/publicRequestRateLimit.ts";
import { withWorkerRequestTelemetry } from "../../../cloudflare/edge-proxy/src/observability.ts";
import worker from "../../../cloudflare/edge-proxy/src/index.ts";

type CapturedEvent = {
  event: string;
  properties: Record<string, unknown>;
};

type IncidentPayload = Record<string, unknown> & {
  metadata: Record<string, unknown>;
};

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

const eventRequestId = (event: CapturedEvent) =>
  String(event.properties.request_id ?? "");

const uniqueEvents = (events: CapturedEvent[]) => {
  const unique = new Map<string, CapturedEvent>();
  for (const event of events) {
    const key = `${event.event}:${eventRequestId(event)}:${
      String(event.properties.category ?? "")
    }`;
    if (!unique.has(key)) unique.set(key, event);
  }
  return [...unique.values()];
};

Deno.test("security verification exercises edge rejection, incident paging, auth threshold, and rate limit offline", async () => {
  const previousEnv = new Map<string, string | undefined>();
  const envNames = [
    "ITX_ENVIRONMENT",
    "ITX_POSTHOG_PROJECT_TOKEN",
    "ITX_POSTHOG_CAPTURE_ENDPOINT",
    "ITX_EDGE_PROXY_SHARED_SECRET",
    "ITX_OTEL_TRACE_SAMPLE_RATE",
    "INCIDENT_IO_SECURITY_WEBHOOK_URL",
    "INCIDENT_IO_SECURITY_API_KEY",
  ];
  for (const name of envNames) previousEnv.set(name, Deno.env.get(name));

  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const events: CapturedEvent[] = [];
  const incidentPosts: IncidentPayload[] = [];
  const pendingWorkerTasks: Promise<unknown>[] = [];
  const logs: string[] = [];

  const posthogEndpoint = "https://posthog.test/i/v0/e/";
  const incidentEndpoint = "https://incident.test/alerts";
  for (
    const [name, value] of Object.entries({
      ITX_ENVIRONMENT: "test",
      ITX_POSTHOG_PROJECT_TOKEN: "phc_security_verification_test",
      ITX_POSTHOG_CAPTURE_ENDPOINT: posthogEndpoint,
      ITX_EDGE_PROXY_SHARED_SECRET: "security-verification-test-secret",
      ITX_OTEL_TRACE_SAMPLE_RATE: "0",
      INCIDENT_IO_SECURITY_WEBHOOK_URL: incidentEndpoint,
      INCIDENT_IO_SECURITY_API_KEY: "incident-verification-test-key",
    })
  ) {
    Deno.env.set(name, value);
  }

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    if (url === incidentEndpoint) {
      incidentPosts.push(body as IncidentPayload);
      return Promise.resolve(new Response("accepted", { status: 202 }));
    }
    if (url.startsWith("https://posthog.test/")) {
      const batch = Array.isArray(body.batch)
        ? body.batch as Array<Record<string, unknown>>
        : [body];
      for (const record of batch) {
        if (typeof record.event !== "string") continue;
        const properties = record.properties;
        if (!properties || typeof properties !== "object") continue;
        events.push({
          event: record.event,
          properties: properties as Record<string, unknown>,
        });
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    }
    return Promise.reject(new Error(`Unexpected network target: ${url}`));
  }) as typeof fetch;
  console.info = (value?: unknown) => logs.push(String(value));
  console.warn = (value?: unknown) => logs.push(String(value));
  console.error = (value?: unknown) => logs.push(String(value));

  const workerEnv = {
    ITX_ENVIRONMENT: "test",
    ITX_POSTHOG_PROJECT_TOKEN: "phc_security_verification_test",
    ITX_POSTHOG_CAPTURE_ENDPOINT: posthogEndpoint,
    ITX_EDGE_PROXY_SHARED_SECRET: "security-verification-test-secret",
    ITX_OTEL_TRACE_SAMPLE_RATE: "0",
    INCIDENT_IO_SECURITY_WEBHOOK_URL: incidentEndpoint,
    INCIDENT_IO_SECURITY_API_KEY: "incident-verification-test-key",
  };
  const executionContext = {
    waitUntil(promise: Promise<unknown>) {
      pendingWorkerTasks.push(promise);
    },
  };

  try {
    const invalidInput = new Request(
      "https://edge.test/functions/admin-ops?search=%3Cscript%3E",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "198.51.100.15",
          "x-test-simulation": "true",
          "x-request-id": "00000000-0000-4000-8000-000000000001",
          authorization: "Bearer eyJsynthetic.invalid.signature",
          "user-agent": "ItemTraxx security verification test",
        },
        body: JSON.stringify({
          query: "<script>synthetic-payload</script>",
          password: "synthetic-password",
        }),
      },
    );
    const invalidResponse = await withSecurityLogging(
      invalidInput,
      "POST /functions/admin-ops",
      async () =>
        new Response(JSON.stringify({ code: "invalid_input" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    );
    await flushEventExports();

    assert(
      invalidResponse.status === 422,
      "invalid input is rejected with 422",
    );
    const invalidEvents = uniqueEvents(events).filter((event) =>
      eventRequestId(event) === "00000000-0000-4000-8000-000000000001"
    );
    const invalidRequestEvent = invalidEvents.find((event) =>
      event.event === "edge_request"
    );
    const invalidSecurityEvents = invalidEvents.filter((event) =>
      event.event === "security_event"
    );
    assert(invalidRequestEvent, "invalid request completion is captured");
    assert(
      invalidSecurityEvents.some((event) =>
        event.properties.category === "validation_failure"
      ),
      "validation failure produces a security_event",
    );
    assert(
      invalidSecurityEvents.some((event) =>
        event.properties.category === "suspicious_payload"
      ),
      "XSS signature produces a suspicious_payload security_event",
    );
    assert(
      invalidRequestEvent.properties.attack_type === "simulation",
      "test-only simulation metadata is present",
    );
    assert(
      invalidRequestEvent.properties.route === "/functions/admin-ops",
      "event includes the normalized route",
    );
    assert(
      typeof invalidRequestEvent.properties.client_ip_hash === "string" &&
        invalidRequestEvent.properties.client_ip_hash.length === 64,
      "event includes a keyed client IP hash",
    );
    assert(
      incidentPosts.length === 1,
      "critical XSS dispatches one incident page",
    );
    assert(incidentPosts[0].status === "firing", "incident page is firing");
    assert(incidentPosts[0].severity === "critical", "incident is critical");
    assert(
      incidentPosts[0].metadata.attack_type === "xss",
      "incident carries the detected XSS type",
    );
    assert(
      incidentPosts[0].metadata.request_id === invalidRequestEvent.properties.request_id,
      "incident carries the request ID used by PostHog events",
    );
    assert(incidentPosts[0].metadata.http_status === 422, "incident carries the observed response status");
    assert(incidentPosts[0].metadata.exploitation_status === "ATTEMPTED EXPLOITATION", "rejected input is classified as an attempt");
    assert(incidentPosts[0].metadata.outcome === "BLOCKED", "validation rejection is classified as blocked at this layer");
    assert(
      incidentPosts[0].metadata.route === "/functions/admin-ops",
      "incident carries the route",
    );
    assert(
      typeof incidentPosts[0].description === "string" &&
        incidentPosts[0].description.includes("Security Outcome: BLOCKED"),
      "the classification is visible in the incident description",
    );
    assert(
      typeof incidentPosts[0].metadata.client_ip_hash === "string",
      "incident carries a keyed client IP hash",
    );

    const authRequestIds = Array.from(
      { length: 11 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    );
    for (const requestId of authRequestIds) {
      const request = new Request("https://edge.test/rpc/consume_rate_limit", {
        headers: {
          "cf-connecting-ip": "198.51.100.25",
          "x-test-simulation": "true",
          "x-request-id": requestId,
        },
      });
      const response = await worker.fetch(
        request,
        {
          ...workerEnv,
          SUPABASE_URL: "https://supabase.test",
          SUPABASE_ANON_KEY: "verification-anon-key",
        } as never,
        executionContext as never,
      );
      assert(
        response.status === 401,
        "unauthenticated RPC is rejected with 401",
      );
    }

    const invalidTokenRequestId = "00000000-0000-4000-8000-000000000009";
    const invalidTokenResponse = await worker.fetch(
      new Request("https://edge.test/rpc/consume_rate_limit", {
        headers: {
          "cf-connecting-ip": "198.51.100.24",
          authorization: "Bearer eyJsynthetic.invalid.signature",
          "x-test-simulation": "true",
          "x-request-id": invalidTokenRequestId,
        },
      }),
      {
        ...workerEnv,
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_ANON_KEY: "verification-anon-key",
      } as never,
      executionContext as never,
    );
    assert(
      invalidTokenResponse.status === 401,
      "invalid token is rejected with 401",
    );
    const invalidTokenEvent = uniqueEvents(events).find((event) =>
      event.event === "security_event" &&
      eventRequestId(event) === invalidTokenRequestId
    );
    assert(invalidTokenEvent, "invalid token rejection emits a security_event");
    assert(
      invalidTokenEvent.properties.category === "auth_forbidden",
      "invalid token rejection uses auth_forbidden category",
    );
    assert(
      invalidTokenEvent.properties.attack_type === "simulation",
      "invalid token event carries simulation metadata in test environment",
    );

    const limiterCount = new Map<string, number>();
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        const count = (limiterCount.get(key) ?? 0) + 1;
        limiterCount.set(key, count);
        return { success: count <= 3 };
      },
    };
    const burstStatuses: number[] = [];
    const burstRequestIds = Array.from(
      { length: 4 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 30).padStart(12, "0")}`,
    );
    for (const requestId of burstRequestIds) {
      const request = new Request("https://edge.test/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "198.51.100.35",
          "x-test-simulation": "true",
          "x-request-id": requestId,
        },
        body: JSON.stringify({ email: "synthetic@example.invalid" }),
      });
      const response = await withWorkerRequestTelemetry(
        request,
        workerEnv as never,
        executionContext as never,
        async () => {
          const admission = await enforcePublicRequestLimit(
            limiter,
            request,
            "security-verification",
          );
          return admission.allowed
            ? new Response("accepted", { status: 200 })
            : new Response(JSON.stringify({ code: "rate_limited" }), {
              status: 429,
              headers: { "content-type": "application/json" },
            });
        },
      );
      burstStatuses.push(response.status);
    }
    await Promise.all(pendingWorkerTasks);
    pendingWorkerTasks.length = 0;

    assert(
      JSON.stringify(burstStatuses) === JSON.stringify([200, 200, 200, 429]),
      "controlled burst is admitted through three requests and then rate limited",
    );

    const workerRateLimitRequestId = "00000000-0000-4000-8000-000000000098";
    const workerRateLimitResponse = await worker.fetch(
      new Request("https://edge.test/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "198.51.100.36",
          "x-test-simulation": "true",
          "x-request-id": workerRateLimitRequestId,
        },
        body: JSON.stringify({ email: "synthetic@example.invalid" }),
      }),
      {
        ...workerEnv,
        PUBLIC_AUTH_RATE_LIMITER: {
          limit: async () => ({ success: false }),
        },
      } as never,
      executionContext as never,
    );
    assert(
      workerRateLimitResponse.status === 429,
      "actual Worker auth route responds 429 when its limiter denies",
    );

    const deduplicatedEvents = uniqueEvents(events);
    const authClientIpHash = deduplicatedEvents.find((event) =>
      event.event === "edge_request" &&
      eventRequestId(event) === authRequestIds[0]
    )?.properties.client_ip_hash;
    assert(
      typeof authClientIpHash === "string",
      "auth requests share a hashed client address",
    );
    const authSecurityEvents = deduplicatedEvents.filter((event) =>
      event.event === "security_event" &&
      event.properties.category === "auth_forbidden" &&
      event.properties.client_ip_hash === authClientIpHash
    );
    assert(
      authSecurityEvents.length === 11,
      "all 11 auth failures produce deduplicable security events",
    );
    assert(
      authSecurityEvents.every((event) =>
        event.properties.attack_type === "simulation"
      ),
      "auth simulation events carry the test marker",
    );
    const authRequestEvents = deduplicatedEvents.filter((event) =>
      event.event === "edge_request" &&
      [401, 403].includes(Number(event.properties.status)) &&
      event.properties.client_ip_hash === authClientIpHash
    );
    assert(
      authRequestEvents.length === 11 &&
        new Set(authRequestEvents.map(eventRequestId)).size === 11,
      "the alert input contains 11 distinct denied request IDs for one IP",
    );

    const rateLimitedEvent = deduplicatedEvents.find((event) =>
      event.event === "edge_request" &&
      eventRequestId(event) === burstRequestIds[3]
    );
    assert(rateLimitedEvent, "rate-limited request reaches the telemetry sink");
    assert(
      rateLimitedEvent.properties.status === 429,
      "rate-limit telemetry records 429",
    );
    assert(
      rateLimitedEvent.properties.attack_type === "simulation",
      "rate-limit telemetry is marked as synthetic in test environment",
    );
    const actualRateLimitedEvent = deduplicatedEvents.find((event) =>
      event.event === "edge_request" &&
      eventRequestId(event) === workerRateLimitRequestId
    );
    assert(
      actualRateLimitedEvent,
      "actual Worker route emits request telemetry",
    );
    assert(
      actualRateLimitedEvent.properties.status === 429,
      "actual Worker telemetry records 429",
    );
    assert(
      actualRateLimitedEvent.properties.route === "/api/auth/sign-in/email",
      "actual Worker telemetry records the limited route",
    );

    const alertConfig = JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../docs/security/posthog-security-alerts.json",
          import.meta.url,
        ),
      ),
    ) as {
      alerts: Array<{
        name: string;
        query: string;
        alert: {
          operator: string;
          threshold: number;
          query_window_seconds: number;
        };
      }>;
    };
    const authRule = alertConfig.alerts.find((rule) =>
      rule.name === "ItemTraxx authentication failures by IP or session"
    );
    assert(authRule, "PostHog auth anomaly rule exists");
    assert(
      authRule.alert.operator === ">",
      "auth rule uses a strict greater-than threshold",
    );
    assert(authRule.alert.threshold === 10, "auth rule threshold is 10 events");
    assert(
      authRule.alert.query_window_seconds === 120,
      "auth rule uses a two-minute window",
    );
    assert(
      authRule.query.includes("uniqExact(request_id)") &&
        authRule.query.includes("event = 'edge_request'") &&
        authRule.query.includes("properties.client_ip_hash") &&
        authRule.query.includes("401, 403"),
      "auth rule groups unique denied requests by hashed client address",
    );
    const wouldFirePostHogAlert =
      authRequestEvents.length > authRule.alert.threshold;
    assert(
      wouldFirePostHogAlert,
      "the captured 11th auth failure crosses the configured alert threshold",
    );

    const productionRequestId = "00000000-0000-4000-8000-000000000099";
    const productionRequest = new Request(
      "https://edge.test/rest/v1/items",
      {
        headers: {
          "cf-connecting-ip": "198.51.100.99",
          "x-test-simulation": "true",
          "x-request-id": productionRequestId,
        },
      },
    );
    const productionResponse = await withWorkerRequestTelemetry(
      productionRequest,
      { ...workerEnv, ITX_ENVIRONMENT: "production" } as never,
      executionContext as never,
      async () =>
        new Response(JSON.stringify({ code: "forbidden" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    );
    await Promise.all(pendingWorkerTasks);
    assert(productionResponse.status === 403, "production still enforces auth");
    const productionSecurityEvent = uniqueEvents(events).find((event) =>
      event.event === "security_event" &&
      eventRequestId(event) === productionRequestId
    );
    assert(productionSecurityEvent, "production denial is still logged");
    assert(
      productionSecurityEvent.properties.attack_type !== "simulation",
      "production ignores the client-supplied test marker",
    );

    const serialized = JSON.stringify({ events, incidentPosts, logs });
    for (
      const secret of [
        "198.51.100.15",
        "198.51.100.25",
        "198.51.100.35",
        "eyJsynthetic.invalid.signature",
        "synthetic-password",
        "synthetic-payload",
      ]
    ) {
      assert(
        !serialized.includes(secret),
        `telemetry must not contain ${secret}`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    for (const [name, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
