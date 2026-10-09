import { allowsAnalytics, readCookieConsent } from "./cookieConsentService";
import type { BeforeSend } from "@vercel/analytics";
import { scrubSensitiveReplayUrlValue } from "./sessionReplayPrivacy";

type AnalyticsEventProperties = Record<string, string | number | boolean | null>;

export const sanitizeVercelAnalyticsEvent: BeforeSend = (event) => {
  const url = scrubSensitiveReplayUrlValue(event.url);
  return url === event.url ? event : { ...event, url };
};

export const trackAnalyticsEvent = async (event: string, properties?: AnalyticsEventProperties) => {
  if (!allowsAnalytics(readCookieConsent())) {
    return;
  }
  const { track } = await import("@vercel/analytics");
  track(event, properties);
};
