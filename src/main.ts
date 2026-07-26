import { createApp } from "vue";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app-shell.css";
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
  clientMonitoring.initializeAfterMount(app);
  captureInitialPerfMetrics();
  if (import.meta.env.VITE_E2E_TEST_UTILS === "true") {
    const { attachE2EControls } = await import("./e2e/testControls");
    attachE2EControls(router);
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
