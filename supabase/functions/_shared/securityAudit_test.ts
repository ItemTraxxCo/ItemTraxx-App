import {
  emitIncidentIoSecurityPage,
  flushEventExports,
} from "./observability.ts";
import {
  classifySecurityAuditTargets,
  writeSecurityAuditEntries,
} from "./securityAudit.ts";

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

Deno.test("audit evidence separates requested IDs from unauthorized returned IDs", () => {
  const ownId = "00000000-0000-4000-8000-000000000001";
  const requestedForeignId = "00000000-0000-4000-8000-000000000002";
  const returnedForeignId = "00000000-0000-4000-8000-000000000003";
  const returnedUnverifiedId = "00000000-0000-4000-8000-000000000004";
  const returnedMissingId = "00000000-0000-4000-8000-000000000005";
  const result = classifySecurityAuditTargets(
    [ownId, requestedForeignId, returnedForeignId, returnedUnverifiedId, returnedMissingId],
    [ownId, returnedForeignId, returnedUnverifiedId, returnedMissingId],
    new Set([ownId]),
    "workspace-a",
    new Map([
      [ownId, "workspace-a"],
      [returnedForeignId, "workspace-b"],
      [returnedUnverifiedId, "workspace-a"],
    ]),
  );
  assert(
    JSON.stringify(result.deniedTargetIds) ===
      JSON.stringify([requestedForeignId, returnedForeignId, returnedUnverifiedId, returnedMissingId]),
    "both non-visible IDs are retained for denied-target auditing",
  );
  assert(
    JSON.stringify(result.confirmedUnauthorizedTargetIds) ===
      JSON.stringify([returnedForeignId]),
    "confirmation requires a returned ID with a verified different workspace",
  );
});

Deno.test("security audit writes emit hashed audit events and the enumeration tripwire", async () => {
  const originalFetch = globalThis.fetch;
  const previous = {
    token: Deno.env.get("ITX_POSTHOG_PROJECT_TOKEN"),
    capture: Deno.env.get("ITX_POSTHOG_CAPTURE_ENDPOINT"),
    secret: Deno.env.get("ITX_EDGE_PROXY_SHARED_SECRET"),
    incidentUrl: Deno.env.get("INCIDENT_IO_SECURITY_WEBHOOK_URL"),
    incidentKey: Deno.env.get("INCIDENT_IO_SECURITY_API_KEY"),
  };
  const captures: Array<Record<string, unknown>> = [];
  const incidentPages: Array<{ headers: Headers; payload: Record<string, unknown> }> = [];
  let rpcCalled = false;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(_input) === "https://incident.example/security") {
      incidentPages.push({ headers: new Headers(init?.headers), payload });
    } else {
      captures.push(payload);
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  Deno.env.set("ITX_POSTHOG_PROJECT_TOKEN", "project-token");
  Deno.env.set("ITX_POSTHOG_CAPTURE_ENDPOINT", "https://posthog.example/i/v0/e/");
  Deno.env.set("ITX_EDGE_PROXY_SHARED_SECRET", "audit-test-secret");
  Deno.env.set("INCIDENT_IO_SECURITY_WEBHOOK_URL", "https://incident.example/security");
  Deno.env.set("INCIDENT_IO_SECURITY_API_KEY", "incident-audit-test-key");
  try {
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        rpcCalled = name === "append_security_audit_entries" &&
          Array.isArray(args?.p_entries) && args?.p_entries.length === 16;
        return {
          data: [{ enumeration_tripwire: true, distinct_target_count: 16 }],
          error: null,
        };
      },
      from: () => {
        throw new Error("RPC path should be used for production audit writes");
      },
    };
    const rows = Array.from({ length: 16 }, (_, index) => ({
      actor_id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "00000000-0000-4000-8000-000000000002",
      action: "read_target",
      target_type: "item",
      target_resource_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      route: "/rest/v1/items",
      method: "GET",
      request_id: "audit-request-1",
    }));
    const request = new Request("https://edge.itemtraxx.com/functions/security-audit", {
      headers: { "cf-connecting-ip": "203.0.113.101" },
    });
    const written = await writeSecurityAuditEntries(client, rows, { request });
    await flushEventExports();

    assert(rpcCalled, "the append RPC receives a bounded batch");
    assert(written, "the audit batch is persisted");
    const securityEvent = captures.flatMap((capture) =>
      (Array.isArray(capture.batch) ? capture.batch as Array<Record<string, unknown>> : [])
        .map((event) => ({
          event: event.event,
          properties: event.properties as Record<string, unknown>,
        }))
    ).find((capture) => capture.event === "security_event");
    assert(securityEvent, "an enumeration security event is emitted");
    assert(securityEvent.properties.category === "enumeration_tripwire", "enumeration category");
    assert(securityEvent.properties.distinct_target_count === 16, "distinct target count");
    assert(incidentPages.length === 1, "tripwire dispatches a direct incident page");
    const incidentPage = incidentPages[0];
    assert(incidentPage.headers.get("authorization") === "Bearer incident-audit-test-key", "incident API key is sent as bearer auth");
    assert(incidentPage.payload.title === "[SECURITY CRITICAL] IDOR enumeration on /rest/v1/items", "incident title includes the tripwire and route");
    assert(incidentPage.payload.deduplication_key === "itx-sec-idor_enumeration-rest-v1-items", "tripwire uses a stable deduplication key");
    assert(incidentPage.payload.severity === "critical", "tripwire page is critical");
    const incidentMetadata = incidentPage.payload.metadata as Record<string, unknown>;
    assert(incidentMetadata.attack_type === "idor_enumeration", "tripwire attack type");
    assert(incidentMetadata.exploitation_status === "UNDETERMINED", "high-volume read alert does not infer malicious intent");
    assert(incidentMetadata.outcome === "UNKNOWN", "high-volume read alert keeps its outcome unknown");
    assert(incidentMetadata.http_status === "unknown", "missing status is explicit");
    assert(incidentMetadata.request_id === "audit-request-1", "incident includes the correlated request ID");
    assert(typeof incidentPage.payload.description === "string" &&
      incidentPage.payload.description.includes("Security Outcome: UNKNOWN"),
      "classification is visible in the incident description");
    assert(typeof incidentMetadata.client_ip_hash === "string", "tripwire IP is keyed");
    assert(typeof incidentMetadata.actor_id === "string" && incidentMetadata.actor_id !== "anon", "tripwire actor is keyed");
    assert(!JSON.stringify(incidentPage.payload).includes("203.0.113.101"), "raw IP is not in the incident payload");
    const serialized = JSON.stringify(captures);
    assert(!serialized.includes("00000000-0000-4000-8000-000000000001"), "actor id is hashed before PostHog");
    assert(!serialized.includes("00000000-0000-4000-8000-000000000002"), "workspace id is hashed before PostHog");

    const tenantProbe = {
      attackType: "rls_tenant_breach" as const,
      actorId: "00000000-0000-4000-8000-000000000006",
      requestId: "audit-request-2",
      route: "/rest/v1/items",
      httpStatus: 200,
      evidence: "cross_workspace_target_requested" as const,
      request: new Request("https://edge.itemtraxx.com/rest/v1/items", {
        headers: { "cf-connecting-ip": "203.0.113.102" },
      }),
    };
    emitIncidentIoSecurityPage(tenantProbe);
    emitIncidentIoSecurityPage({
      ...tenantProbe,
      evidence: "cross_workspace_resource_returned",
      confirmedBy: "cross_workspace_item_in_upstream_response",
    });
    await flushEventExports();

    const tenantAttempt = incidentPages.find((page) =>
      (page.payload.metadata as Record<string, unknown>).outcome === "ATTEMPT DETECTED"
    );
    const tenantConfirmed = incidentPages.find((page) =>
      (page.payload.metadata as Record<string, unknown>).outcome === "CONFIRMED UNAUTHORIZED ACCESS"
    );
    assert(tenantAttempt && tenantConfirmed, "tenant attempt and confirmation pages are present");
    assert(tenantAttempt.payload.metadata && tenantConfirmed.payload.metadata, "tenant incident metadata is present");
    const attemptMetadata = tenantAttempt.payload.metadata as Record<string, unknown>;
    const confirmedMetadata = tenantConfirmed.payload.metadata as Record<string, unknown>;
    assert(attemptMetadata.outcome === "ATTEMPT DETECTED", "a queried foreign target is not a successful breach");
    assert(attemptMetadata.http_status === 200, "attempt page records the original response status");
    assert(confirmedMetadata.outcome === "CONFIRMED UNAUTHORIZED ACCESS", "only returned foreign resources confirm unauthorized access");
    assert(confirmedMetadata.request_id === tenantProbe.requestId, "confirmed page retains the original request ID");
    assert(typeof tenantConfirmed.payload.description === "string" &&
      tenantConfirmed.payload.description.includes("CONFIRMED UNAUTHORIZED ACCESS"),
      "confirmed classification is visible in the description");
    assert(
      tenantAttempt.payload.deduplication_key === tenantConfirmed.payload.deduplication_key,
      "later classification updates retain the same deduplication key",
    );
    assert(!JSON.stringify(tenantConfirmed.payload).includes("203.0.113.102"), "tenant page contains no raw IP");
    assert(!JSON.stringify(tenantConfirmed.payload).includes("00000000-0000-4000-8000-000000006"), "tenant page contains no raw actor ID");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries({
      ITX_POSTHOG_PROJECT_TOKEN: previous.token,
      ITX_POSTHOG_CAPTURE_ENDPOINT: previous.capture,
      ITX_EDGE_PROXY_SHARED_SECRET: previous.secret,
      INCIDENT_IO_SECURITY_WEBHOOK_URL: previous.incidentUrl,
      INCIDENT_IO_SECURITY_API_KEY: previous.incidentKey,
    })) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
