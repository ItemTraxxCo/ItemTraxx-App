import { createApp } from "vue";
import * as Sentry from "@sentry/vue";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import {
  clearAuthState,
  getAuthState,
  markAdminVerified,
  setDistrictContext,
  setAuthStateFromBackend,
  setSecondaryAuth,
  setTenantContext,
} from "./store/authState";
import { getDistrictState } from "./store/districtState";
import {
  consumeDistrictSessionHandoff,
  initAuthListener,
  refreshAuthFromSession,
} from "./services/authService";
import { touchTenantAdminSession } from "./services/adminOpsService";
import { TimeoutError, withTimeout } from "./services/asyncUtils";
import {
  captureInitialPerfMetrics,
  markRouteNavigationEnd,
  markRouteNavigationStart,
} from "./services/perfTelemetry";
import { initializeDistrictContext } from "./services/districtService";

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

declare global {
  interface Window {
    __itemtraxxTest?: {
      setTenantUserSession: (tenantId?: string) => void;
      setTenantAdminSession: (tenantId?: string) => void;
      setSuperAdminSession: () => void;
      clearSession: () => void;
      navigate: (path: string) => Promise<void>;
    };
  }
}

const attachE2EControls = () => {
  if (import.meta.env.VITE_E2E_TEST_UTILS !== "true") {
    return;
  }

  window.__itemtraxxTest = {
    setTenantUserSession(tenantId = "tenant-e2e") {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-tenant",
        email: "tenant.user@example.com",
        signedInAt: new Date().toISOString(),
        role: "tenant_user",
        sessionTenantId: tenantId,
        tenantContextId: tenantId,
        districtContextId: null,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
      });
      setTenantContext(tenantId);
    },
    setTenantAdminSession(tenantId = "tenant-e2e") {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-admin",
        email: "tenant.admin@example.com",
        signedInAt: new Date().toISOString(),
        role: "tenant_admin",
        sessionTenantId: tenantId,
        tenantContextId: tenantId,
        districtContextId: null,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
      });
      setTenantContext(tenantId);
      markAdminVerified();
    },
    setSuperAdminSession() {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-super",
        email: "super.admin@example.com",
        signedInAt: new Date().toISOString(),
        role: "super_admin",
        sessionTenantId: null,
        tenantContextId: null,
        districtContextId: null,
        hasSecondaryAuth: true,
      });
      setSecondaryAuth(true);
    },
    clearSession() {
      clearAuthState(true);
      setTenantContext(null);
      setDistrictContext(null);
    },
    async navigate(path: string) {
      await router.push(path);
    },
  };
};

const PUBLIC_BOOTSTRAP_PATHS = new Set(["/", "/login", "/legal", "/reset-password"]);

const redirectCanonicalHost = () => {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  if (hostname !== "www.itemtraxx.com") {
    return false;
  }
  const target = new URL(window.location.href);
  target.hostname = "itemtraxx.com";
  window.location.replace(target.toString());
  return true;
};

const isPublicBootstrapPath = () => {
  const path = window.location.pathname || "/";
  if (PUBLIC_BOOTSTRAP_PATHS.has(path)) {
    return true;
  }
  return false;
};

const initializeAuth = async () => {
  const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";
  if (isE2ETestMode) {
    clearAuthState(true);
    return;
  }

  try {
    await withTimeout(
      refreshAuthFromSession(),
      6000,
      "Authentication initialization timed out."
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error("Auth initialization timeout:", error.message);
    } else {
      console.error("Auth initialization failed:", error);
    }
  } finally {
    if (!getAuthState().isInitialized) {
      clearAuthState(true);
    }
  }
  initAuthListener();
};

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

const initializeSentry = (app: ReturnType<typeof createApp>) => {
  if (!SENTRY_DSN) {
    return;
  }

  Sentry.init({
    app,
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: APP_VERSION === "n/a" ? undefined : APP_VERSION,
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration({ router }),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
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
};

const mountApp = () => {
  markRouteNavigationStart();
  router.beforeEach((_to, _from, next) => {
    markRouteNavigationStart();
    next();
  });
  router.afterEach((to) => {
    markRouteNavigationEnd(to.fullPath);
  });

  const app = createApp(App);
  initializeSentry(app);
  app.use(router);
  app.mount("#app");
  captureInitialPerfMetrics();
  attachE2EControls();
};

const bootstrap = async () => {
  if (redirectCanonicalHost()) {
    return;
  }
  const consumedDistrictHandoff = await consumeDistrictSessionHandoff();
  await initializeDistrictContext();
  const districtContext = getDistrictState();
  const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";
  const canMountFirst =
    isE2ETestMode || isPublicBootstrapPath() || districtContext.isDistrictHost;
  if (canMountFirst) {
    // Avoid flashing the temporary logout screen during normal public-route bootstrap.
    if (!isE2ETestMode && isPublicBootstrapPath()) {
      clearAuthState(true);
    }
    mountApp();
    void initializeAuth();
    if (consumedDistrictHandoff) {
      void touchTenantAdminSession().catch(() => {
        // Best-effort session registration after district handoff.
      });
    }
    return;
  }
  await initializeAuth();
  if (consumedDistrictHandoff) {
    void touchTenantAdminSession().catch(() => {
      // Best-effort session registration after district handoff.
    });
  }
  mountApp();
};

bootstrap();
