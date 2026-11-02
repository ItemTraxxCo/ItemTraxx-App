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
const REQUEST_TRACE_CONTEXT = new WeakMap<Request, TraceContext>();
const pendingEventExports = new Set<Promise<void>>();
const DEFAULT_CAPTURE_ENDPOINT = "https://us.i.posthog.com/i/v0/e/";
const ROUTE_ID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const SAFE_REQUEST_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|itx-\d{8,}-\d{1,})$/i;

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
const safeRequestId = (value: string) => safeText(value, 128);

const safeAttribute = (key: string, value: unknown): AttributeValue | undefined => {
  if (key !== "user_agent" && SENSITIVE_KEY_PATTERN.test(key)) return undefined;
  if (typeof value === "string") return safeText(value, 256);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
};

const safeExtra = (extra: Record<string, unknown>) => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      const safeItems: Array<string | number | boolean> = [];
      for (const item of value.slice(0, 32)) {
        if (typeof item === "string") safeItems.push(safeText(item, 64));
        else if (typeof item === "number" && Number.isFinite(item)) safeItems.push(item);
        else if (typeof item === "boolean") safeItems.push(item);
      }
      if (key === "user_agent" || !SENSITIVE_KEY_PATTERN.test(key)) output[key] = safeItems;
    } else if (value && typeof value === "object") {
      const safeObject: Record<string, string | number | boolean> = {};
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
        const safe = safeAttribute(nestedKey, nestedValue);
        if (safe !== undefined) safeObject[nestedKey] = safe;
      }
      if (key === "user_agent" || !SENSITIVE_KEY_PATTERN.test(key)) output[key] = safeObject;
    } else {
      const safe = safeAttribute(key, value);
      if (safe !== undefined) output[key] = safe;
    }
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
  return incoming && SAFE_REQUEST_ID_RE.test(incoming)
    ? incoming
    : crypto.randomUUID();
};

const trackEventExport = (promise: Promise<unknown>) => {
  const tracked = promise.then(() => undefined).catch(() => undefined).finally(() => {
    pendingEventExports.delete(tracked);
  });
  pendingEventExports.add(tracked);
};

const routeForTelemetry = (pathname: string) =>
  pathname.split("/").map((segment) =>
    ROUTE_ID_SEGMENT.test(segment) || /^\d{4,}$/.test(segment)
      ? ":id"
      : safeText(segment, 64)
  ).join("/").slice(0, 256);

const safeQuerySummary = (url: URL) => {
  const keys: string[] = [];
  const lengths: Record<string, number> = {};
  for (const [rawKey, value] of url.searchParams) {
    if (keys.length >= 32) break;
    const key = rawKey.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
    if (!key || key.toLowerCase() === "itx_request_id" || SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (!keys.includes(key)) keys.push(key);
    lengths[key] = Math.max(lengths[key] ?? 0, Math.min(value.length, 4096));
  }
  return { query_keys: keys, query_value_lengths: lengths };
};

const hmacHex = async (value: string, secret: string) => {
  if (!secret || !value) return undefined;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(signature), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  } catch {
    return undefined;
  }
};

const bearerOrSessionCredential = (req: Request) => {
  const authorization = req.headers.get("authorization")?.trim();
  if (authorization) return authorization;
  const cookie = req.headers.get("cookie")?.slice(0, 4096);
  return cookie || "";
};

const requestPrivacyMetadata = async (req: Request) => {
  const url = new URL(req.url);
  const secret = envValue("ITX_EDGE_PROXY_SHARED_SECRET");
  const clientIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  const credential = bearerOrSessionCredential(req);
  const userAgent = req.headers.get("user-agent") ?? "";
  return {
    route: routeForTelemetry(url.pathname),
    method: req.method.toUpperCase().slice(0, 16),
    ...safeQuerySummary(url),
    ...(userAgent ? { user_agent: safeText(userAgent, 256) } : {}),
    ...(clientIp && secret ? { client_ip_hash: await hmacHex(clientIp, secret) } : {}),
    ...(credential && secret ? { session_hash: await hmacHex(credential, secret) } : {}),
  };
};

export type IncidentSecurityAttackType =
  | "sqli"
  | "xss"
  | "rls_tenant_breach"
  | "idor_enumeration";

type IncidentSecurityPageInput = {
  attackType: IncidentSecurityAttackType;
  route: string;
  requestId: string;
  actorId?: string;
  clientIpHash?: string;
  request?: Request;
};

const incidentAttackLabel = (attackType: IncidentSecurityAttackType) => ({
  sqli: "SQLi",
  xss: "XSS",
  rls_tenant_breach: "RLS/tenant breach attempt",
  idor_enumeration: "IDOR enumeration",
}[attackType]);

const incidentRouteSlug = (route: string) =>
  route.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 80) || "root";

export const emitIncidentIoSecurityPage = (entry: IncidentSecurityPageInput) => {
  const endpoint = envValue("INCIDENT_IO_SECURITY_WEBHOOK_URL");
  const apiKey = envValue("INCIDENT_IO_SECURITY_API_KEY");
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

  trackEventExport((async () => {
    const secret = envValue("ITX_EDGE_PROXY_SHARED_SECRET");
    const [requestMetadata, actorHash] = await Promise.all([
      entry.request ? requestPrivacyMetadata(entry.request) : Promise.resolve(undefined),
      entry.actorId ? hmacHex(entry.actorId, secret) : Promise.resolve(undefined),
    ]);
    const route = routeForTelemetry(entry.route.split("?")[0] || "/");
    const payload = {
      title: "[SECURITY CRITICAL] " + incidentAttackLabel(entry.attackType) + " on " + route,
      deduplication_key: "itx-sec-" + entry.attackType + "-" +
        incidentRouteSlug(route),
      status: "firing",
      severity: "critical",
      metadata: {
        attack_type: entry.attackType,
        route,
        client_ip_hash: entry.clientIpHash ??
          requestMetadata?.client_ip_hash ?? "unknown",
        actor_id: actorHash ?? "anon",
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
          request_id: entry.requestId,
          error_code: "webhook_rejected",
          status: response.status,
          service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
        }));
      }
    } catch {
      console.error(JSON.stringify({
        event: "incident_io.security_page_failed",
        request_id: entry.requestId,
        error_code: "webhook_unavailable",
        service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
      }));
    }
  })());
};

type PostHogCaptureInput = {
  event: string;
  requestId: string;
  properties: Record<string, unknown>;
};

const capturePostHogEvents = (events: PostHogCaptureInput[]) => {
  if (!events.length) return Promise.resolve();
  const token = envValue("ITX_POSTHOG_PROJECT_TOKEN");
  if (!token) return Promise.resolve();
  const configuredEndpoint = envValue("ITX_POSTHOG_CAPTURE_ENDPOINT");
  const endpoint = configuredEndpoint || DEFAULT_CAPTURE_ENDPOINT;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
    if (parsed.protocol !== "https:") return Promise.resolve();
  } catch {
    return Promise.resolve();
  }
  parsed.pathname = "/batch/";
  parsed.search = "";
  const timestamp = new Date().toISOString();
  const batch = events.slice(0, 500).map((entry) => ({
    event: entry.event,
    timestamp,
    properties: {
      ...safeExtra(entry.properties),
      request_id: safeRequestId(entry.requestId),
      distinct_id: "itemtraxx-edge-service",
      "$process_person_profile": false,
    },
  }));
  return fetch(parsed.toString(), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ token, batch }),
  }).then(() => undefined).catch(() => undefined);
};

const capturePostHogEvent = (
  event: string,
  requestId: string,
  properties: Record<string, unknown>,
) => capturePostHogEvents([{ event, requestId, properties }]);

export const flushEventExports = async () => {
  while (pendingEventExports.size) {
    await Promise.all(Array.from(pendingEventExports));
  }
};

const keepEventExportsAlive = () => {
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  const pending = flushEventExports();
  if (runtime?.waitUntil) runtime.waitUntil(pending);
  else void pending;
};

export const emitSecurityEvent = (
  req: Request,
  requestId: string,
  category: "validation_failure" | "auth_forbidden" | "suspicious_payload" | "enumeration_tripwire",
  extra: Record<string, unknown> = {},
) => {
  trackEventExport(requestPrivacyMetadata(req).then((metadata) =>
    capturePostHogEvent("security_event", requestId, {
      ...metadata,
      ...safeExtra(extra),
      category,
      request_id: requestId,
      service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
      environment: envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
    })
  ));
};

export type AuditEventEntry = {
  actorId: string;
  workspaceId: string;
  targetResourceId: string;
  targetType: string;
  action: string;
  requestId: string;
  route: string;
  method: string;
};

export const emitAuditEvents = (entries: AuditEventEntry[]) => {
  if (!entries.length) return;
  const secret = envValue("ITX_EDGE_PROXY_SHARED_SECRET");
  trackEventExport(Promise.all(entries.map(async (entry) => {
    const [actorHash, workspaceHash, targetHash] = await Promise.all([
      hmacHex(entry.actorId, secret),
      hmacHex(entry.workspaceId, secret),
      hmacHex(entry.targetResourceId, secret),
    ]);
    return {
      event: "audit_event",
      requestId: entry.requestId,
      properties: {
        ...(actorHash ? { actor_hash: actorHash } : {}),
        ...(workspaceHash ? { workspace_hash: workspaceHash } : {}),
        ...(targetHash ? { target_resource_hash: targetHash } : {}),
        target_type: entry.targetType,
        action: entry.action,
        route: entry.route,
        method: entry.method,
        service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
        environment: envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
      },
    };
  })).then(capturePostHogEvents));
};

export const emitAuditEvent = (entry: AuditEventEntry) => emitAuditEvents([entry]);

export const emitEnumerationTripwire = (entry: {
  actorId: string;
  workspaceId: string;
  requestId: string;
  route: string;
  distinctTargetCount: number;
  request?: Request;
}) => {
  const secret = envValue("ITX_EDGE_PROXY_SHARED_SECRET");
  trackEventExport(Promise.all([
    hmacHex(entry.actorId, secret),
    hmacHex(entry.workspaceId, secret),
  ]).then(([actorHash, workspaceHash]) =>
    capturePostHogEvent("security_event", entry.requestId, {
      ...(actorHash ? { actor_hash: actorHash } : {}),
      ...(workspaceHash ? { workspace_hash: workspaceHash } : {}),
      category: "enumeration_tripwire",
      detection: "distinct_resource_enumeration",
      distinct_target_count: entry.distinctTargetCount,
      route: entry.route,
      method: "GET",
      request_id: entry.requestId,
      service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
      environment: envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
    })
  ));
  emitIncidentIoSecurityPage({
    attackType: "idor_enumeration",
    actorId: entry.actorId,
    requestId: entry.requestId,
    route: entry.route,
    request: entry.request,
  });
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
    "http.route": routeForTelemetry(new URL(req.url).pathname),
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
    request_id: safeRequestId(requestId),
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
  const errorObject = error as { name?: unknown; code?: unknown } | null;
  const errorCode = errorObject && typeof errorObject.code === "string" &&
      /^[A-Za-z0-9_.-]{1,64}$/.test(errorObject.code)
    ? errorObject.code
    : undefined;
  console.error(serialize({
    ...safeExtra(extra),
    event,
    level: "error",
    request_id: safeRequestId(requestId),
    ...(trace ? { trace_id: trace.traceId, span_id: trace.spanId } : {}),
    service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
    environment: envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
    provider: "supabase-edge-function",
    error_type: errorObject && typeof errorObject.name === "string"
      ? safeText(errorObject.name, 120)
      : "Error",
    ...(errorCode ? { error_code: errorCode } : {}),
  }));
};

export const logRequestCompletion = (
  req: Request,
  requestId: string,
  operation: string,
  status: number,
  latencyMs: number,
  trace: TraceContext = traceContextFromRequest(req),
  extra: Record<string, unknown> = {},
) => {
  const metadata = requestPrivacyMetadata(req);
  const isSlow = latencyMs >= 1_500;
  const level = status >= 500 ? "error" : status >= 400 || isSlow ? "warn" : "info";
  trackEventExport(metadata.then((requestMetadata) => {
    const payload = {
      ...requestMetadata,
      event: "request.completed",
      level,
      service: envValue("ITX_OTEL_SERVICE_NAME") || DEFAULT_SERVICE_NAME,
      environment: envValue("ITX_ENVIRONMENT") || DEFAULT_ENVIRONMENT,
      operation: safeText(operation, 160),
      status,
      latency_ms: Math.max(0, Math.round(latencyMs)),
      request_id: safeRequestId(requestId),
      trace_id: trace.traceId,
      span_id: trace.spanId,
      provider: "supabase-edge-function",
      retry_count: 0,
      ...(status >= 500
        ? { error_code: "server_error" }
        : status >= 400
        ? { error_code: "request_failed" }
        : {}),
      ...safeExtra(extra),
    };
    const output = serialize(payload);
    if (level === "error") console.error(output);
    else if (level === "warn") console.warn(output);
    else console.info(output);
    return capturePostHogEvent("edge_request", requestId, payload);
  }));
};

const readBodySnippet = async (req: Request) => {
  if (req.method === "GET" || req.method === "HEAD" || !req.body) return "";
  try {
    const reader = req.clone().body?.getReader();
    if (!reader) return "";
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const readPromise = (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < 8_192) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const part = value.subarray(0, 8_192 - size);
        chunks.push(part);
        size += part.length;
      }
      if (size >= 8_192) void reader.cancel().catch(() => undefined);
      return new TextDecoder().decode(
        chunks.reduce((bytes, chunk) => {
          const combined = new Uint8Array(bytes.length + chunk.length);
          combined.set(bytes);
          combined.set(chunk, bytes.length);
          return combined;
        }, new Uint8Array()),
      );
    })();
    try {
      const result = await Promise.race([
        readPromise,
        new Promise<string>((resolve) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            resolve("");
          }, 50);
        }),
      ]);
      if (timedOut) void reader.cancel().catch(() => undefined);
      return result;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  } catch {
    return "";
  }
};

const SUSPICIOUS_MARKERS: Array<[string, RegExp, string]> = [
  ["xss", /<\s*script\b/i, "<script"],
  ["xss", /javascript\s*:/i, "javascript:"],
  ["xss", /\bon(?:error|load)\s*=/i, "event-handler="],
  ["sql_injection", /\bunion\s+(?:all\s+)?select\b/i, "union-select"],
  ["sql_injection", /\b(?:sleep|benchmark)\s*\(/i, "sql-time-function"],
  ["sql_injection", /(?:'|%27)\s*(?:or|and)\s+\d/i, "sql-boolean-condition"],
  ["path_traversal", /(?:\.\.\/|\.\.\\|%2e%2e%2f)/i, "../"],
  ["prototype_pollution", /(?:__proto__|prototype\s*\[|constructor\s*\[)/i, "prototype-property"],
];

const suspiciousInputSummary = (value: string) => {
  const matches = SUSPICIOUS_MARKERS.filter(([, pattern]) => pattern.test(value));
  return {
    markers: [...new Set(matches.map(([marker]) => marker))],
    // Keep only fixed attack signatures. Never retain a request-provided value,
    // which could contain PII, credentials, or an arbitrary payload.
    snippets: [...new Set(matches.map(([, , snippet]) => snippet))],
  };
};

const summarizeBody = (body: string) => {
  if (!body) {
    return {
      payload_fields: [] as string[],
      suspicious_markers: [] as string[],
      suspicious_snippets: [] as string[],
    };
  }
  let fields: string[] = [];
  try {
    const value = JSON.parse(body);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      fields = Object.keys(value).filter((key) => !SENSITIVE_KEY_PATTERN.test(key))
        .map((key) => key.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 48)).slice(0, 32);
    }
  } catch {
    fields = [];
  }
  return {
    payload_fields: fields,
    ...(() => {
      const suspicious = suspiciousInputSummary(body);
      return {
        suspicious_markers: suspicious.markers,
        suspicious_snippets: suspicious.snippets,
      };
    })(),
  };
};

const responseErrorCode = async (response: Response) => {
  try {
    const value = await response.clone().json() as Record<string, unknown>;
    const nestedError = value.error && typeof value.error === "object"
      ? value.error as Record<string, unknown>
      : undefined;
    const candidate = value.error_code ?? value.code ?? nestedError?.code;
    return typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
};

export const withSecurityLogging = (
  req: Request,
  _operation: string,
  handler: () => Promise<Response>,
) => {
  const requestId = getRequestId(req);
  const operation = `${req.method.toUpperCase()} ${routeForTelemetry(new URL(req.url).pathname)}`;
  const startedAt = Date.now();
  return (async () => {
    const body = await readBodySnippet(req);
    const bodySummary = summarizeBody(body);
    const url = new URL(req.url);
    const querySummary = safeQuerySummary(url);
    const queryValues = Array.from(url.searchParams.values()).join("\n");
    const querySuspicious = suspiciousInputSummary(queryValues);
    const suspiciousMarkers = [
      ...bodySummary.suspicious_markers,
      ...querySuspicious.markers,
    ];
    const suspiciousSnippets = [
      ...bodySummary.suspicious_snippets,
      ...querySuspicious.snippets,
    ];
    let status = 500;
    let errorCode: string | undefined;
    try {
      const response = await handler();
      status = response.status;
      if (status >= 400) errorCode = await responseErrorCode(response);
      return response;
    } catch (error) {
      errorCode = error instanceof Error && "code" in error && typeof error.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code)
        ? error.code
        : "unhandled_error";
      throw error;
    } finally {
      logRequestCompletion(
        req,
        requestId,
        operation,
        status,
        Date.now() - startedAt,
        REQUEST_TRACE_CONTEXT.get(req) ?? traceContextFromRequest(req),
        {
          ...(errorCode ? { error_code: errorCode } : {}),
          ...(status >= 400 ? { rejected_query_keys: querySummary.query_keys, rejected_fields: bodySummary.payload_fields } : {}),
          ...(suspiciousMarkers.length ? { suspicious_markers: [...new Set(suspiciousMarkers)] } : {}),
          ...(status >= 400 && suspiciousSnippets.length
            ? { rejected_input_snippets: [...new Set(suspiciousSnippets)] }
            : {}),
        },
      );
      if (status === 401 || status === 403) {
        emitSecurityEvent(req, requestId, "auth_forbidden", { status });
      } else if (status === 400 || status === 422) {
        emitSecurityEvent(req, requestId, "validation_failure", {
          status,
          ...(errorCode ? { error_code: errorCode } : {}),
          rejected_query_keys: querySummary.query_keys,
          rejected_fields: bodySummary.payload_fields,
          ...(suspiciousSnippets.length
            ? { rejected_input_snippets: [...new Set(suspiciousSnippets)] }
            : {}),
        });
      }
      if (suspiciousMarkers.length) {
        emitSecurityEvent(req, requestId, "suspicious_payload", {
          status,
          suspicious_markers: [...new Set(suspiciousMarkers)],
          ...(suspiciousSnippets.length
            ? { rejected_input_snippets: [...new Set(suspiciousSnippets)] }
            : {}),
        });
      }
      const criticalMarkers = new Set(suspiciousMarkers);
      if (criticalMarkers.has("sql_injection")) {
        emitIncidentIoSecurityPage({
          attackType: "sqli",
          request: req,
          requestId,
          route: new URL(req.url).pathname,
        });
      }
      if (criticalMarkers.has("xss")) {
        emitIncidentIoSecurityPage({
          attackType: "xss",
          request: req,
          requestId,
          route: new URL(req.url).pathname,
        });
      }
      keepEventExportsAlive();
    }
  })();
};

export const withRequestSpan = async (
  req: Request,
  operation: string,
  handler: (span: ServerRequestSpan, requestId: string) => Promise<Response>,
) => {
  const requestId = getRequestId(req);
  const span = startRequestSpan(req, operation, requestId);
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
    REQUEST_TRACE_CONTEXT.set(req, span.context);
    span.end();
  }
};
