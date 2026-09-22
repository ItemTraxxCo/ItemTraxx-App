import { createApp } from "vue";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app-shell.css";
import "./bones/registry";
import App from "./App.vue";
import router from "./router";
import { clearAuthState } from "./store/authState";
import { getWorkspaceState } from "./store/workspaceState";
import { refreshPublicAuthFromSession, scrubLegacyAuthFragment } from "./services/publicAuthBootstrap";
import { isSessionNetworkError } from "./services/httpSessionService";
import { TimeoutError, withTimeout } from "./services/asyncUtils";
import {
  captureInitialPerfMetrics,
  markRouteNavigationEnd,
  markRouteNavigationStart,
} from "./services/perfTelemetry";
import { initializeWorkspaceContext } from "./services/workspaceService";
import { routeRecoveryLinksToResetPassword } from "./utils/passwordResetRedirect";
import { finishRouteLoading, startRouteLoading } from "./store/routeLoading";
import { installAppErrorRecovery } from "./services/appErrorRecovery";
import { isPublicBootstrapRoute } from "./bootstrap/routeBootstrap";
import { createClientMonitoring } from "./bootstrap/clientMonitoring";
import { markAgentFallbackMounted } from "./bootstrap/agentFallback";

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

const reportAuthInitFailure = (error: unknown) => {
  if (error instanceof TimeoutError) {
    console.error("Auth initialization timeout:", error.message);
    return;
  }
  if (isSessionNetworkError(error)) {
    // A failed session read is not proof that the browser session has expired.
    console.warn("Auth initialization deferred; session could not be read:", error.message);
    return;
  }
  console.error("Auth initialization failed:", error);
};

const initializeAuth = async () => {
  const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";
  if (isE2ETestMode) {
    clearAuthState(true);
    return;
  }

  const authInitController = new AbortController();
  try {
    const authService = await withTimeout(
      import("./services/authService").then(async (authService) => {
        await authService.refreshAuthFromSession({ signal: authInitController.signal });
        return authService;
      }),
      6000,
      "Authentication initialization timed out."
    );
    authService.initAuthListener();
  } catch (error) {
    authInitController.abort();
    reportAuthInitFailure(error);
    startSessionRecovery(async () => {
      const authService = await import("./services/authService");
      await authService.refreshAuthFromSession();
      authService.initAuthListener();
    });
  }
};

const initializePublicAuth = async () => {
  document.documentElement.dataset.itemtraxxPublicAuth = "pending";
  const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";
  const publicAuthController = new AbortController();
  if (isE2ETestMode) {
    clearAuthState(true);
  }

  try {
    await withTimeout(
      refreshPublicAuthFromSession(publicAuthController.signal),
      6000,
      "Authentication initialization timed out."
    );
  } catch (error) {
    reportAuthInitFailure(error);
    startSessionRecovery(async () => {
      await refreshPublicAuthFromSession();
    });
  } finally {
    publicAuthController.abort();
    document.documentElement.dataset.itemtraxxPublicAuth = "settled";
  }
};

const clientMonitoring = createClientMonitoring(router);
installAppErrorRecovery(router);

const revalidateCurrentRoute = async () => {
  const currentRoute = router.currentRoute.value;
  await router.replace({
    path: currentRoute.path,
    query: currentRoute.query,
    hash: currentRoute.hash,
    state: { __itemtraxxAuthRecheck: Date.now() },
  });
};

let appMounted = false;
let authRecoveryResolvedBeforeMount = false;
let stopSessionRecovery: (() => void) | null = null;

const startSessionRecovery = (refresh: () => Promise<void>) => {
  if (stopSessionRecovery) return;

  let inFlight = false;
  let retryTimeoutId: number | null = null;
  let retryDelayMs = 5000;
  let retryNow: () => void;
  const scheduleRetry = () => {
    if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
    retryTimeoutId = window.setTimeout(retryNow, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, 60000);
  };
  const retryOnOnline = () => {
    retryDelayMs = 5000;
    retryNow();
  };
  const stop = () => {
    window.removeEventListener("online", retryOnOnline);
    if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
    if (stopSessionRecovery === stop) stopSessionRecovery = null;
  };
  retryNow = () => {
    if (inFlight) return;
    if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
    inFlight = true;
    void refresh()
      .then(async () => {
        stop();
        if (appMounted) await revalidateCurrentRoute();
        else authRecoveryResolvedBeforeMount = true;
      })
      .catch(() => {
        // Keep the session unresolved and retry with a bounded backoff.
        scheduleRetry();
      })
      .finally(() => {
        inFlight = false;
      });
  };

  stopSessionRecovery = stop;
  window.addEventListener("online", retryOnOnline);
  scheduleRetry();
};

const mountApp = async () => {
  markRouteNavigationStart();
  router.beforeEach((_to, _from, next) => {
    startRouteLoading();
    markRouteNavigationStart();
    next();
  });
  router.afterEach((to) => {
    markRouteNavigationEnd(to.fullPath);
    finishRouteLoading();
  });
  router.onError(() => {
    finishRouteLoading();
  });

  const app = createApp(App);
  const existingErrorHandler = app.config.errorHandler;
  app.config.errorHandler = (error, instance, info) => {
    clientMonitoring.captureException(error);
    if (existingErrorHandler) {
      existingErrorHandler(error, instance, info);
    }
  };
  app.use(router);
  await router.isReady();
  // The first history entry may have resolved before auth bootstrap settled.
  // A history-state-only replace forces the guards to re-evaluate the exact
  // visible URL without adding a query marker or a browser-history entry.
  await revalidateCurrentRoute();
  await clientMonitoring.initializeBeforeMount(app);
  app.mount("#app");
  appMounted = true;
  if (authRecoveryResolvedBeforeMount) {
    authRecoveryResolvedBeforeMount = false;
    void revalidateCurrentRoute();
  }
  markAgentFallbackMounted();
  clientMonitoring.initializeAfterMount(app);
  captureInitialPerfMetrics();
  if (import.meta.env.VITE_E2E_TEST_UTILS === "true") {
    const { attachE2EControls } = await import("./e2e/testControls");
    attachE2EControls(router);

    // Boneyard captures protected pages through the existing E2E controls. This
    // branch is only present in the non-production E2E build and is activated
    // by the query string used in boneyard.config.json.
    const captureRole = new URLSearchParams(window.location.search).get("boneyard");
    if (captureRole) {
      // The protected route guard normally lazy-loads this stylesheet after a
      // real authenticated navigation. Capture mode seeds auth after mount, so
      // load it explicitly to keep fixture geometry identical to production.
      await import("./styles/authenticated.css");
      window.setTimeout(() => {
        if (captureRole === "super-admin") {
          window.__itemtraxxTest?.setSuperAdminSession();
        } else {
          window.__itemtraxxTest?.setWorkspaceAdminSession();
        }
      }, 0);
    }
  }
};

const bootstrap = async () => {
  scrubLegacyAuthFragment();
  routeRecoveryLinksToResetPassword();
  if (redirectCanonicalHost()) {
    return;
  }
  await initializeWorkspaceContext();
  const workspaceContext = getWorkspaceState();
  const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";
  const canMountPublicBootstrap =
    isPublicBootstrapRoute(router, window.location.pathname) && !workspaceContext.isWorkspaceHost;
  const canMountFirst =
    (isE2ETestMode || canMountPublicBootstrap);
  if (canMountFirst) {
    // Avoid flashing the temporary logout screen during normal public-route bootstrap.
    if (isE2ETestMode || canMountPublicBootstrap) {
      clearAuthState(true);
    }
    await mountApp();
    if (canMountPublicBootstrap) {
      void initializePublicAuth();
    } else {
      // E2E mode mounts before auth initialization so the test controls can
      // seed sessions after the app is live. Re-run the current URL once the
      // signed-out state is settled so protected deep links still redirect.
      await initializeAuth();
      await revalidateCurrentRoute();
    }
    return;
  }
  await initializeAuth();
  await mountApp();
};

bootstrap();
