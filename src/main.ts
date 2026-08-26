import { createApp } from "vue";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app-shell.css";
import "./bones/registry";
import App from "./App.vue";
import router from "./router";
import { clearAuthState, getAuthState } from "./store/authState";
import { getWorkspaceState } from "./store/workspaceState";
import { refreshPublicAuthFromSession, scrubLegacyAuthFragment } from "./services/publicAuthBootstrap";
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

const initializeAuth = async () => {
  const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";
  if (isE2ETestMode) {
    clearAuthState(true);
    return;
  }

  try {
    const { initAuthListener } = await withTimeout(
      import("./services/authService").then(async (authService) => {
        await authService.refreshAuthFromSession();
        return authService;
      }),
      6000,
      "Authentication initialization timed out."
    );
    initAuthListener();
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
};

const initializePublicAuth = async () => {
  document.documentElement.dataset.itemtraxxPublicAuth = "pending";
  const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";
  if (isE2ETestMode) {
    clearAuthState(true);
  }

  try {
    await withTimeout(
      refreshPublicAuthFromSession(),
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
    document.documentElement.dataset.itemtraxxPublicAuth = "settled";
  }
};

const clientMonitoring = createClientMonitoring(router);
installAppErrorRecovery(router);

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
  await clientMonitoring.initializeBeforeMount(app);
  app.mount("#app");
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
    if (!isE2ETestMode && canMountPublicBootstrap) {
      clearAuthState(true);
    }
    await mountApp();
    void (canMountPublicBootstrap ? initializePublicAuth() : initializeAuth());
    return;
  }
  await initializeAuth();
  await mountApp();
};

bootstrap();
