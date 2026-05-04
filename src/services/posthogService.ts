import posthog from "posthog-js";

let initialized = false;

const isCspUnsafeEvalError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Refused to evaluate a string as JavaScript") &&
    message.includes("unsafe-eval") &&
    message.includes("Content Security Policy")
  );
};

export const initPostHog = async () => {
  if (initialized) return;
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return;
  try {
    const posthogConfig: NonNullable<Parameters<typeof posthog.init>[1]> = {
      api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
      defaults: "2026-01-30",
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
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

export const capturePostHogEvent = (
  event: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) => {
  if (!initialized) return;
  try {
    posthog.capture(event, properties);
  } catch (error) {
    console.warn("[posthog] capture failed; continuing without analytics.", error);
  }
};

export const identifyPostHogUser = (
  distinctId: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) => {
  if (!initialized) return;
  try {
    posthog.identify(distinctId, properties);
  } catch (error) {
    console.warn("[posthog] identify failed; continuing without analytics.", error);
  }
};

export const resetPostHog = () => {
  if (!initialized) return;
  try {
    posthog.reset();
  } catch (error) {
    console.warn("[posthog] reset failed; continuing without analytics.", error);
  }
};

export const capturePostHogException = (error: unknown) => {
  if (!initialized || isCspUnsafeEvalError(error)) return;
  try {
    posthog.captureException(error);
  } catch (captureError) {
    console.warn("[posthog] exception capture failed; continuing without analytics.", captureError);
  }
};
