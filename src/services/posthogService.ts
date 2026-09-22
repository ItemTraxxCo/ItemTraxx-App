import {
  allowsAnalytics,
  allowsDiagnostics,
  allowsSessionReplay,
  readCookieConsent,
} from "./cookieConsentService";
import { isRecoverableChunkLoadError } from "./appErrorRecovery";
import type { CaptureLogOptions, CaptureResult } from "posthog-js";
import { AppError } from "./appErrors";
import {
  maskSessionReplayAttribute,
  scrubSensitiveReplayUrlValue,
  SESSION_REPLAY_MASK_SELECTOR,
} from "./sessionReplayPrivacy";
import { clearReplaySessionHandoff } from "./sessionReplayHandoff";

let initialized = false;
let posthogReady = false;
let posthog: typeof import("posthog-js").default | null = null;
let initializationPromise: Promise<void> | null = null;
let posthogReadyPromise: Promise<void> | null = null;
const SERVICE_NAME = "itemtraxx-web";
const APP_ENVIRONMENT = import.meta.env.VITE_POSTHOG_ENVIRONMENT?.trim() || import.meta.env.MODE || "production";
const APP_VERSION = import.meta.env.VITE_GIT_COMMIT?.trim() || "n/a";
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const EMAIL_REDACTION_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_PROPERTY_KEY =
  /(email|phone|name|tenant|profile|borrower|user_id|address|token|secret|error_message|error_type|error_stack|error_context|error_cause|exception|message|stack|context|cause)/i;
const EXCEPTION_CONTEXT_KEY = /^(route|path|operation|status|latency_ms|duration_ms|request_id|provider|retry_count|error_code|trace_id|span_id|service|environment|method|component|outcome|sampled|slow|attempt|job_type|result|request_area|request_operation|request_method|request_status)$/i;
// Keys the browser SDK manages and that capture validation needs to keep the
// event addressable. Without distinct_id the event is dropped as
// missing_distinct_id; the rest tie it to the right library, session, device.
const SDK_MANAGED_PROPERTY_KEYS = [
  "distinct_id",
  "$lib",
  "$lib_version",
  "$session_id",
  "$device_id",
] as const;

// Local development intentionally exercises failing requests. Those failures
// must not enter the shared PostHog project, where the exception alerting path
// would treat them as staging/production incidents.
const isLocalhostRuntime = () => {
  if (typeof window === "undefined") return false;
  const hostname = window.location?.hostname?.trim().toLowerCase() || "";
  return LOCALHOST_HOSTS.has(hostname) || hostname.endsWith(".localhost");
};

export type PostHogErrorCode =
  | "unauthorized"
  | "invalid_credentials"
  | "rate_limit"
  | "network"
  | "timeout"
  | "workspace_disabled"
  | "missing_context"
  | "invalid_barcode"
  | "borrower_not_found"
  | "server_error"
  | "request_failed"
  | "authentication_failed"
  | "unknown_error";

const POSTHOG_ERROR_CODES = new Set<PostHogErrorCode>([
  "unauthorized",
  "invalid_credentials",
  "rate_limit",
  "network",
  "timeout",
  "workspace_disabled",
  "missing_context",
  "invalid_barcode",
  "borrower_not_found",
  "server_error",
  "request_failed",
  "authentication_failed",
  "unknown_error",
]);

const isPostHogErrorCode = (value: unknown): value is PostHogErrorCode =>
  typeof value === "string" && POSTHOG_ERROR_CODES.has(value as PostHogErrorCode);

const getErrorCodeField = (error: unknown) => {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>).code;
  return typeof value === "string" ? value : undefined;
};

const getErrorStatusField = (error: unknown) => {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>).status;
  return typeof value === "number" ? value : undefined;
};

export const getPostHogErrorCode = (error: unknown): PostHogErrorCode => {
  const rawCode = getErrorCodeField(error);
  switch (rawCode?.toUpperCase()) {
    case "UNAUTHORIZED":
      return "unauthorized";
    case "RATE_LIMIT":
      return "rate_limit";
    case "NETWORK":
      return "network";
    case "TIMEOUT":
      return "timeout";
    case "TENANT_DISABLED":
      return "workspace_disabled";
    case "MISSING_CONTEXT":
      return "missing_context";
  }

  const status = getErrorStatusField(error);
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status !== undefined && status >= 500) return "server_error";

  const message = error instanceof Error ? error.message.trim().toLowerCase() : "";
  if (message.includes("invalid barcode") || message.includes("barcode")) return "invalid_barcode";
  if (message.includes("borrower not found")) return "borrower_not_found";
  if (message.includes("invalid email") || message.includes("invalid password") || message.includes("invalid credentials")) {
    return "invalid_credentials";
  }
  if (message === "unauthorized" || message.includes("session expired") || message.includes("session revoked")) {
    return "unauthorized";
  }
  if (message.includes("rate limit") || message.includes("too many requests")) return "rate_limit";
  if (message.includes("timed out")) return "timeout";
  if (message.includes("network request failed") || message.includes("unable to reach")) return "network";
  if (message.includes("workspace disabled") || message.includes("tenant disabled")) return "workspace_disabled";
  if (message.includes("missing tenant context")) return "missing_context";
  if (message) return "request_failed";
  return "unknown_error";
};

const redactLogText = (value: string, maxLength = 512) =>
  value
    .replace(EMAIL_REDACTION_PATTERN, "[REDACTED_EMAIL]")
    .replace(/\b(?:bearer\s+)?[a-z0-9_-]{24,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b(access_token|refresh_token|id_token|token|secret|signature|code)=([^&#\s]+)/gi, "$1=[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, maxLength);

const safeExceptionString = (value: unknown, maxLength = 512) =>
  typeof value === "string" ? redactLogText(value).slice(0, maxLength) : undefined;

const sanitizeExceptionFrame = (frame: unknown) => {
  if (!frame || typeof frame !== "object") return undefined;
  const source = frame as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["platform", "filename", "function", "lineno", "colno", "in_app"]) {
    const value = source[key];
    if (typeof value === "string") {
      safe[key] = key === "filename"
        ? safeExceptionString(scrubSensitiveReplayUrlValue(value), 256)
        : safeExceptionString(value, 256);
    } else if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
};

const sanitizeExceptionList = (
  value: unknown,
  errorCode?: PostHogErrorCode,
  requestOperation?: string,
) => {
  if (!Array.isArray(value)) return [];
  const entries = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    const type = safeExceptionString(source.type, 120);
    const exceptionValue = safeExceptionString(source.value, 512);
    if (type) safe.type = type;
    if (exceptionValue) safe.value = exceptionValue;
    const stacktrace = source.stacktrace;
    if (stacktrace && typeof stacktrace === "object") {
      const stack = stacktrace as Record<string, unknown>;
      const frames = Array.isArray(stack.frames)
        ? stack.frames.flatMap((frame) => {
            const safeFrame = sanitizeExceptionFrame(frame);
            return safeFrame ? [safeFrame] : [];
          }).slice(0, 100)
        : [];
      if (frames.length > 0) safe.stacktrace = { type: "raw", frames };
    }
    const mechanism = source.mechanism;
    if (mechanism && typeof mechanism === "object") {
      const sourceMechanism = mechanism as Record<string, unknown>;
      safe.mechanism = {
        ...(typeof sourceMechanism.type === "string" ? { type: safeExceptionString(sourceMechanism.type, 64) } : {}),
        ...(typeof sourceMechanism.handled === "boolean" ? { handled: sourceMechanism.handled } : {}),
        ...(typeof sourceMechanism.synthetic === "boolean" ? { synthetic: sourceMechanism.synthetic } : {}),
      };
    }
    return [safe];
  });

  if (!errorCode) return entries;
  const first = entries[0] as Record<string, unknown> | undefined;
  const safeOperation = requestOperation
    ? safeExceptionString(requestOperation, 160)
    : undefined;
  return [{
    // Handled request failures should remain grouped by their safe endpoint
    // context. The old fixed type/value made every transport failure look like
    // an artificial JavaScript exception even though the event had useful
    // request properties attached.
    type: safeOperation ? "ItemTraxxHandledRequestFailure" : "ItemTraxxClientError",
    value: safeOperation ? `${safeOperation}:${errorCode}` : errorCode,
    ...(first?.stacktrace ? { stacktrace: first.stacktrace } : {}),
    mechanism: { type: "generic", handled: true, synthetic: false },
  }];
};

const sanitizeExceptionEvent = (event: CaptureResult): CaptureResult => {
  if (event.event !== "$exception") return event;

  const properties = event.properties;
  const errorCode = isPostHogErrorCode(properties?.error_code)
    ? properties.error_code
    : undefined;
  const safeProperties: CaptureResult["properties"] = {};
  if (typeof properties?.token === "string") {
    // PostHog requires its project token to remain on the event. It is not a
    // user/session bearer and is safe to preserve here.
    safeProperties.token = properties.token;
  }
  // The SDK keeps the identifier and its own library/session/device keys in the
  // property bag. Capture validation rejects an event that arrives without a
  // distinct id, so carry these through the rebuild instead of the allowlist.
  for (const key of SDK_MANAGED_PROPERTY_KEYS) {
    const value = properties?.[key];
    if (typeof value === "string") safeProperties[key] = value;
  }
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (
      !EXCEPTION_CONTEXT_KEY.test(key) ||
      SENSITIVE_PROPERTY_KEY.test(key) ||
      key === "error_code"
    ) continue;
    if (typeof value === "string") {
      safeProperties[key] = redactLogText(value, 256);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safeProperties[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      safeProperties[key] = value;
    }
    if (Object.keys(safeProperties).length >= 32) break;
  }
  safeProperties.$exception_list = sanitizeExceptionList(
    properties?.$exception_list,
    errorCode,
    typeof properties?.request_operation === "string" ? properties.request_operation : undefined,
  );
  safeProperties.$exception_level = properties?.$exception_level === "warning"
    ? "warning"
    : "error";
  safeProperties.error_code = errorCode ?? "unknown_error";
  if (typeof properties?.$release_id === "string") {
    safeProperties.$release_id = properties.$release_id.slice(0, 128);
  } else if (APP_VERSION !== "n/a") {
    safeProperties.$release_id = APP_VERSION;
  }

  return { ...event, properties: safeProperties };
};

const URL_PROPERTY_KEY = /(url|uri|href|referrer|path)/i;
const SENSITIVE_URL_PARAMETER = /^(?:access_token|refresh_token|id_token|token|secret|signature|code|api[_-]?key)$/i;

const scrubTelemetryUrlValue = (value: string) => {
  const replaySafe = scrubSensitiveReplayUrlValue(value);
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(replaySafe);
  const isProtocolRelative = replaySafe.startsWith("//");
  try {
    const base = typeof window !== "undefined"
      ? window.location.origin
      : "https://www.itemtraxx.com";
    const url = new URL(replaySafe, base);
    let changed = replaySafe !== value;
    for (const key of [...url.searchParams.keys()]) {
      if (!SENSITIVE_URL_PARAMETER.test(key)) continue;
      url.searchParams.delete(key);
      changed = true;
    }
    if (url.hash.includes("=")) {
      const hashParams = new URLSearchParams(url.hash.slice(1));
      let hashChanged = false;
      for (const key of [...hashParams.keys()]) {
        if (!SENSITIVE_URL_PARAMETER.test(key)) continue;
        hashParams.delete(key);
        hashChanged = true;
      }
      if (hashChanged) {
        url.hash = hashParams.toString();
        changed = true;
      }
    }
    if (!changed) return value;
    if (isAbsolute) return url.toString();
    if (isProtocolRelative) return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    const pathname = replaySafe.startsWith("/")
      ? url.pathname
      : url.pathname.replace(/^\/+/, "");
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return replaySafe;
  }
};

export const sanitizeRecoveryUrlProperties = (
  properties: Record<string, unknown> | undefined,
) => {
  if (!properties) return properties;
  let changed = false;
  const safeProperties: Record<string, unknown> = { ...properties };
  for (const [key, value] of Object.entries(properties)) {
    if (!URL_PROPERTY_KEY.test(key) || typeof value !== "string") continue;
    const safeValue = scrubTelemetryUrlValue(value);
    if (safeValue !== value) {
      safeProperties[key] = safeValue;
      changed = true;
    }
  }
  return changed ? safeProperties : properties;
};

const scrubProperties = (
  properties?: Record<string, string | number | boolean | null | undefined>
) =>
  properties
    ? Object.entries(properties).reduce<Record<string, string | number | boolean | null | undefined>>(
        (safe, [key, value]) => {
          if (SENSITIVE_PROPERTY_KEY.test(key)) return safe;
          if (typeof value === "string" && EMAIL_PATTERN.test(value)) return safe;
          safe[key] = value;
          return safe;
        },
        {}
      )
    : undefined;

const LOG_ATTRIBUTE_KEY = /^(route|operation|status|latency_ms|duration_ms|request_id|provider|retry_count|error_code|trace_id|span_id|service|environment|method|component|outcome|sampled|slow|attempt|job_type|result)$/i;

const scrubLogAttributes = (attributes?: Record<string, unknown>) => {
  if (!attributes) return undefined;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!LOG_ATTRIBUTE_KEY.test(key) || SENSITIVE_PROPERTY_KEY.test(key)) continue;
    if (typeof value === "string") {
      safe[key] = redactLogText(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      safe[key] = value;
    }
    if (Object.keys(safe).length >= 32) break;
  }
  return safe;
};

type PostHogLogInput = Omit<CaptureLogOptions, "body" | "attributes"> & {
  body: string;
  attributes?: Record<string, unknown>;
};

/**
 * Send only explicitly authored, high-signal application logs. PostHog's
 * console integration remains disabled; this helper never patches or forwards
 * browser console output.
 */
export const capturePostHogLog = (input: PostHogLogInput) => {
  if (!initialized || !posthog || !allowsDiagnostics(readCookieConsent())) return;
  try {
    const record: CaptureLogOptions = {
      body: redactLogText(input.body),
      ...(input.level ? { level: input.level } : {}),
      ...(typeof input.trace_id === "string" && /^[0-9a-f]{32}$/i.test(input.trace_id)
        ? { trace_id: input.trace_id }
        : {}),
      ...(typeof input.span_id === "string" && /^[0-9a-f]{16}$/i.test(input.span_id)
        ? { span_id: input.span_id }
        : {}),
      ...(typeof input.trace_flags === "number" && Number.isFinite(input.trace_flags)
        ? { trace_flags: input.trace_flags }
        : {}),
      attributes: scrubLogAttributes(input.attributes),
    };
    posthog.captureLog(record);
  } catch (error) {
    // Observability must never break a user flow.
    console.warn("[posthog] log capture failed; continuing without logs.", error);
  }
};

const CSP_UNSAFE_EVAL_PATTERNS = [
  /unsafe-eval/i,
  /content security policy|content-security-policy|csp/i,
  /refused to evaluate a string as javascript/i,
];

const isCspUnsafeEvalMessage = (message: string) => {
  if (!message) return false;
  const normalizedMessage = message.trim();
  return (
    CSP_UNSAFE_EVAL_PATTERNS[0].test(normalizedMessage) &&
    CSP_UNSAFE_EVAL_PATTERNS[1].test(normalizedMessage) &&
    (
      CSP_UNSAFE_EVAL_PATTERNS[2].test(normalizedMessage) ||
      /call to eval\(\) blocked by csp/i.test(normalizedMessage) ||
      /disallowed string compilation/i.test(normalizedMessage)
    )
  );
};

const isCspUnsafeEvalError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return (
    (error instanceof Error && error.name === "EvalError") &&
    isCspUnsafeEvalMessage(message)
  );
};

// PostHog's exception feed has its own policy. Keep the expected borrower/item
// lookup miss out of it without suppressing other operational failures.
const shouldCapturePostHogException = (error: unknown) =>
  !(error instanceof AppError && error.code === "NOT_FOUND");

const cloneErrorForPostHog = (error: unknown, errorCode: PostHogErrorCode) => {
  if (!(error instanceof Error)) {
    const safeError = new Error(errorCode);
    safeError.name = "ItemTraxxClientError";
    return safeError;
  }

  // Keep the original message/stack for PostHog's source-map grouping, but do
  // not pass the application Error object (and its cause/custom fields) into a
  // third-party SDK or mutate it while normalizing its grouping name.
  const safeError = new Error(redactLogText(error.message, 2_000));
  safeError.name = error.name && error.name !== "Error"
    ? error.name
    : "ItemTraxxClientError";
  if (error.stack) safeError.stack = redactLogText(error.stack, 6_000);
  return safeError;
};

// PostHog's exception autocapture installs its own global onerror/onunhandledrejection
// handlers and reports directly, bypassing the guards in globalErrorHandling.ts and
// capturePostHogException. Drop the benign CSP unsafe-eval EvalError here too so the
// strict CSP (vercel.json) does not pollute the error feed.
const isCspUnsafeEvalExceptionEvent = (
  properties?: Record<string, unknown>
) => {
  if (!properties) return false;
  const exceptionList = properties.$exception_list;
  if (!Array.isArray(exceptionList)) return false;
  return exceptionList.some(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      (entry as { type?: unknown }).type === "EvalError" &&
      typeof (entry as { value?: unknown }).value === "string" &&
      isCspUnsafeEvalMessage((entry as { value: string }).value)
  );
};

// A script served cross-origin without CORS strips the error the browser hands
// to window.onerror down to a bare synthetic "Script error." with no message,
// source, or stack. These entries carry no information to triage, so drop them
// here. The crossorigin="anonymous" attribute on the Turnstile script
// (useTurnstile.ts) lets real errors through with a full stack instead.
const isOpaqueScriptExceptionEvent = (
  properties?: Record<string, unknown>,
) => {
  const exceptionList = properties?.$exception_list;
  if (!Array.isArray(exceptionList) || exceptionList.length !== 1) return false;
  const entry = exceptionList[0] as {
    value?: unknown;
    stacktrace?: { frames?: unknown[] };
    mechanism?: { synthetic?: unknown };
  } | null;
  if (!entry || typeof entry !== "object") return false;
  const frames = entry.stacktrace?.frames;
  return (
    typeof entry.value === "string" &&
    entry.value.trim() === "Script error." &&
    entry.mechanism?.synthetic === true &&
    (!Array.isArray(frames) || frames.length === 0)
  );
};

const isRecoverableChunkLoadExceptionEvent = (
  properties?: Record<string, unknown>,
) => {
  const exceptionList = properties?.$exception_list;
  if (!Array.isArray(exceptionList)) return false;
  return exceptionList.some(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      isRecoverableChunkLoadError((entry as { value?: unknown }).value),
  );
};

const initializePostHog = async () => {
  if (initialized) return;
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
  const consent = readCookieConsent();
  const analyticsAllowed = allowsAnalytics(consent);
  const diagnosticsAllowed = allowsDiagnostics(consent);
  if (!token || (!analyticsAllowed && !diagnosticsAllowed)) {
    clearReplaySessionHandoff();
    return;
  }
  try {
    posthog = (await import("posthog-js")).default;
    const currentConsent = readCookieConsent();
    const currentAnalyticsAllowed = allowsAnalytics(currentConsent);
    const currentDiagnosticsAllowed = allowsDiagnostics(currentConsent);
    const currentSessionReplayAllowed = allowsSessionReplay(currentConsent);
    if (!currentAnalyticsAllowed && !currentDiagnosticsAllowed) {
      clearReplaySessionHandoff();
      return;
    }
    // Replay is now strictly opt-in to both Analytics and Diagnostics. Any
    // handoff cookie from an older build must not re-enable it after a
    // redirect, so discard the bridge before initializing the SDK.
    clearReplaySessionHandoff();
    if (APP_VERSION !== "n/a" && typeof globalThis !== "undefined") {
      // posthog-cli uses this same runtime hook after source-map injection. Set
      // the build release only when no injected release row is present; the
      // CLI's ID is the authoritative source-map foreign key.
      const releaseTarget = globalThis as typeof globalThis & { _posthogReleaseId?: string };
      if (!releaseTarget._posthogReleaseId) releaseTarget._posthogReleaseId = APP_VERSION;
    }
    const posthogConfig: NonNullable<Parameters<typeof posthog.init>[1]> = {
      api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://j.itemtraxx.com",
      ui_host: "https://us.posthog.com",
      defaults: "2026-01-30",
      // Do not ingest Meta advertising identifiers from first-party _fbp/_fbc
      // cookies; ItemTraxx does not use campaign attribution.
      save_campaign_params: false,
      // Keep the identity/session cookie shared across itemtraxx.com and
      // workspace subdomains. The explicit conflict policy is required while
      // this app remains pinned to an older PostHog defaults snapshot; it
      // prevents a stale per-origin localStorage session from winning over
      // the shared cookie after a full-page workspace redirect.
      cross_subdomain_cookie: true,
      cookieWinsOnConflict: true,
      autocapture: false,
      rageclick: false,
      capture_pageview: currentAnalyticsAllowed ? "history_change" : false,
      capture_pageleave: currentAnalyticsAllowed,
      capture_dead_clicks: false,
      // Exception autocapture is diagnostics, not analytics. Keep the SDK's
      // global handlers disabled unless that separate consent is present.
      capture_exceptions: allowsDiagnostics(currentConsent) && !isLocalhostRuntime(),
      before_send: (event) => {
        if (!event) return null;
        if (event.event === "$exception" && isLocalhostRuntime()) return null;
        if (event.event === "$exception" && !allowsDiagnostics(readCookieConsent())) {
          return null;
        }
        const safeEvent: CaptureResult = {
          ...event,
          properties: (sanitizeRecoveryUrlProperties(event.properties) ?? {}) as
            CaptureResult["properties"],
        };
        if (
          safeEvent.event === "$exception" &&
          (
            isCspUnsafeEvalExceptionEvent(safeEvent.properties) ||
            isRecoverableChunkLoadExceptionEvent(safeEvent.properties) ||
            isOpaqueScriptExceptionEvent(safeEvent.properties)
          )
        ) {
          return null;
        }
        return sanitizeExceptionEvent(safeEvent);
      },
      logs: {
        serviceName: SERVICE_NAME,
        environment: APP_ENVIRONMENT,
        serviceVersion: APP_VERSION,
        resourceAttributes: {
          "deployment.environment": APP_ENVIRONMENT,
        },
        captureConsoleLogs: false,
        // Remote config can opt console capture back in; keep that alternate
        // sink disabled even if the project setting changes later. Explicit
        // capturePostHogLog calls are scrubbed before they reach the SDK.
        beforeSend: (record) => {
          if (!allowsDiagnostics(readCookieConsent())) return null;
          const rawAttributes = (record.attributes ?? {}) as Record<string, unknown>;
          if (typeof rawAttributes["log.source"] === "string" && rawAttributes["log.source"].startsWith("console.")) {
            return null;
          }
          return {
            ...record,
            body: redactLogText(record.body),
            attributes: scrubLogAttributes(rawAttributes),
          };
        },
      },
      // A diagnostics-only session uses an in-memory PostHog identity and has
      // no automatic analytics events. Explicit exception/log calls remain
      // gated by diagnostics consent below.
      persistence: currentAnalyticsAllowed ? "localStorage+cookie" : "memory",
      disable_persistence: !currentAnalyticsAllowed,
      // Replay requires both Analytics and Diagnostics consent. Keep input
      // values masked, but redact only explicitly marked borrower/user data so
      // the rest of the page stays useful in the replay viewer.
      disable_session_recording: !currentSessionReplayAllowed,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: SESSION_REPLAY_MASK_SELECTOR,
        // Explicitly disable the project-wide blanket attribute setting so it
        // cannot override the selective callback below and blank images/links.
        maskAllElementAttributes: false,
        maskAttributeFn: maskSessionReplayAttribute,
        // Network capture would put back the content that DOM masking removes.
        recordHeaders: false,
        recordBody: false,
        // Replay captures page and request URLs separately from event
        // properties. Redact reset-link and signed-storage query/hash material
        // at that boundary while keeping ordinary request URLs intact.
        maskCapturedNetworkRequestFn: (request) => {
          const safeName = scrubSensitiveReplayUrlValue(request.name);
          return safeName === request.name ? request : { ...request, name: safeName };
        },
      },
      disable_surveys: true,
      disable_surveys_automatic_display: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      advanced_disable_feature_flags: true,
      advanced_disable_feature_flags_on_first_load: true,
    };

    let resolvePostHogReady: (() => void) | null = null;
    posthogReady = false;
    posthogReadyPromise = new Promise<void>((resolve) => {
      resolvePostHogReady = resolve;
    });
    posthog.init(token, {
      ...posthogConfig,
      loaded: () => {
        initialized = true;
        posthogReady = true;
        resolvePostHogReady?.();
        resolvePostHogReady = null;
        posthogReadyPromise = null;
      },
    });
    initialized = true;
  } catch (error) {
    initialized = false;
    posthogReady = false;
    posthogReadyPromise = null;
    // Analytics must never break login or core flows.
    console.warn("[posthog] init failed; continuing without analytics.", error);
  }
};

export const initPostHog = async () => {
  if (initialized || posthogReadyPromise) return;
  if (!initializationPromise) initializationPromise = initializePostHog();
  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
};

const waitForPostHogReady = async () => {
  if (posthogReady) return true;
  if (initializationPromise) await initializationPromise;
  if (posthogReady) return true;
  if (posthogReadyPromise) await posthogReadyPromise;
  return posthogReady;
};

export const syncPostHogConsent = () => {
  if (!initialized || !posthog) return;
  try {
    const consent = readCookieConsent();
    const analyticsAllowed = allowsAnalytics(consent);
    const diagnosticsAllowed = allowsDiagnostics(consent);
    const sessionReplayAllowed = allowsSessionReplay(consent);
    posthog.set_config({
      capture_exceptions: diagnosticsAllowed && !isLocalhostRuntime(),
      capture_pageview: analyticsAllowed ? "history_change" : false,
      capture_pageleave: analyticsAllowed,
      disable_persistence: !analyticsAllowed,
      disable_session_recording: !sessionReplayAllowed,
    });
    if (!sessionReplayAllowed) clearReplaySessionHandoff();
    if (analyticsAllowed) {
      posthog.opt_in_capturing();
      if (sessionReplayAllowed) {
        posthog.startSessionRecording();
      } else {
        posthog.stopSessionRecording();
      }
      return;
    }
    if (diagnosticsAllowed) {
      // Keep the SDK able to deliver explicitly captured diagnostics without
      // enabling product analytics or writing a persistent identity.
      posthog.opt_in_capturing({ captureEventName: false });
      if (sessionReplayAllowed) {
        posthog.startSessionRecording();
      } else {
        posthog.stopSessionRecording();
      }
      return;
    }
    posthog.stopSessionRecording();
    posthog.opt_out_capturing();
  } catch (error) {
    console.warn("[posthog] consent sync failed; continuing without analytics.", error);
  }
};

export const capturePostHogEvent = (
  event: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) => {
  if (!initialized || !posthog || !allowsAnalytics(readCookieConsent())) return;
  try {
    posthog.capture(event, scrubProperties(properties));
  } catch (error) {
    console.warn("[posthog] capture failed; continuing without analytics.", error);
  }
};

export const identifyPostHogUser = (
  distinctId: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) => {
  if (!initialized || !posthog || !allowsAnalytics(readCookieConsent())) return;
  try {
    const safeProperties = scrubProperties(properties);
    if (EMAIL_PATTERN.test(distinctId)) {
      throw new Error("PostHog distinctId cannot be an email value. Please contact support.");
    }
    posthog.identify(distinctId, safeProperties);
  } catch (error) {
    console.warn("[posthog] identify failed; continuing without analytics.", error);
  }
};

export const resetPostHog = () => {
  clearReplaySessionHandoff();
  if (!initialized || !posthog) return;
  try {
    posthog.reset();
  } catch (error) {
    console.warn("[posthog] reset failed; continuing without analytics.", error);
  }
};

// A missing borrower/item lookup is an expected operator input outcome, not an
// exception. Other operational failures still belong in PostHog for diagnosis.
export const capturePostHogException = (
  error: unknown,
  additionalProperties?: Record<string, string | number | boolean | null | undefined>,
) => {
  if (
    isLocalhostRuntime() ||
    !initialized ||
    !posthog ||
    !allowsDiagnostics(readCookieConsent()) ||
    isCspUnsafeEvalError(error) ||
    !shouldCapturePostHogException(error)
  ) return;
  try {
    const errorCode = getPostHogErrorCode(error);
    const safeError = cloneErrorForPostHog(error, errorCode);
    const safeProperties = {
      ...(scrubProperties(additionalProperties) ?? {}),
      error_code: errorCode,
    };
    posthog.captureException(safeError, safeProperties);
  } catch (captureError) {
    console.warn("[posthog] exception capture failed; continuing without analytics. Please contact support.", captureError);
  }
};

export type HandledRequestFailure = {
  area: "edge_function" | "authenticated_data" | "http_session";
  name: string;
  path: string;
  method: string;
  status: number;
  message: string;
  errorCode?: PostHogErrorCode;
  requestId?: string;
};

const CRITICAL_EDGE_FUNCTIONS = new Set([
  "super-dashboard",
  "super-workspace-mutate",
  "admin-ops",
  "offline-checkout",
  "system-status",
  "workspace-admin-mutate",
  "privileged-step-up",
  "checkoutReturn",
]);

const CRITICAL_DATA_PATH_PATTERNS = [
  /^\/rest\/v1\/(profiles|borrowers|items|admin_audit_logs|audit_logs)(?:\/|$)/i,
  /^\/rest\/v1\/rpc\/consume_rate_limit(?:\/|$)/i,
  /^\/auth\/session\/(exchange|refresh)(?:\/|$)/i,
];

const CRITICAL_AUTH_PATH_PATTERNS = [
  /^\/api\/auth\//i,
];

const HANDLED_FAILURE_DEDUP_WINDOW_MS = 60_000;
const handledFailureSeenAt = new Map<string, number>();

const shouldCaptureHandledRequestFailure = (failure: HandledRequestFailure) => {
  if (failure.status >= 500) return true;
  if (failure.area === "edge_function") {
    if (failure.status === 0) return CRITICAL_EDGE_FUNCTIONS.has(failure.name);
    return (failure.status === 401 || failure.status === 403 || failure.status === 429) &&
      CRITICAL_EDGE_FUNCTIONS.has(failure.name);
  }
  if (failure.area === "http_session") {
    // Invalid credentials and expired sessions are expected auth outcomes. A
    // transport failure or a server error is actionable, so only promote those.
    return failure.status === 0 &&
      CRITICAL_AUTH_PATH_PATTERNS.some((pattern) => pattern.test(failure.path));
  }
  if (failure.status === 0) {
    return CRITICAL_DATA_PATH_PATTERNS.some((pattern) => pattern.test(failure.path));
  }
  return (failure.status === 401 || failure.status === 403 || failure.status === 429) &&
    CRITICAL_DATA_PATH_PATTERNS.some((pattern) => pattern.test(failure.path));
};

const getHandledRequestFailureCode = (failure: HandledRequestFailure): PostHogErrorCode => {
  if (failure.errorCode && isPostHogErrorCode(failure.errorCode)) return failure.errorCode;
  if (failure.status >= 500) return "server_error";
  if (failure.status === 0) {
    return /timed out|timeout/i.test(failure.message) ? "timeout" : "network";
  }
  if (failure.status === 429) return "rate_limit";
  if (failure.status === 401 || failure.status === 403) return "unauthorized";
  return "request_failed";
};

/** Capture an expected request failure at a high-value boundary without the raw response body. */
export const captureHandledRequestFailure = async (failure: HandledRequestFailure) => {
  if (isLocalhostRuntime() || !shouldCaptureHandledRequestFailure(failure)) return;
  if (!allowsDiagnostics(readCookieConsent())) return;
  await initPostHog();
  if (!(await waitForPostHogReady()) || !posthog) return;
  const errorCode = getHandledRequestFailureCode(failure);
  const path = failure.path.replace(/[?#].*$/, "");
  const dedupeKey = [
    failure.area,
    failure.name,
    failure.method.toUpperCase(),
    failure.status,
    errorCode,
    path,
  ].join(":");
  const now = Date.now();
  for (const [key, seenAt] of handledFailureSeenAt) {
    if (now - seenAt >= HANDLED_FAILURE_DEDUP_WINDOW_MS) handledFailureSeenAt.delete(key);
  }
  const previous = handledFailureSeenAt.get(dedupeKey);
  if (previous !== undefined && now - previous < HANDLED_FAILURE_DEDUP_WINDOW_MS) return;
  handledFailureSeenAt.set(dedupeKey, now);
  capturePostHogException(
    Object.assign(new Error(`Handled request failure: ${errorCode}`), {
      name: "ItemTraxxHandledRequestFailure",
      code: errorCode.toUpperCase(),
      status: failure.status,
    }),
    {
      error_code: errorCode,
      request_area: failure.area,
      request_operation: failure.name,
      request_method: failure.method.toUpperCase(),
      request_status: failure.status,
      request_id: failure.requestId,
      path,
    },
  );
};
