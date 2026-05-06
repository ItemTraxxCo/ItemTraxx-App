import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import {
  clearAdminVerification,
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
import { allowsAnalytics, allowsDiagnostics, readCookieConsent } from "./services/cookieConsentService";
import { touchTenantAdminSession } from "./services/adminOpsService";
import { TimeoutError, withTimeout } from "./services/asyncUtils";
import {
  captureInitialPerfMetrics,
  markRouteNavigationEnd,
  markRouteNavigationStart,
} from "./services/perfTelemetry";
import { initializeDistrictContext } from "./services/districtService";
import { rotateDeviceSession } from "./utils/deviceSession";
import { finishRouteLoading, startRouteLoading } from "./store/routeLoading";

declare global {
  interface Window {
    __itemtraxxTest?: {
      setTenantUserSession: (tenantId?: string) => void;
      setTenantAdminSession: (tenantId?: string, options?: { verified?: boolean }) => void;
      setDistrictAdminSession: (districtId?: string, options?: { verified?: boolean }) => void;
      setSuperAdminSession: (options?: { verified?: boolean }) => void;
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
    setTenantAdminSession(tenantId = "tenant-e2e", options = { verified: true }) {
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
      setDistrictContext(null);
      if (options.verified === false) {
        clearAdminVerification();
        return;
      }
      markAdminVerified();
    },
    setDistrictAdminSession(districtId = "district-e2e", options = { verified: true }) {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-district-admin",
        email: "district.admin@example.com",
        signedInAt: new Date().toISOString(),
        role: "district_admin",
        sessionTenantId: null,
        tenantContextId: null,
        districtContextId: districtId,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
      });
      setTenantContext(null);
      setDistrictContext(districtId);
      if (options.verified === false) {
        clearAdminVerification();
        return;
      }
      markAdminVerified();
    },
    setSuperAdminSession(options = { verified: true }) {
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
        hasSecondaryAuth: options.verified !== false,
      });
      setTenantContext(null);
      setDistrictContext(null);
      setSecondaryAuth(options.verified !== false);
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

const toAdminSessionLoginLocation = (value: string | null | undefined) => {
  if (value === "regular_login" || value === "tenant_login") return "regular_login";
  if (
    value === "admin_login" ||
    value === "tenant_admin_login" ||
    value === "district_admin_login"
  ) {
    return "admin_login";
  }
  return null;
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
  if (!import.meta.env.VITE_SENTRY_DSN?.trim() || !allowsDiagnostics(readCookieConsent())) {
    return;
  }
  const { initializeSentry: initializeSentryMonitoring } = await import("./services/sentry");
  await initializeSentryMonitoring(app, router);
};

const initializePostHog = async () => {  
  if (!import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim() || !allowsAnalytics(readCookieConsent())) {
    return;
  }
  try {
    const { initPostHog } = await import("./services/posthogService");
    await initPostHog();
  } catch (error) {
    // Analytics must never break login or core flows.
    console.warn("[posthog] initialization failed; continuing without analytics.", error);
  }
};

const bindConsentDrivenMonitoring = (app: ReturnType<typeof createApp>) => {
  const maybeEnableDiagnostics = () => {
    if (!allowsDiagnostics(readCookieConsent())) {
      return;
    }
    void initializeSentry(app);
  };

  const maybeEnableAnalytics = () => {
    if (!allowsAnalytics(readCookieConsent())) {
      return;
    }
    void initializePostHog();
  };

  window.addEventListener("itemtraxx:cookie-consent", maybeEnableDiagnostics);
  window.addEventListener("itemtraxx:cookie-consent", maybeEnableAnalytics);
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
  const { installClientDiagnostics } = await import("./services/clientDiagnostics");
  installClientDiagnostics();
  const { installGlobalErrorHandling } = await import("./services/globalErrorHandling");
  installGlobalErrorHandling(app);
  const { capturePostHogException } = await import("./services/posthogService");
  const existingErrorHandler = app.config.errorHandler;
  app.config.errorHandler = (error, instance, info) => {
    capturePostHogException(error);
    if (existingErrorHandler) {
      existingErrorHandler(error, instance, info);
    }
  };
  const { installAppErrorRecovery } = await import("./services/appErrorRecovery");
  installAppErrorRecovery(router);
  app.use(router);
  await router.isReady();
  app.mount("#app");
  void initializeSentry(app);
  void initializePostHog();
  bindConsentDrivenMonitoring(app);
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
  const canMountPublicBootstrap =
    isPublicBootstrapPath() && !districtContext.isDistrictHost;
  const canMountFirst =
    !consumedDistrictHandoff &&
    !shouldPreloadAdminSession &&
    (isE2ETestMode || canMountPublicBootstrap);
  if (canMountFirst) {
    // Avoid flashing the temporary logout screen during normal public-route bootstrap.
    if (!isE2ETestMode && canMountPublicBootstrap) {
      clearAuthState(true);
    }
    await mountApp();
    void initializeAuth();
    return;
  }
  if (consumedDistrictHandoff && isAdminBootstrapPath()) {
    try {
      const session = await adminLoginWithSession(
        consumedDistrictHandoff.accessToken,
        consumedDistrictHandoff.refreshToken,
        {
          loginMethod: consumedDistrictHandoff.loginMethod,
          loginLocation: consumedDistrictHandoff.loginLocation,
          skipExchange: true,
          skipLoginNotification: true,
          preExchangedSessionSummary: consumedDistrictHandoff.sessionSummary,
        }
      );
      if (session.role === "tenant_admin") {
        try {
          await touchTenantAdminSession({
            loginMethod: consumedDistrictHandoff.loginMethod,
            loginLocation: toAdminSessionLoginLocation(consumedDistrictHandoff.loginLocation),
          });
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
        await touchTenantAdminSession({
          loginMethod: consumedDistrictHandoff.loginMethod,
          loginLocation: toAdminSessionLoginLocation(consumedDistrictHandoff.loginLocation),
        });
      } catch {
        // Best-effort session registration after district handoff.
      }
    }
  }
  await mountApp();
};

bootstrap();
