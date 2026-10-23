import { computed, onMounted, onScopeDispose, ref, watch, type Ref } from "vue";
import {
  allowsAnalytics,
  clearAnalyticsPersistence,
  hasCookieConsent,
  readCookieConsent,
  subscribeCookieConsent,
  writeCookieConsent,
  type CookieConsentPreferences,
  type CookieConsentState,
} from "../services/cookieConsentService";

type ConsentAuthState = {
  role: string | null;
};

export const useCookieConsentTelemetry = (auth: ConsentAuthState) => {
  const cookieConsent: Ref<CookieConsentState | null> = ref(null);
  const showTelemetry = ref(false);
  const showCookieConsentBanner = computed(() => !hasCookieConsent(cookieConsent.value));
  let unsubscribeCookieConsent: (() => void) | null = null;

  const sync = () => {
    cookieConsent.value = readCookieConsent();
    showTelemetry.value = allowsAnalytics(cookieConsent.value);
    if (!showTelemetry.value) clearAnalyticsPersistence();
  };

  const syncConsentRecord = () => {
    const state = cookieConsent.value;
    if (!state) return;
    void import("../services/consentRecordService")
      .then(({ recordCookieConsent }) =>
        recordCookieConsent(state.preferences, state.updatedAt),
      )
      .catch(() => {
        // Consent remains effective locally if the audit mirror is temporarily unavailable.
      });
  };

  const savePreferences = (preferences: CookieConsentPreferences) => {
    writeCookieConsent(preferences);
    sync();
    syncConsentRecord();
  };

  const acceptEssentialOnly = () => {
    savePreferences({ analytics: false, diagnostics: false });
  };

  const acceptAll = () => {
    savePreferences({ analytics: true, diagnostics: true });
  };

  watch(() => auth.role, syncConsentRecord);

  onMounted(() => {
    sync();
    unsubscribeCookieConsent = subscribeCookieConsent((state) => {
      cookieConsent.value = state;
      showTelemetry.value = allowsAnalytics(state);
      if (!showTelemetry.value) clearAnalyticsPersistence();
    });
  });

  onScopeDispose(() => {
    unsubscribeCookieConsent?.();
    unsubscribeCookieConsent = null;
  });

  return {
    acceptAll,
    acceptEssentialOnly,
    cookieConsent,
    savePreferences,
    showCookieConsentBanner,
    showTelemetry,
    sync,
  };
};
