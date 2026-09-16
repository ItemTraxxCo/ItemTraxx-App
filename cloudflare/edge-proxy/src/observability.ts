import {
  TRACE_PARENT_EXPORTED_HEADER,
  TRACE_PARENT_EXPORTED_VALUE,
} from "./requestHeaders.ts";

/** Structured Worker telemetry and W3C trace propagation.
 *
 * Cloudflare Workers Observability forwards these JSON console records to the
 * existing log bridge. The Worker intentionally does not export directly to
 * PostHog: Cloudflare's native destination owns that delivery path, while the
 * Worker only propagates trace context to the Supabase service.
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
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_PATTERN = /\b(?:eyJ[a-z0-9_-]{10,}|[a-z0-9_-]{24,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,})\b/gi;
const QUERY_SECRET_PATTERN = /\b(access_token|refresh_token|id_token|token|secret|signature|code)=([^&#\s]+)/gi;
const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|email|phone|body|headers|payload|borrower|user|profile|tenant_name|workspace_name|account_name|account_label|page_url|storage_path|filename|lead_id|support_request_id|workspace_id|account_id|user_id|report_id)/i;

const safeText = (value: string, maxLength = 512) =>
  value
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(TOKEN_PATTERN, "[REDACTED_TOKEN]")
    .replace(QUERY_SECRET_PATTERN, "$1=[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, maxLength);

const safeExtra = (extra: Record<string, unknown>) => {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string") output[key] = safeText(value, 256);
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean") output[key] = value;
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
  const message = error instanceof Error ? error.message : "Unknown worker error";
  return reportWorkerEvent(env, {
    level: "error",
    event: "worker.request.exception",
    route: new URL(request.url).pathname,
    method: request.method,
    request_id: requestId,
    error_code: error instanceof Error && "code" in error ? String(error.code) : "worker_error",
    error_type: error instanceof Error ? error.name : "WorkerError",
    error_message: message,
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
    route: new URL(request.url).pathname,
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

const successSampleRate = (env: Env, route: string) =>
  route.endsWith("/system-status") ? 0 : Number.isFinite(Number(env.ITX_LOG_SUCCESS_SAMPLE_RATE))
    ? Math.min(1, Math.max(0, Number(env.ITX_LOG_SUCCESS_SAMPLE_RATE)))
    : 0.01;

export const logWorkerRequestCompletion = (
  env: Env,
  request: Request,
  requestId: string,
  trace: WorkerTraceContext,
  operation: string,
  status: number,
  latencyMs: number,
  extra: Record<string, unknown> = {},
) => {
  const route = new URL(request.url).pathname;
  const slow = latencyMs >= 1_500;
  if (status < 400 && !slow && Math.random() >= successSampleRate(env, route)) return;
  const level = status >= 500 ? "error" : status >= 400 || slow ? "warn" : "info";
  const output = serialize({
    ...safeExtra(extra),
    event: "request.completed",
    level,
    service: "itemtraxx-edge-proxy",
    environment: (env.ITX_ENVIRONMENT ?? "production").trim() || "production",
    route,
    operation,
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
  });
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);
};

export const withWorkerRequestTelemetry = async (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  handler: WorkerTelemetryHandler,
) => {
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const trace = createWorkerTraceContext(request, env);
  const startedAt = Date.now();
  let status = 500;
  try {
    const response = await handler({ requestId, trace, tracedRequest: withTraceHeaders(request, trace) });
    status = response.status;
    return response;
  } finally {
    logWorkerRequestCompletion(
      env,
      request,
      requestId,
      trace,
      `${request.method} ${new URL(request.url).pathname}`,
      status,
      Date.now() - startedAt,
    );
  }
};
