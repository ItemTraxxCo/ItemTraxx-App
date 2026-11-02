import {
  TRACE_PARENT_EXPORTED_HEADER,
  TRACE_PARENT_EXPORTED_VALUE,
} from "./requestHeaders.ts";
import {
  classifyIncidentOutcome,
  type IncidentEvidence,
  type SecurityIncidentAttackType,
} from "../../../supabase/functions/_shared/incidentOutcome.ts";

/** Structured Worker telemetry and W3C trace propagation.
 *
 * Cloudflare Workers Observability forwards JSON console records to the
 * existing log bridge. The Worker also sends privacy-safe request/security
 * events to PostHog so saved insight alerts can query the `events` table.
 */

export type WorkerTraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: string;
  tracestate?: string;
  sampled: boolean;
  traceparent: string;
};

export type WorkerTelemetryHandler = (context: {
  requestId: string;
  trace: WorkerTraceContext;
  tracedRequest: Request;
}) => Promise<Response>;

const DEFAULT_SAMPLE_RATE = 0.1;
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const SAFE_REQUEST_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|itx-\d{8,}-\d{1,})$/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_PATTERN = /\b(?:eyJ[a-z0-9_-]{10,}|[a-z0-9_-]{24,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,})\b/gi;
const QUERY_SECRET_PATTERN = /\b(access_token|refresh_token|id_token|token|secret|signature|code)=([^&#\s]+)/gi;
const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|email|phone|body|headers|payload|borrower|user|profile|tenant_name|workspace_name|account_name|account_label|page_url|storage_path|filename|lead_id|support_request_id|workspace_id|account_id|user_id|report_id)/i;
const ROUTE_ID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const DEFAULT_CAPTURE_ENDPOINT = "https://us.i.posthog.com/i/v0/e/";
const SUSPICIOUS_QUERY_MARKERS: Array<[string, RegExp, string]> = [
  ["xss", /<\s*script\b/i, "<script"],
  ["xss", /javascript\s*:/i, "javascript:"],
  ["sql_injection", /\bunion\s+(?:all\s+)?select\b/i, "union-select"],
  ["sql_injection", /\b(?:sleep|benchmark)\s*\(/i, "sql-time-function"],
  ["path_traversal", /(?:\.\.\/|\.\.\\|%2e%2e%2f)/i, "../"],
  ["prototype_pollution", /(?:__proto__|prototype\s*\[|constructor\s*\[)/i, "prototype-property"],
];

const incidentAttackLabel = (attackType: SecurityIncidentAttackType) => ({
  sqli: "SQLi",
  xss: "XSS",
  rls_tenant_breach: "RLS/tenant breach attempt",
  idor_enumeration: "IDOR enumeration",
}[attackType]);

const incidentRouteSlug = (route: string) =>
  route.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 80) || "root";

export const dispatchIncidentIoSecurityPage = (
  env: Env,
  request: Request,
  requestId: string,
  attackType: SecurityIncidentAttackType,
  ctx?: Pick<ExecutionContext, "waitUntil">,
  httpStatus?: number,
  evidence: IncidentEvidence = "unknown",
  alertStatus: "firing" | "resolved" = "firing",
) => {
  const endpoint = env.INCIDENT_IO_SECURITY_WEBHOOK_URL?.trim() ?? "";
  const apiKey = env.INCIDENT_IO_SECURITY_API_KEY?.trim() ?? "";
  if (!endpoint || !apiKey) return;

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
    if (
      parsedEndpoint.protocol !== "https:" || parsedEndpoint.username ||
      parsedEndpoint.password
    ) return;
  } catch {
    return;
  }

  const pagePromise = (async () => {
    const metadata = await requestPrivacyMetadata(env, request);
    const route = metadata.route;
    const validHttpStatus = Number.isInteger(httpStatus) && httpStatus! >= 100 &&
        httpStatus! <= 599
      ? httpStatus
      : undefined;
    const httpStatusValue = validHttpStatus ?? "unknown";
    const classification = classifyIncidentOutcome(attackType, {
      ...(validHttpStatus !== undefined ? { httpStatus: validHttpStatus } : {}),
    });
    const safeRequestId = SAFE_REQUEST_ID_RE.test(requestId)
      ? requestId
      : "unknown";
    const displayEvidence = evidence;
    const payload = {
      title: "[SECURITY CRITICAL] " + incidentAttackLabel(attackType) + " on " + route,
      description: [
        `Exploitation Status: ${classification.exploitationStatus}`,
        `Security Outcome: ${classification.securityOutcome}`,
        `HTTP Status: ${httpStatusValue}`,
        `Request ID: ${safeRequestId}`,
        `Route: ${route}`,
        `Attack Type: ${incidentAttackLabel(attackType)}`,
        `Evidence: ${displayEvidence}`,
        `Assessment: ${classification.explanation}`,
      ].join("\n"),
      deduplication_key: "itx-sec-" + attackType + "-" + incidentRouteSlug(route),
      status: alertStatus,
      severity: "critical",
      metadata: {
        attack_type: attackType,
        exploitation_status: classification.exploitationStatus,
        outcome: classification.securityOutcome,
        request_id: safeRequestId,
        http_status: httpStatusValue,
        evidence: displayEvidence,
        route,
        client_ip_hash: metadata.client_ip_hash ?? "unknown",
        actor_id: "anon",
      },
    };
    try {
      const response = await fetch(parsedEndpoint.toString(), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        console.error(JSON.stringify({
          event: "incident_io.security_page_failed",
          request_id: requestId,
          error_code: "webhook_rejected",
          status: response.status,
          service: "itemtraxx-edge-proxy",
        }));
      }
    } catch {
      console.error(JSON.stringify({
        event: "incident_io.security_page_failed",
        request_id: requestId,
        error_code: "webhook_unavailable",
        service: "itemtraxx-edge-proxy",
      }));
    }
  })().catch(() => undefined);

  if (ctx) ctx.waitUntil(pagePromise);
  else void pagePromise;
};

type RequestBodySummary = {
  fields: string[];
  markers: string[];
  snippets: string[];
};

const EMPTY_REQUEST_BODY_SUMMARY: RequestBodySummary = {
  fields: [],
  markers: [],
  snippets: [],
};

const normalizeRoute = (pathname: string) =>
  pathname.split("/").map((segment) =>
    ROUTE_ID_SEGMENT.test(segment) || /^\d{4,}$/.test(segment) ? ":id" : segment
  ).map((segment) => safeText(segment, 64)).join("/").slice(0, 256);

const safeText = (value: string, maxLength = 512) =>
  value
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(TOKEN_PATTERN, "[REDACTED_TOKEN]")
    .replace(QUERY_SECRET_PATTERN, "$1=[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, maxLength);

const safeExtra = (extra: Record<string, unknown>) => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string") output[key] = safeText(value, 256);
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean") output[key] = value;
    else if (Array.isArray(value)) {
      const safeItems: Array<string | number | boolean> = [];
      for (const item of value.slice(0, 32)) {
        if (typeof item === "string") safeItems.push(safeText(item, 64));
        else if (typeof item === "number" && Number.isFinite(item)) safeItems.push(item);
        else if (typeof item === "boolean") safeItems.push(item);
      }
      output[key] = safeItems;
    }
    if (Object.keys(output).length >= 48) break;
  }
  return output;
};

const serialize = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ event: "worker_observability.serialization_failed" });
  }
};

const envSampleRate = (env: Env) => {
  const configured = Number(env.ITX_OTEL_TRACE_SAMPLE_RATE);
  if (!Number.isFinite(configured)) return DEFAULT_SAMPLE_RATE;
  return Math.min(1, Math.max(0, configured));
};

const randomHex = (bytes: number) => {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
};

const hmacHex = async (value: string, secret: string) => {
  if (!value || !secret) return undefined;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
};

const requestPrivacyMetadata = async (env: Env, request: Request) => {
  const url = new URL(request.url);
  const route = normalizeRoute(url.pathname);
  const isTestSimulation = (env.ITX_ENVIRONMENT ?? "").trim().toLowerCase() ===
      "test" &&
    request.headers.get("x-test-simulation")?.trim().toLowerCase() === "true";
  const queryKeys: string[] = [];
  const queryValueLengths: Record<string, number> = {};
  for (const [rawKey, value] of url.searchParams) {
    if (queryKeys.length >= 32) break;
    const key = rawKey.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
    if (!key || key.toLowerCase() === "itx_request_id" || SENSITIVE_KEY.test(key)) continue;
    if (!queryKeys.includes(key)) queryKeys.push(key);
    queryValueLengths[key] = Math.max(queryValueLengths[key] ?? 0, Math.min(value.length, 4096));
  }
  const authorization = request.headers.get("authorization")?.trim();
  const credential = authorization || request.headers.get("cookie")?.slice(0, 4096) || "";
  const clientIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const secret = env.ITX_EDGE_PROXY_SHARED_SECRET?.trim() ?? "";
  return {
    route,
    method: request.method.toUpperCase().slice(0, 16),
    ...(isTestSimulation ? { attack_type: "simulation" } : {}),
    query_keys: queryKeys,
    query_value_lengths: queryValueLengths,
    ...(request.headers.get("user-agent")
      ? { user_agent: safeText(request.headers.get("user-agent") ?? "", 256) }
      : {}),
    ...(clientIp && secret ? { client_ip_hash: await hmacHex(clientIp, secret) } : {}),
    ...(credential && secret ? { session_hash: await hmacHex(credential, secret) } : {}),
  };
};

const suspiciousTextSummary = (value: string) => {
  const matches = SUSPICIOUS_QUERY_MARKERS.filter(([, pattern]) => pattern.test(value));
  return {
    markers: [...new Set(matches.map(([marker]) => marker))],
    snippets: [...new Set(matches.map(([, , snippet]) => snippet))],
  };
};

const suspiciousQuerySummary = (request: Request) =>
  suspiciousTextSummary(Array.from(new URL(request.url).searchParams.values()).join("\n"));

const summarizeBodyText = (body: string): RequestBodySummary => {
  let fields: string[] = [];
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      fields = Object.keys(parsed)
        .filter((key) => !SENSITIVE_KEY.test(key))
        .map((key) => key.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 48))
        .slice(0, 32);
    }
  } catch {
    // Form and plain text bodies are never retained or parsed into fields.
  }
  const suspicious = suspiciousTextSummary(body);
  return { fields, ...suspicious };
};

const captureWorkerRequestBody = (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    request.method === "GET" || request.method === "HEAD" || !request.body ||
    !/^(?:application\/json|application\/[^;]+\+json|application\/x-www-form-urlencoded|text\/plain)(?:\s*;|$)/i.test(contentType)
  ) {
    return {
      request,
      summarize: async () => EMPTY_REQUEST_BODY_SUMMARY,
    };
  }

  let sourceReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const reader = request.body.getReader();
    sourceReader = reader;
    const chunks: Uint8Array[] = [];
    let size = 0;
    let finished = false;
    let cancelled = false;
    const append = (value: Uint8Array) => {
      if (size >= 8_192) return;
      const part = value.subarray(0, 8_192 - size).slice();
      chunks.push(part);
      size += part.length;
    };
    const summarize = async (drainRemaining = true) => {
      if (drainRemaining && !finished && !cancelled && size < 8_192) {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        const readPromise = (async () => {
          while (size < 8_192) {
            const { done, value } = await reader.read();
            if (done || !value) {
              finished = true;
              break;
            }
            append(value);
          }
        })().catch(() => {
          finished = true;
        });
        try {
          await Promise.race([
            readPromise,
            new Promise<void>((resolve) => {
              timeoutId = setTimeout(() => {
                timedOut = true;
                resolve();
              }, 50);
            }),
          ]);
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
        if (timedOut || size >= 8_192) {
          cancelled = true;
          void reader.cancel().catch(() => undefined);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return summarizeBodyText(new TextDecoder().decode(bytes));
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done || !value) {
            finished = true;
            controller.close();
            return;
          }
          append(value);
          controller.enqueue(value);
        } catch (error) {
          finished = true;
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancelled = true;
        finished = true;
        await reader.cancel(reason);
      },
    }, { highWaterMark: 0 });
    const capturedRequest = new Request(request, {
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    return { request: capturedRequest, summarize };
  } catch {
    try {
      sourceReader?.releaseLock();
    } catch {
      // A failed stream wrapper falls back to the untouched incoming request.
    }
    return {
      request,
      summarize: async () => EMPTY_REQUEST_BODY_SUMMARY,
    };
  }
};

const responseErrorCode = async (response: Response) => {
  try {
    const value = await response.clone().json() as Record<string, unknown>;
    const nested = value.error && typeof value.error === "object"
      ? value.error as Record<string, unknown>
      : undefined;
    const candidate = value.error_code ?? value.code ?? nested?.code;
    return typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
};

const captureWorkerEvents = async (
  env: Env,
  requestId: string,
  events: Array<{ event: string; properties: Record<string, unknown> }>,
) => {
  const token = env.ITX_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token || events.length === 0) return;
  const configuredEndpoint = env.ITX_POSTHOG_CAPTURE_ENDPOINT?.trim() || DEFAULT_CAPTURE_ENDPOINT;
  let endpoint: URL;
  try {
    endpoint = new URL(configuredEndpoint);
    if (endpoint.protocol !== "https:") return;
  } catch {
    return;
  }
  endpoint.pathname = "/batch/";
  endpoint.search = "";
  const timestamp = new Date().toISOString();
  const batch = events.map((entry) => ({
    event: entry.event,
    timestamp,
    properties: {
      ...entry.properties,
      distinct_id: "itemtraxx-edge-proxy",
      "$process_person_profile": false,
      request_id: requestId,
    },
  }));
  try {
    await fetch(endpoint.toString(), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token, batch }),
    });
  } catch {
    // PostHog outages must not affect the Worker request path.
  }
};

export const parseWorkerTraceparent = (value?: string | null) => {
  if (!value) return undefined;
  const match = TRACEPARENT_RE.exec(value.trim());
  if (!match) return undefined;
  const [, version, traceId, spanId, flags, trailing] = match;
  if (!version || !traceId || !spanId || !flags) return undefined;
  if (version === "ff" || (version === "00" && trailing)) return undefined;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
  return {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16) & 1 ? "01" : "00",
  };
};

export const createWorkerTraceContext = (request: Request, env: Env): WorkerTraceContext => {
  const parent = parseWorkerTraceparent(request.headers.get("traceparent"));
  const traceId = parent?.traceId ?? randomHex(16);
  const traceFlags = parent?.traceFlags ?? (Math.random() < envSampleRate(env) ? "01" : "00");
  const spanId = randomHex(8);
  const tracestate = request.headers.get("tracestate")?.trim();
  return {
    traceId,
    spanId,
    ...(parent?.spanId ? { parentSpanId: parent.spanId } : {}),
    traceFlags,
    ...(tracestate && tracestate.length <= 512 && !/[^\x20-\x7e\t]/.test(tracestate)
      ? { tracestate }
      : {}),
    sampled: traceFlags === "01",
    traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
  };
};

export const withTraceHeaders = (request: Request, trace: WorkerTraceContext) => {
  const headers = new Headers(request.headers);
  headers.set("traceparent", trace.traceparent);
  // Cloudflare Observability forwards the Worker log record, not an OTLP
  // parent span. Tell the downstream function to keep this trace ID but make
  // its exported span the PostHog trace root.
  headers.set(TRACE_PARENT_EXPORTED_HEADER, TRACE_PARENT_EXPORTED_VALUE);
  if (trace.tracestate) headers.set("tracestate", trace.tracestate);
  return new Request(request, { headers });
};

export const reportWorkerEvent = async (env: Env, event: Record<string, unknown>) => {
  const level = typeof event.level === "string" ? event.level : "info";
  const payload = {
    ...safeExtra(event),
    event: typeof event.event === "string" ? event.event : "worker.observability",
    service: "itemtraxx-edge-proxy",
    environment: (env.ITX_ENVIRONMENT ?? "production").trim() || "production",
    provider: "cloudflare-worker",
  };
  const output = serialize(payload);
  if (level === "error" || level === "fatal") console.error(output);
  else if (level === "warn" || level === "warning") console.warn(output);
  else console.info(output);
};

export const reportWorkerException = (
  env: Env,
  request: Request,
  requestId: string,
  error: unknown,
  extra: Record<string, unknown> = {},
) => {
  return reportWorkerEvent(env, {
    level: "error",
    event: "worker.request.exception",
    route: normalizeRoute(new URL(request.url).pathname),
    method: request.method,
    request_id: requestId,
    error_code: error instanceof Error && "code" in error &&
        typeof error.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code)
      ? error.code
      : "worker_error",
    error_type: error instanceof Error ? error.name : "WorkerError",
    ...extra,
  });
};

export const reportWorkerHttpFailure = (
  env: Env,
  request: Request,
  requestId: string,
  status: number,
  _message: string,
  extra: Record<string, unknown> = {},
  trace?: WorkerTraceContext,
) =>
  reportWorkerEvent(env, {
    level: status >= 500 ? "error" : "warn",
    event: "worker.request.failure",
    route: normalizeRoute(new URL(request.url).pathname),
    method: request.method,
    request_id: requestId,
    status,
    error_code: status >= 500 ? "server_error" : "request_failed",
    ...extra,
    ...(trace ? { trace_id: trace.traceId, span_id: trace.spanId } : {}),
  });

export const maybeReportWorkerResponse = (
  env: Env,
  request: Request,
  requestId: string,
  response: Response,
  ctx: ExecutionContext,
  extra: Record<string, unknown> = {},
  trace?: WorkerTraceContext,
) => {
  if (response.status < 500) return;
  ctx.waitUntil(
    reportWorkerHttpFailure(
      env,
      request,
      requestId,
      response.status,
      `Worker request failed with status ${response.status}.`,
      extra,
      trace,
    ),
  );
};

export const logWorkerRequestCompletion = async (
  env: Env,
  request: Request,
  requestId: string,
  trace: WorkerTraceContext,
  operation: string,
  status: number,
  latencyMs: number,
  extra: Record<string, unknown> = {},
  ctx?: Pick<ExecutionContext, "waitUntil">,
  responseErrorCode?: string,
  bodySummary: RequestBodySummary = EMPTY_REQUEST_BODY_SUMMARY,
) => {
  void operation;
  const metadata = await requestPrivacyMetadata(env, request);
  const querySuspicious = suspiciousQuerySummary(request);
  const suspicious = {
    markers: [...new Set([...querySuspicious.markers, ...bodySummary.markers])],
    snippets: [...new Set([...querySuspicious.snippets, ...bodySummary.snippets])],
  };
  const slow = latencyMs >= 1_500;
  const level = status >= 500 ? "error" : status >= 400 || slow ? "warn" : "info";
  const completion = {
    ...metadata,
    ...safeExtra(extra),
    event: "edge_request",
    level,
    service: "itemtraxx-edge-proxy",
    environment: (env.ITX_ENVIRONMENT ?? "production").trim() || "production",
    operation: safeText(`${request.method.toUpperCase()} ${metadata.route}`, 160),
    status,
    latency_ms: Math.max(0, Math.round(latencyMs)),
    request_id: requestId,
    trace_id: trace.traceId,
    span_id: trace.spanId,
    provider: "cloudflare-worker",
    retry_count: 0,
    ...(status >= 500
      ? { error_code: "server_error" }
      : status >= 400
      ? { error_code: "request_failed" }
      : {}),
    ...(responseErrorCode && /^[A-Za-z0-9_.-]{1,64}$/.test(responseErrorCode)
      ? { error_code: responseErrorCode }
      : {}),
    ...(status >= 400
      ? { rejected_query_keys: metadata.query_keys, rejected_fields: bodySummary.fields }
      : {}),
    ...(suspicious.markers.length ? { suspicious_markers: suspicious.markers } : {}),
    ...(status >= 400 && suspicious.snippets.length
      ? { rejected_input_snippets: suspicious.snippets }
      : {}),
  };
  const output = serialize({ ...completion, event: "request.completed" });
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);

  const category = status === 401 || status === 403
    ? "auth_forbidden"
    : status === 400 || status === 422
    ? "validation_failure"
    : undefined;
  const events: Array<{ event: string; properties: Record<string, unknown> }> = [
    { event: "edge_request", properties: completion },
  ];
  if (category) {
    const securityEvent = {
      event: "security_event",
      level: "warn",
      category,
      ...metadata,
      status,
      error_code: status >= 500 ? "server_error" : "request_failed",
      ...(status >= 400
        ? { rejected_query_keys: metadata.query_keys, rejected_fields: bodySummary.fields }
        : {}),
      ...(status >= 400 && suspicious.snippets.length
        ? { rejected_input_snippets: suspicious.snippets }
        : {}),
      service: "itemtraxx-edge-proxy",
      trace_id: trace.traceId,
      span_id: trace.spanId,
    };
    await reportWorkerEvent(env, securityEvent);
    events.push({ event: "security_event", properties: securityEvent });
  }
  if (suspicious.markers.length) {
    const suspiciousEvent = {
      event: "security_event",
      level: "warn",
      category: "suspicious_payload",
      ...metadata,
      status,
      suspicious_markers: suspicious.markers,
      rejected_input_snippets: suspicious.snippets,
      service: "itemtraxx-edge-proxy",
      trace_id: trace.traceId,
      span_id: trace.spanId,
    };
    await reportWorkerEvent(env, suspiciousEvent);
    events.push({ event: "security_event", properties: suspiciousEvent });
  }
  if (suspicious.markers.includes("sql_injection")) {
    dispatchIncidentIoSecurityPage(
      env,
      request,
      requestId,
      "sqli",
      ctx,
      status,
      "payload_signature",
    );
  }
  if (suspicious.markers.includes("xss")) {
    dispatchIncidentIoSecurityPage(
      env,
      request,
      requestId,
      "xss",
      ctx,
      status,
      "payload_signature",
    );
  }
  const exportPromise = captureWorkerEvents(env, requestId, events);
  if (ctx) ctx.waitUntil(exportPromise);
  else await exportPromise;
};

export const withWorkerRequestTelemetry = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  handler: WorkerTelemetryHandler,
) => {
  const headerCandidate = request.headers.get("x-request-id")?.trim();
  const headerRequestId = headerCandidate && SAFE_REQUEST_ID_RE.test(headerCandidate)
    ? headerCandidate
    : undefined;
  const queryCandidate = new URL(request.url).searchParams.get("itx_request_id")?.trim();
  const queryRequestId = queryCandidate && SAFE_REQUEST_ID_RE.test(queryCandidate)
    ? queryCandidate
    : undefined;
  const requestId = headerRequestId || queryRequestId || crypto.randomUUID();
  const trace = createWorkerTraceContext(request, env);
  const startedAt = Date.now();
  let status = 500;
  let responseCode: string | undefined;
  let unhandledError = false;
  // Observe bytes only as the handler reads them. The wrapper does not pull the
  // request stream on its own, so early rate-limit responses leave it unread.
  const bodyCapture = captureWorkerRequestBody(request);
  try {
    const response = await handler({
      requestId,
      trace,
      tracedRequest: withTraceHeaders(bodyCapture.request, trace),
    });
    status = response.status;
    if (status >= 400) responseCode = await responseErrorCode(response);
    return response;
  } catch (error) {
    unhandledError = true;
    throw error;
  } finally {
    const bodySummary = await bodyCapture.summarize(status !== 429);
    await logWorkerRequestCompletion(
      env,
      request,
      requestId,
      trace,
      `${request.method} ${new URL(request.url).pathname}`,
      status,
      Date.now() - startedAt,
      {},
      ctx,
      unhandledError ? "unhandled_error" : responseCode,
      bodySummary,
    );
  }
};
