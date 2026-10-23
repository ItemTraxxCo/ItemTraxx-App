import { allowsDiagnostics, readCookieConsent } from "./cookieConsentService";
import type { HandledRequestFailure } from "./posthogService";
import type { CaptureLogOptions } from "posthog-js";

type PostHogLogInput = Omit<CaptureLogOptions, "body" | "attributes"> & {
  body: string;
  attributes?: Record<string, unknown>;
};

/**
 * Keep shared request clients independent from the PostHog bundle. Public
 * bootstrap paths call these helpers before consent exists; only an opted-in
 * diagnostics session loads the provider module.
 */
export const capturePostHogLog = (input: PostHogLogInput) => {
  if (!allowsDiagnostics(readCookieConsent())) return;
  void import("./posthogService")
    .then(({ capturePostHogLog: capture }) => capture(input))
    .catch(() => undefined);
};

export const captureHandledRequestFailure = (failure: HandledRequestFailure) => {
  if (!allowsDiagnostics(readCookieConsent())) return Promise.resolve();
  return import("./posthogService")
    .then(({ captureHandledRequestFailure: capture }) => capture(failure))
    .catch(() => undefined);
};
