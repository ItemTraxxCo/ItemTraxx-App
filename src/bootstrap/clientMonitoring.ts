import type { App } from "vue";
import type { Router } from "vue-router";
import {
  allowsAnalytics,
  allowsDiagnostics,
  readCookieConsent,
  subscribeCookieConsent,
} from "../services/cookieConsentService";

export const createClientMonitoring = (router: Router) => {
  let posthogServicePromise: Promise<typeof import("../services/posthogService")> | null = null;
  let unsubscribeConsent: (() => void) | null = null;

  void router;

  const loadPostHogService = () => {
    if (!posthogServicePromise) {
      posthogServicePromise = import("../services/posthogService").catch((error) => {
        posthogServicePromise = null;
        throw error;
      });
    }
    return posthogServicePromise;
  };

  const initializePostHog = async () => {
    const consent = readCookieConsent();
    if (
      !import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim() ||
      (!allowsAnalytics(consent) && !allowsDiagnostics(consent))
    ) {
      return;
    }
    try {
      const { initPostHog, syncPostHogConsent } = await loadPostHogService();
      await initPostHog();
      // Reconcile the consent cookie immediately after init. PostHog keeps
      // opt-in/opt-out state in origin-local persistence, so a stale opt-out
      // from this host must not suppress an otherwise-consented replay.
      syncPostHogConsent();
    } catch (error) {
      // Analytics must never break login or core flows.
      console.warn("[posthog] initialization failed; continuing without analytics.", error);
    }
  };

  const initializeClientDiagnostics = async () => {
    if (!allowsDiagnostics(readCookieConsent())) {
      return;
    }
    try {
      const { installClientDiagnostics } = await import("../services/clientDiagnostics");
      installClientDiagnostics();
    } catch (error) {
      // Diagnostics must never break login or core flows.
      console.warn("[diagnostics] initialization failed; continuing without diagnostics.", error);
    }
  };

  const getPostHogExceptionCapture = async () => {
    if (!allowsDiagnostics(readCookieConsent())) {
      return () => undefined;
    }
    return loadPostHogService()
      .then((module) => module.capturePostHogException)
      .catch(() => () => undefined);
  };

  const captureException = (error: unknown) => {
    void getPostHogExceptionCapture().then((capture) => capture(error));
  };

  const bindConsentDrivenMonitoring = (_app: App) => {
    const maybeEnableDiagnostics = () => {
      if (!allowsDiagnostics(readCookieConsent())) {
        return;
      }
      void initializePostHog();
      void initializeClientDiagnostics();
    };

    const maybeEnableAnalytics = () => {
      if (allowsAnalytics(readCookieConsent())) {
        void loadPostHogService()
          .then(({ syncPostHogConsent }) => {
            syncPostHogConsent();
            void initializePostHog();
          })
          .catch((error) => {
            console.warn("[posthog] consent sync failed; continuing without analytics.", error);
          });
        return;
      }
      if (posthogServicePromise) {
        void posthogServicePromise
          .then(({ syncPostHogConsent }) => syncPostHogConsent())
          .catch(() => undefined);
      }
    };

    // Consent is stored in a domain cookie, so a window event alone misses
    // changes made in another tab or on another ItemTraxx subdomain. The
    // shared subscription uses same-origin storage/focus signals plus a small
    // cookie poll to stop replay and update PostHog after revocation.
    unsubscribeConsent?.();
    unsubscribeConsent = subscribeCookieConsent(() => {
      maybeEnableDiagnostics();
      maybeEnableAnalytics();
    });
  };

  return {
    captureException,
    // Load PostHog before mount when analytics consent is already present so
    // its native window.onerror and unhandledrejection hooks cover the full
    // application lifetime. With no consent this remains a no-op.
    initializeBeforeMount: (_app: App) => initializePostHog(),
    initializeAfterMount: (app: App) => {
      void initializeClientDiagnostics().catch(() => undefined);
      void import("../services/globalErrorHandling")
        .then(({ installGlobalErrorHandling }) => installGlobalErrorHandling(app))
        .catch(() => undefined);
      void initializePostHog();
      bindConsentDrivenMonitoring(app);
    },
  };
};
