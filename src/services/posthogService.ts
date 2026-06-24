import { allowsAnalytics, readCookieConsent } from "./cookieConsentService";

let initialized = false;
let posthog: typeof import("posthog-js").default | null = null;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SENSITIVE_PROPERTY_KEY = /(email|phone|name|tenant|profile|student|user_id|address|token|secret)/i;

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

const isCspUnsafeEvalMessage = (message: string) =>
  message.includes("Refused to evaluate a string as JavaScript") &&
  message.includes("unsafe-eval") &&
  message.includes("Content Security Policy");

const isCspUnsafeEvalError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return isCspUnsafeEvalMessage(message);
};

// PostHog's exception autocapture installs its own global onerror/onunhandledrejection
// handlers and reports directly, bypassing the guards in globalErrorHandling.ts and
// capturePostHogException. Drop the benign CSP unsafe-eval EvalError here too so the
// strict CSP (vercel.json) does not pollute the error feed.
const isCspUnsafeEvalExceptionEvent = (
  properties?: Record<string, unknown>
) => {
  if (!properties) return false;
  const candidates: unknown[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) candidates.push(...value);
  };
  collect(properties.$exception_values);
  collect(properties.$exception_types);
  const exceptionList = properties.$exception_list;
  if (Array.isArray(exceptionList)) {
    for (const entry of exceptionList) {
      if (entry && typeof entry === "object") {
        candidates.push((entry as { value?: unknown }).value);
        candidates.push((entry as { type?: unknown }).type);
      }
    }
  }
  return candidates.some(
    (candidate) => typeof candidate === "string" && isCspUnsafeEvalMessage(candidate)
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
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_exceptions: true,
      before_send: (event) => {
        if (
          event?.event === "$exception" &&
          isCspUnsafeEvalExceptionEvent(event.properties)
        ) {
          return null;
        }
        return event;
      },
      logs: {
        captureConsoleLogs: true,
      },
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
      },
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
      throw new Error("PostHog distinctId cannot be an email value.");
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
    posthog.captureException(error);
  } catch (captureError) {
    console.warn("[posthog] exception capture failed; continuing without analytics.", captureError);
  }
};
