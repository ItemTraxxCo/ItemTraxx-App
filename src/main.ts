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
  hasDistrictSessionHandoff,
  refreshPublicAuthFromSession,
} from "./services/publicAuthBootstrap";
import { allowsAnalytics, allowsDiagnostics, readCookieConsent } from "./services/cookieConsentService";
import { TimeoutError, withTimeout } from "./services/asyncUtils";
import {
  captureInitialPerfMetrics,
  markRouteNavigationEnd,
  markRouteNavigationStart,
} from "./services/perfTelemetry";
import { initializeDistrictContext } from "./services/districtService";
import { rotateDeviceSession } from "./utils/deviceSession";
import { routeRecoveryLinksToResetPassword } from "./utils/passwordResetRedirect";
import { finishRouteLoading, startRouteLoading } from "./store/routeLoading";

declare global {
  interface Window {
    __itemtraxxTest?: {
      setTenantUserSession: (tenantId?: string) => void;
      setTenantAdminSession: (tenantId?: string, options?: { verified?: boolean }) => void;
      setDistrictAdminSession: (districtId?: string, options?: { verified?: boolean }) => void;
      setSuperAdminSession: (options?: { verified?: boolean }) => void;
      invokeAdminGearCreate: (payload: {
        tenant_id: string;
        name: string;
        barcode: string;
        status: string;
        notes?: string;
      }) => Promise<unknown>;
      invokeAdminStudentCreate: (payload: {
        tenant_id: string;
        username?: string;
        student_id?: string;
      }) => Promise<unknown>;
      clearSession: () => void;
      navigate: (path: string) => Promise<void>;
      generateBarcodePattern: (
        value: string
      ) => Promise<{ modules: number; bars: { start: number; width: number }[] }>;
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
    async invokeAdminGearCreate(payload) {
      const { createGear } = await import("./services/gearService");
      return await createGear(payload);
    },
    async invokeAdminStudentCreate(payload) {
      const { createStudent } = await import("./services/studentService");
      return await createStudent(payload);
    },
    clearSession() {
      clearAuthState(true);
      setTenantContext(null);
      setDistrictContext(null);
    },
    async navigate(path: string) {
      await router.push(path);
    },
    async generateBarcodePattern(value: string) {
      const [{ createBarcodePattern }, { default: JsBarcode }] = await Promise.all([
        import("./services/barcodePdfService"),
        import("jsbarcode"),
      ]);
      return createBarcodePattern(
        value,
        JsBarcode as (
          element: HTMLCanvasElement,
          text: string,
          options?: unknown
        ) => void
      );
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

let appMounted = false;

const initializeSentry = async (app: ReturnType<typeof createApp>) => {
  if (!import.meta.env.VITE_SENTRY_DSN?.trim() || !allowsDiagnostics(readCookieConsent())) {
    return;
  }
  try {
    const { initializeSentry: initializeSentryMonitoring } = await import("./services/sentry");
    await initializeSentryMonitoring(app, router, appMounted);
  } catch (error) {
    // Diagnostics must never break login or core flows.
    console.warn("[sentry] initialization failed; continuing without diagnostics.", error);
  }
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
    const { installClientDiagnostics } = await import("./services/clientDiagnostics");
    installClientDiagnostics();
  } catch (error) {
    // Diagnostics must never break login or core flows.
    console.warn("[diagnostics] initialization failed; continuing without diagnostics.", error);
  }
};

let posthogServicePromise: Promise<typeof import("./services/posthogService")> | null = null;

const loadPostHogService = () => {
  if (!posthogServicePromise) {
    posthogServicePromise = import("./services/posthogService").catch((error) => {
      posthogServicePromise = null;
      throw error;
    });
  }
  return posthogServicePromise;
};

const getPostHogExceptionCapture = async () => {
  if (!allowsAnalytics(readCookieConsent())) {
    return () => undefined;
  }
  return loadPostHogService()
    .then((module) => module.capturePostHogException)
    .catch(() => () => undefined);
};

const capturePostHogExceptionSafely = (error: unknown) => {
  void getPostHogExceptionCapture().then((capture) => capture(error));
};

const bindConsentDrivenMonitoring = (app: ReturnType<typeof createApp>) => {
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
    capturePostHogExceptionSafely(error);
    if (existingErrorHandler) {
      existingErrorHandler(error, instance, info);
    }
  };
  app.use(router);
  await router.isReady();
  await initializeSentry(app);
  app.mount("#app");
  appMounted = true;
  void initializeClientDiagnostics().catch(() => undefined);
  void import("./services/globalErrorHandling")
    .then(({ installGlobalErrorHandling }) => installGlobalErrorHandling(app))
    .catch(() => undefined);
  void import("./services/appErrorRecovery")
    .then(({ installAppErrorRecovery }) => installAppErrorRecovery(router))
    .catch(() => undefined);
  void initializePostHog();
  bindConsentDrivenMonitoring(app);
  captureInitialPerfMetrics();
  attachE2EControls();
};

const bootstrap = async () => {
  routeRecoveryLinksToResetPassword();
  if (redirectCanonicalHost()) {
    return;
  }
  const consumedDistrictHandoff = hasDistrictSessionHandoff()
    ? await (async () => {
        const { consumeDistrictSessionHandoff } = await import("./services/authService");
        return consumeDistrictSessionHandoff();
      })()
    : false;
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
    void (canMountPublicBootstrap ? initializePublicAuth() : initializeAuth());
    return;
  }
  if (consumedDistrictHandoff && isAdminBootstrapPath()) {
    try {
      const { adminLoginWithSession } = await import("./services/authService");
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
          const { touchTenantAdminSession } = await import("./services/adminOpsService");
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
        const { touchTenantAdminSession } = await import("./services/adminOpsService");
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
