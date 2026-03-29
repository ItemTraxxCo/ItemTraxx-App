import { createApp } from "vue";
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
  adminLoginWithSession,
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
import { rotateDeviceSession } from "./utils/deviceSession";

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

  if (import.meta.env.PROD) {
    throw new Error("VITE_E2E_TEST_UTILS cannot be enabled in production.");
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

const isAdminBootstrapPath = () => {
  const path = window.location.pathname || "/";
  return path.startsWith("/tenant/admin") || path === "/district";
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

const initializeSentry = async (app: ReturnType<typeof createApp>) => {
  if (!import.meta.env.VITE_SENTRY_DSN?.trim()) {
    return;
  }
  const { initializeSentry: initializeSentryMonitoring } = await import("./services/sentry");
  await initializeSentryMonitoring(app, router);
};

const mountApp = async () => {
  markRouteNavigationStart();
  router.beforeEach((_to, _from, next) => {
    markRouteNavigationStart();
    next();
  });
  router.afterEach((to) => {
    markRouteNavigationEnd(to.fullPath);
  });

  const app = createApp(App);
  await initializeSentry(app);
  const { installClientDiagnostics } = await import("./services/clientDiagnostics");
  installClientDiagnostics();
  const { installGlobalErrorHandling } = await import("./services/globalErrorHandling");
  installGlobalErrorHandling(app);
  const { installAppErrorRecovery } = await import("./services/appErrorRecovery");
  installAppErrorRecovery(router);
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
  const shouldPreloadAdminSession = consumedDistrictHandoff && isAdminBootstrapPath();
  const canMountFirst =
    !shouldPreloadAdminSession &&
    (isE2ETestMode || isPublicBootstrapPath() || districtContext.isDistrictHost);
  if (canMountFirst) {
    // Avoid flashing the temporary logout screen during normal public-route bootstrap.
    if (!isE2ETestMode && isPublicBootstrapPath()) {
      clearAuthState(true);
    }
    await mountApp();
    void initializeAuth();
    if (consumedDistrictHandoff) {
      void touchTenantAdminSession().catch(() => {
        // Best-effort session registration after district handoff.
      });
    }
    return;
  }
  if (consumedDistrictHandoff && isAdminBootstrapPath()) {
    try {
      const session = await adminLoginWithSession(
        consumedDistrictHandoff.accessToken,
        consumedDistrictHandoff.refreshToken
      );
      if (session.role === "tenant_admin") {
        try {
          await touchTenantAdminSession();
        } catch {
          // Best-effort session registration after district handoff.
        }
      }
    } catch {
      await initializeAuth();
    }
  } else {
    await initializeAuth();
  }
  if (consumedDistrictHandoff && !isAdminBootstrapPath()) {
    if (getAuthState().role === "tenant_admin" || getAuthState().role === "district_admin") {
      markAdminVerified();
    }
    if (getAuthState().role === "tenant_admin") {
      rotateDeviceSession();
      try {
        await touchTenantAdminSession();
      } catch {
        // Best-effort session registration after district handoff.
      }
    }
  }
  await mountApp();
};

bootstrap();
