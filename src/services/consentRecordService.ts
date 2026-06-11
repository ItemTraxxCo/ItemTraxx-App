import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  getOrCreateCookieConsentSubject,
  type CookieConsentPreferences,
} from "./cookieConsentService";

export const recordCookieConsent = async (
  preferences: CookieConsentPreferences,
  consentedAt: string,
) => {
  const result = await invokeEdgeFunction<{ data?: { recorded?: boolean } }>(
    "consent-record",
    {
      method: "POST",
      body: {
        subject_id: getOrCreateCookieConsentSubject(),
        consent_version: 2,
        analytics: preferences.analytics,
        diagnostics: preferences.diagnostics,
        consented_at: consentedAt,
      },
    },
  );
  if (!result.ok || result.data?.data?.recorded !== true) {
    throw new Error("Unable to confirm cookie consent record.");
  }
};
