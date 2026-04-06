import type { App } from "vue";
import type { Router } from "vue-router";
import { shouldReportError } from "./appErrors";
import { allowsDiagnostics, allowsSessionReplay, readCookieConsent } from "./cookieConsentService";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN?.trim();
const SENTRY_ENVIRONMENT = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE;
const SENTRY_TRACES_SAMPLE_RATE = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? "0.1");
const SENTRY_REPLAY_SESSION_SAMPLE_RATE = Number(
  import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? "0"
);
const SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE = Number(
  import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? "0.1"
);
const APP_VERSION = import.meta.env.VITE_GIT_COMMIT || "n/a";
const SENTRY_ENABLE_LOGS = (import.meta.env.VITE_SENTRY_ENABLE_LOGS ?? "true") !== "false";

const replayEnabled =
  (Number.isFinite(SENTRY_REPLAY_SESSION_SAMPLE_RATE) && SENTRY_REPLAY_SESSION_SAMPLE_RATE > 0) ||
  (Number.isFinite(SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE) && SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE > 0);

let sentryInitialized = false;

const getTracePropagationTargets = () => {
  const targets: Array<string | RegExp> = ["localhost"];
  const appUrl = import.meta.env.VITE_APP_URL?.trim();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();

  for (const candidate of [appUrl, supabaseUrl]) {
    if (!candidate) continue;
    try {
      targets.push(new URL(candidate).origin);
    } catch {
      // Ignore invalid env values and keep the rest of the tracing setup intact.
    }
  }

  return targets;
};

const loadSentryReplay = async () => {
  if (!SENTRY_DSN || !replayEnabled || !allowsSessionReplay(readCookieConsent())) {
    return;
  }

  try {
    const { addIntegration, replayIntegration } = await import("@sentry/browser");
    addIntegration(
      replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      })
    );
  } catch (error) {
    console.warn("Sentry Replay failed to load.", error);
  }
};

const isLocalDevelopmentUrl = (url?: string | null) =>
  !!url && (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost"));

const isExpectedUnauthorizedAuthEvent = (event: {
  exception?: { values?: Array<{ value?: string; stacktrace?: { frames?: Array<{ module?: string }> } }> };
  request?: { url?: string };
  environment?: string;
}) => {
  const topException = event.exception?.values?.[0];
  const message = topException?.value?.trim().toLowerCase();
  if (message !== "unauthorized" && message !== "unauthorized.") {
    return false;
  }

  const frames = topException?.stacktrace?.frames ?? [];
  const sessionAuthFrame = frames.some((frame) =>
    frame.module?.includes("src/services/sessionAccessToken")
  );

  if (!sessionAuthFrame) {
    return false;
  }

  return event.environment === "development" || isLocalDevelopmentUrl(event.request?.url);
};



type HandledRequestFailure = {
  area: "edge_function" | "authenticated_data" | "http_session";
  name: string;
  path: string;
  method: string;
  status: number;
  message: string;
  requestId?: string;
};

const CRITICAL_EDGE_FUNCTIONS = new Set([
  "super-dashboard",
  "district-dashboard",
  "admin-ops",
  "privileged-step-up",
  "district-handoff",
  "tenant-login",
  "super-auth-verify",
  "checkoutReturn",
]);

const CRITICAL_DATA_PATH_PATTERNS = [
  /^\/rest\/v1\/(profiles|students|gear|admin_audit_logs|audit_logs)/i,
  /^\/rest\/v1\/rpc\/(consume_rate_limit)/i,
  /^\/auth\/session\/(exchange|refresh)/i,
];

const shouldCaptureHandledRequestFailure = (failure: HandledRequestFailure) => {
  if (failure.status >= 500) {
    return true;
  }

  if (failure.area === "edge_function") {
    if ((failure.status === 401 || failure.status === 403 || failure.status === 429) &&
      CRITICAL_EDGE_FUNCTIONS.has(failure.name)) {
      return true;
    }
    return false;
  }

  if ((failure.status === 401 || failure.status === 403 || failure.status === 429) &&
    CRITICAL_DATA_PATH_PATTERNS.some((pattern) => pattern.test(failure.path))) {
    return true;
  }

  return false;
};

export const captureHandledRequestFailure = async (failure: HandledRequestFailure) => {
  if (!SENTRY_DSN || !sentryInitialized || !shouldCaptureHandledRequestFailure(failure)) {
    return;
  }

  const Sentry = await import("@sentry/vue");
  const error = new Error(failure.message || `Handled request failure (${failure.status}).`);
  error.name = "HandledRequestFailure";

  Sentry.captureException(error, {
    tags: {
      handled_request: "true",
      request_area: failure.area,
      request_name: failure.name,
      request_method: failure.method,
      request_status: String(failure.status),
    },
    level: failure.status >= 500 ? "error" : "warning",
    extra: {
      path: failure.path,
      requestId: failure.requestId,
    },
  });
};
export const initializeSentry = async (app: App, router: Router) => {
  if (!SENTRY_DSN || sentryInitialized || !allowsDiagnostics(readCookieConsent())) {
    return;
  }

  const Sentry = await import("@sentry/vue");

  Sentry.init({
    app,
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: APP_VERSION === "n/a" ? undefined : APP_VERSION,
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration({ router }),
      ...(SENTRY_ENABLE_LOGS
        ? [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })]
        : []),
    ],
    enableLogs: SENTRY_ENABLE_LOGS,
    tracesSampleRate:
      Number.isFinite(SENTRY_TRACES_SAMPLE_RATE) && SENTRY_TRACES_SAMPLE_RATE >= 0
        ? SENTRY_TRACES_SAMPLE_RATE
        : 0.1,
    replaysSessionSampleRate:
      Number.isFinite(SENTRY_REPLAY_SESSION_SAMPLE_RATE) &&
      SENTRY_REPLAY_SESSION_SAMPLE_RATE >= 0
        ? SENTRY_REPLAY_SESSION_SAMPLE_RATE
        : 0,
    replaysOnErrorSampleRate:
      Number.isFinite(SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE) &&
      SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE >= 0
        ? SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE
        : 0.1,
    tracePropagationTargets: getTracePropagationTargets(),
    beforeSend(event, hint) {
      if (!shouldReportError(hint.originalException)) {
        return null;
      }
      if (isExpectedUnauthorizedAuthEvent(event)) {
        return null;
      }
      return event;
    },
  });

  sentryInitialized = true;
  void loadSentryReplay();
};
