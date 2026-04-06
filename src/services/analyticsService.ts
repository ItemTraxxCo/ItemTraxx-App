import { allowsAnalytics, readCookieConsent } from "./cookieConsentService";

type AnalyticsEventProperties = Record<string, string | number | boolean | null>;

export const trackAnalyticsEvent = async (event: string, properties?: AnalyticsEventProperties) => {
  if (!allowsAnalytics(readCookieConsent())) {
    return;
  }
  const { track } = await import("@vercel/analytics");
  track(event, properties);
};
