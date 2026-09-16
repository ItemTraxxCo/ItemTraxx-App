/**
 * Small, dependency-free observability primitives for Supabase Edge
 * Functions. The runtime does not ship the OpenTelemetry SDK, so this module
 * emits the W3C/OTLP wire format directly and keeps the application path
 * independent from exporter failures.
 */

export type TraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: string;
  tracestate?: string;
  sampled: boolean;
};

type TraceParent = {
  traceId: string;
  spanId: string;
  traceFlags: string;
};

type SpanStatus = "unset" | "ok" | "error";
type AttributeValue = string | number | boolean;

export type ServerRequestSpan = TraceContext & {
  readonly context: TraceContext;
  readonly operation: string;
  setAttribute: (key: string, value: AttributeValue) => ServerRequestSpan;
  setAttributes: (attributes: Record<string, AttributeValue | undefined>) => ServerRequestSpan;
  setStatus: (status: Exclude<SpanStatus, "unset">, message?: string) => ServerRequestSpan;
  recordException: (error: unknown) => ServerRequestSpan;
  traceparent: () => string;
  end: (status?: Exclude<SpanStatus, "unset">) => void;
};

const DEFAULT_SERVICE_NAME = "itemtraxx-supabase-functions";
const DEFAULT_ENVIRONMENT = "production";
const DEFAULT_TRACE_ENDPOINT = "https://us.i.posthog.com/i/v1/traces";
const TRACE_PARENT_EXPORTED_HEADER = "x-itx-trace-parent-exported";
const TRACE_PARENT_EXPORTED_VALUE = "false";
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_PATTERN = /\b(?:eyJ[a-z0-9_-]{10,}|[a-z0-9_-]{24,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,})\b/gi;
const QUERY_SECRET_PATTERN = /\b(access_token|refresh_token|id_token|token|secret|signature|code)=([^&#\s]+)/gi;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|password|secret|token|email|phone|body|headers|payload|borrower|user|profile|tenant_name|workspace_name|account_name|account_label|page_url|storage_path|filename|lead_id|support_request_id|workspace_id|account_id|user_id|report_id)/i;

const envValue = (name: string) => {
  try {
    return Deno.env.get(name)?.trim() || "";
  } catch {
    return "";
  }
};

const safeText = (value: string, maxLength = 512) =>
  value
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(TOKEN_PATTERN, "[REDACTED_TOKEN]")
    .replace(QUERY_SECRET_PATTERN, "$1=[REDACTED]")
    .slice(0, maxLength);

const safeAttribute = (key: string, value: unknown): AttributeValue | undefined => {
  if (SENSITIVE_KEY_PATTERN.test(key)) return undefined;
  if (typeof value === "string") return safeText(value, 256);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
};

const safeExtra = (extra: Record<string, unknown>) => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    const safe = safeAttribute(key, value);
    if (safe !== undefined) output[key] = safe;
    if (Object.keys(output).length >= 48) break;
  }
  return output;
};

const serialize = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ event: "observability.serialization_failed" });
  }
};

export const getRequestId = (req: Request) => {
  const incoming = req.headers.get("x-request-id")?.trim();
  return incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
};

export const parseTraceparent = (value?: string | null): TraceParent | undefined => {
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

const sanitizeTracestate = (value?: string | null) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512 || /[^\x20-\x7e\t]/.test(trimmed)) return undefined;
  const members = trimmed.split(",");
  if (members.length > 32 || members.some((member) => member.trim() && !member.includes("="))) return undefined;
  return trimmed;
};

const randomHex = (bytes: number) => {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
};

const resolveSampleRate = () => {
  const configured = Number(envValue("ITX_OTEL_TRACE_SAMPLE_RATE"));
  if (!Number.isFinite(configured)) return 0.1;
  return Math.min(1, Math.max(0, configured));
};

const traceContextFromRequest = (req: Request): TraceContext => {
  const parent = parseTraceparent(req.headers.get("traceparent"));
  const traceId = parent?.traceId ?? randomHex(16);
  // The Worker emits its completion record through Cloudflare Observability,
  // not as an OTLP span. Keep its trace ID for log correlation, but root the
  // Supabase span so PostHog can display the trace instead of an orphan child.
  const workerParentWasNotExported = req.headers.get(TRACE_PARENT_EXPORTED_HEADER)
    ?.trim().toLowerCase() === TRACE_PARENT_EXPORTED_VALUE;
  const parentSpanId = parent && !workerParentWasNotExported ? parent.spanId : undefined;
  const traceFlags = parent?.traceFlags ?? (Math.random() < resolveSampleRate() ? "01" : "00");
  return {
    traceId,
    spanId: randomHex(8),
    ...(parentSpanId ? { parentSpanId } : {}),
    traceFlags,
    tracestate: sanitizeTracestate(req.headers.get("tracestate")),
    sampled: traceFlags === "01",
  };
};

const toOtlpValue = (value: AttributeValue) => {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: safeText(value, 512) };
};

const toOtlpAttributes = (attributes: Record<string, AttributeValue>) =>
  Object.entries(attributes)
    .slice(0, 64)
    .map(([key, value]) => ({ key, value: toOtlpValue(value) }));

const unixNano = (milliseconds: number) => `${Math.floor(milliseconds)}${String(Math.floor((milliseconds % 1) * 1_000_000)).padStart(6, "0")}`;

type SpanRecord = {
  context: TraceContext;
  operation: string;
  attributes: Record<string, AttributeValue>;
  status: SpanStatus;
  statusMessage?: string;
  startMs: number;
  endMs: number;
  exception?: { type: string; code?: string };
};

let pendingTraceExports: Promise<void> = Promise.resolve();

const exportSpan = async (record: SpanRecord) => {
  const token = envValue("ITX_POSTHOG_PROJECT_TOKEN");
  if (!token || !record.context.sampled) return;
  const endpoint = envValue("ITX_POSTHOG_TRACES_ENDPOINT") || DEFAULT_TRACE_ENDPOINT;
  try {
    const parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol !== "https:") return;
    const span = {
      traceId: record.context.traceId,
      spanId: record.context.spanId,
      ...(record.context.parentSpanId ? { parentSpanId: record.context.parentSpanId } : {}),
      ...(record.context.tracestate ? { traceState: record.context.tracestate } : {}),
      name: safeText(record.operation, 160),
      kind: 2,
      startTimeUnixNano: unixNano(record.startMs),
      endTimeUnixNano: unixNano(record.endMs),
      attributes: toOtlpAttributes(record.attributes),
      flags: record.context.traceFlags === "01" ? 1 : 0,
      ...(record.status !== "unset"
        ? {
            status: {
              code: record.status === "ok" ? 1 : 2,
              ...(record.statusMessage ? { message: safeText(record.statusMessage, 256) } : {}),
            },
          }
        : {}),
      ...(record.exception
        ? {
            events: [{
              name: "exception",
              timeUnixNano: unixNano(record.endMs),
              attributes: toOtlpAttributes({
                "exception.type": record.exception.type,
                ...(record.exception.code ? { "exception.code": record.exception.code } : {}),
              }),
            }],
          }
        : {}),
    };
    const payload = {
      resourceSpans: [{
        resource: {
          attributes: toOtlpAttributes({
            "service.name": envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
            "deployment.environment": envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
            "telemetry.sdk.name": "itemtraxx-edge-runtime",
          }),
        },
        scopeSpans: [{
          scope: { name: "itemtraxx-observability", version: "1.0.0" },
          spans: [span],
        }],
      }],
    };
    await fetch(parsedEndpoint.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Export failures are deliberately swallowed. The request and its error
    // response must never depend on PostHog availability.
  }
};

export const flushTraceExports = () => pendingTraceExports;

export const startRequestSpan = (
  req: Request,
  operation: string,
  requestId = getRequestId(req),
): ServerRequestSpan => {
  const context = traceContextFromRequest(req);
  const attributes: Record<string, AttributeValue> = {
    "http.request.method": req.method,
    "http.route": new URL(req.url).pathname,
    "itx.request_id": requestId,
  };
  let status: SpanStatus = "unset";
  let statusMessage: string | undefined;
  let exception: SpanRecord["exception"];
  let ended = false;
  const startedAt = Date.now();
  const span: ServerRequestSpan = {
    ...context,
    context,
    operation,
    setAttribute(key, value) {
      const safe = safeAttribute(key, value);
      if (safe !== undefined) attributes[key] = safe;
      return span;
    },
    setAttributes(values) {
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) span.setAttribute(key, value);
      }
      return span;
    },
    setStatus(next, message) {
      if (ended) return span;
      status = next;
      statusMessage = message;
      return span;
    },
    recordException(error) {
      if (ended) return span;
      const errorObject = error as { name?: unknown; code?: unknown } | null;
      const type = error instanceof Error && error.name ? error.name : "Error";
      const code = errorObject && typeof errorObject.code === "string" ? errorObject.code : undefined;
      exception = { type: safeText(type, 120), ...(code ? { code: safeText(code, 80) } : {}) };
      status = "error";
      return span;
    },
    traceparent: () => `00-${context.traceId}-${context.spanId}-${context.traceFlags}`,
    end(finalStatus) {
      if (ended) return;
      ended = true;
      if (finalStatus) status = finalStatus;
      const record: SpanRecord = {
        context,
        operation,
        attributes,
        status,
        ...(statusMessage ? { statusMessage } : {}),
        startMs: startedAt,
        endMs: Date.now(),
        ...(exception ? { exception } : {}),
      };
      pendingTraceExports = pendingTraceExports.then(() => exportSpan(record));
      // Supabase Edge Runtime exposes waitUntil for work that should finish
      // after the response is returned. Keep the optional call feature-detected
      // so local Deno tests and non-Supabase runtimes remain dependency-free.
      const runtime = (globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
      }).EdgeRuntime;
      try {
        runtime?.waitUntil?.(pendingTraceExports);
      } catch {
        // A host-specific waitUntil failure must not affect the response path.
      }
    },
  };
  return span;
};

export const logInfo = (
  event: string,
  requestId: string,
  extra: Record<string, unknown> = {},
  trace?: TraceContext,
) => {
  console.info(serialize({
    ...safeExtra(extra),
    event,
    level: "info",
    request_id: requestId,
    ...(trace ? { trace_id: trace.traceId, span_id: trace.spanId } : {}),
    service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
    environment: envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
    provider: "supabase-edge-function",
  }));
};

export const logError = (
  event: string,
  requestId: string,
  error: unknown,
  extra: Record<string, unknown> = {},
  trace?: TraceContext,
) => {
  console.error(serialize({
    ...safeExtra(extra),
    event,
    level: "error",
    request_id: requestId,
    ...(trace ? { trace_id: trace.traceId, span_id: trace.spanId } : {}),
    service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
    environment: envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
    provider: "supabase-edge-function",
    message: error instanceof Error ? safeText(error.message) : "Unknown error",
    ...(error instanceof Error && error.stack ? { stack: safeText(error.stack, 2_000) } : {}),
  }));
};

const resolveLogSampleRate = () => {
  const configured = Number(envValue("ITX_LOG_SUCCESS_SAMPLE_RATE"));
  if (!Number.isFinite(configured)) return 0.01;
  return Math.min(1, Math.max(0, configured));
};

export const logRequestCompletion = (
  req: Request,
  requestId: string,
  operation: string,
  status: number,
  latencyMs: number,
  trace: TraceContext,
  extra: Record<string, unknown> = {},
) => {
  const route = new URL(req.url).pathname;
  const isSlow = latencyMs >= 1_500;
  const isHealthCheck = route.endsWith("/system-status");
  const successSampleRate = isHealthCheck ? 0 : resolveLogSampleRate();
  if (status < 400 && !isSlow && !(Math.random() < successSampleRate)) return;
  const level = status >= 500 ? "error" : status >= 400 || isSlow ? "warn" : "info";
  const payload = {
    ...safeExtra(extra),
    event: "request.completed",
    level,
    service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
    environment: envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
    route,
    operation,
    status,
    latency_ms: Math.max(0, Math.round(latencyMs)),
    request_id: requestId,
    trace_id: trace.traceId,
    span_id: trace.spanId,
    provider: "supabase-edge-function",
    retry_count: 0,
    ...(status >= 500
      ? { error_code: "server_error" }
      : status >= 400
      ? { error_code: "request_failed" }
      : {}),
  };
  const output = serialize(payload);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);
};

export const withRequestSpan = async (
  req: Request,
  operation: string,
  handler: (span: ServerRequestSpan, requestId: string) => Promise<Response>,
) => {
  const requestId = getRequestId(req);
  const span = startRequestSpan(req, operation, requestId);
  const startedAt = Date.now();
  let status = 500;
  try {
    const response = await handler(span, requestId);
    status = response.status;
    span.setAttribute("http.response.status_code", response.status);
    span.setStatus(response.status >= 500 ? "error" : "ok");
    return response;
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    logRequestCompletion(req, requestId, operation, status, Date.now() - startedAt, span.context);
    span.end();
  }
};
