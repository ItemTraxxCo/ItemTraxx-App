import { allowsAnalytics, readCookieConsent } from "./cookieConsentService";
import { isRecoverableChunkLoadError } from "./appErrorRecovery";
import type { CaptureResult } from "posthog-js";

let initialized = false;
let posthog: typeof import("posthog-js").default | null = null;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SENSITIVE_PROPERTY_KEY =
  /(email|phone|name|tenant|profile|borrower|user_id|address|token|secret|error_message|error_type|error_stack|error_context|error_cause|exception|message|stack|context|cause)/i;

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

const sanitizeExceptionEvent = (event: CaptureResult): CaptureResult => {
  if (event.event !== "$exception") return event;

  const properties = event.properties;
  const errorCode = isPostHogErrorCode(properties?.error_code)
    ? properties.error_code
    : "unknown_error";
  const safeProperties: CaptureResult["properties"] = {};
  if (typeof properties?.token === "string") {
    // PostHog requires its project token to remain on the event. It is not a
    // user/session bearer and is safe to preserve here.
    safeProperties.token = properties.token;
  }
  safeProperties.$exception_list = [
    {
      type: "ItemTraxxClientError",
      value: errorCode,
      mechanism: { type: "generic", handled: true, synthetic: true },
    },
  ];
  safeProperties.$exception_level = "error";
  safeProperties.error_code = errorCode;

  return { ...event, properties: safeProperties };
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

export const initPostHog = async () => {
  if (initialized) return;
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token || !allowsAnalytics(readCookieConsent())) return;
  try {
    posthog = (await import("posthog-js")).default;
    const posthogConfig: NonNullable<Parameters<typeof posthog.init>[1]> = {
      api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://j.itemtraxx.com",
      ui_host: "https://us.posthog.com",
      defaults: "2026-01-30",
      autocapture: false,
      rageclick: false,
      capture_pageview: "history_change",
      capture_pageleave: true,
      capture_dead_clicks: false,
      capture_exceptions: true,
      before_send: (event) => {
        if (!event) return null;
        if (
          event.event === "$exception" &&
          (
            isCspUnsafeEvalExceptionEvent(event.properties) ||
            isRecoverableChunkLoadExceptionEvent(event.properties)
          )
        ) {
          return null;
        }
        return sanitizeExceptionEvent(event);
      },
      logs: {
        captureConsoleLogs: false,
        // Remote config can opt console capture back in; keep that alternate
        // sink disabled even if the project setting changes later.
        beforeSend: () => null,
      },
      // Session replay is disabled globally: authenticated/admin DOM text can
      // contain support requests and other tenant-sensitive data that input
      // masking does not cover.
      disable_session_recording: true,
      disable_surveys: true,
      disable_surveys_automatic_display: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      advanced_disable_feature_flags: true,
      advanced_disable_feature_flags_on_first_load: true,
    };

    posthog.init(token, {
      ...posthogConfig,
      loaded: () => {
        initialized = true;
      },
    });
    initialized = true;
  } catch (error) {
    // Analytics must never break login or core flows.
    console.warn("[posthog] init failed; continuing without analytics.", error);
  }
};

export const syncPostHogConsent = () => {
  if (!initialized || !posthog) return;
  if (allowsAnalytics(readCookieConsent())) {
    posthog.opt_in_capturing();
    return;
  }
  posthog.opt_out_capturing();
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
  if (!initialized || !posthog) return;
  try {
    posthog.reset();
  } catch (error) {
    console.warn("[posthog] reset failed; continuing without analytics.", error);
  }
};

export const capturePostHogException = (error: unknown) => {
  if (!initialized || !posthog || !allowsAnalytics(readCookieConsent()) || isCspUnsafeEvalError(error)) return;
  try {
    const errorCode = getPostHogErrorCode(error);
    const safeError = new Error(errorCode);
    safeError.name = "ItemTraxxClientError";
    safeError.stack = undefined;
    posthog.captureException(safeError, { error_code: errorCode });
  } catch (captureError) {
    console.warn("[posthog] exception capture failed; continuing without analytics. Please contact support.", captureError);
  }
};
