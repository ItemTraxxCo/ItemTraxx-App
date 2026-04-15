import posthog from "posthog-js";

let initialized = false;

export const initPostHog = () => {
  if (initialized) return;
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return;
  posthog.init(token, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    defaults: "2026-01-30",
  });
  initialized = true;
};

export const capturePostHogEvent = (
  event: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) => {
  if (!initialized) return;
  posthog.capture(event, properties);
};

export const identifyPostHogUser = (
  distinctId: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) => {
  if (!initialized) return;
  posthog.identify(distinctId, properties);
};

export const resetPostHog = () => {
  if (!initialized) return;
  posthog.reset();
};

export const capturePostHogException = (error: unknown) => {
  if (!initialized) return;
  posthog.captureException(error);
};
