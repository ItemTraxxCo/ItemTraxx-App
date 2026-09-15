import type { App } from "vue";
import type { Router } from "vue-router";
import {
  allowsAnalytics,
  allowsDiagnostics,
  readCookieConsent,
  subscribeCookieConsent,
} from "../services/cookieConsentService";

export const createClientMonitoring = (router: Router) => {
  let appMounted = false;
  let posthogServicePromise: Promise<typeof import("../services/posthogService")> | null = null;
  let unsubscribeConsent: (() => void) | null = null;

  const initializeSentry = async (app: App) => {
    if (!import.meta.env.VITE_SENTRY_DSN?.trim() || !allowsDiagnostics(readCookieConsent())) {
      return;
    }
    try {
      const { initializeSentry: initializeSentryMonitoring } = await import("../services/sentry");
      await initializeSentryMonitoring(app, router, appMounted);
    } catch (error) {
      // Diagnostics must never break login or core flows.
      console.warn("[sentry] initialization failed; continuing without diagnostics.", error);
    }
  };

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
    if (!import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim() || !allowsAnalytics(readCookieConsent())) {
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

  const bindConsentDrivenMonitoring = (app: App) => {
    const maybeEnableDiagnostics = () => {
      if (!allowsDiagnostics(readCookieConsent())) {
        return;
      }
      void initializeSentry(app);
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
    initializeBeforeMount: (app: App) => initializeSentry(app),
    initializeAfterMount: (app: App) => {
      appMounted = true;
      void initializeClientDiagnostics().catch(() => undefined);
      void import("../services/globalErrorHandling")
        .then(({ installGlobalErrorHandling }) => installGlobalErrorHandling(app))
        .catch(() => undefined);
      void initializePostHog();
      bindConsentDrivenMonitoring(app);
    },
  };
};
