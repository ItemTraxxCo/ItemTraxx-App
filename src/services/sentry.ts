import type { App } from "vue";
import type { Router } from "vue-router";

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

const replayEnabled =
  (Number.isFinite(SENTRY_REPLAY_SESSION_SAMPLE_RATE) && SENTRY_REPLAY_SESSION_SAMPLE_RATE > 0) ||
  (Number.isFinite(SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE) && SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE > 0);

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
  if (!SENTRY_DSN || !replayEnabled) {
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

export const initializeSentry = async (app: App, router: Router) => {
  if (!SENTRY_DSN) {
    return;
  }

  const Sentry = await import("@sentry/vue");

  Sentry.init({
    app,
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: APP_VERSION === "n/a" ? undefined : APP_VERSION,
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration({ router })],
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
  });

  void loadSentryReplay();
};
