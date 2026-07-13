import type { App } from "vue";
import type { Router } from "vue-router";
import {
  allowsAnalytics,
  allowsDiagnostics,
  readCookieConsent,
} from "../services/cookieConsentService";

export const createClientMonitoring = (router: Router) => {
  let appMounted = false;
  let posthogServicePromise: Promise<typeof import("../services/posthogService")> | null = null;

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
      const { initPostHog } = await loadPostHogService();
      await initPostHog();
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
    if (!allowsAnalytics(readCookieConsent())) {
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

    window.addEventListener("itemtraxx:cookie-consent", maybeEnableDiagnostics);
    window.addEventListener("itemtraxx:cookie-consent", maybeEnableAnalytics);
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
      void import("../services/appErrorRecovery")
        .then(({ installAppErrorRecovery }) => installAppErrorRecovery(router))
        .catch(() => undefined);
      void initializePostHog();
      bindConsentDrivenMonitoring(app);
    },
  };
};
