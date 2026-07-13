import {
  onMounted,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";
import { fetchHttpSessionSummary } from "../services/httpSessionService";
import { resolveRecoveryRouteFromPath } from "../services/appErrorRecovery";
import { clearAdminVerification, clearAuthState } from "../store/authState";
import {
  clearSessionTermination,
  getSessionTerminationState,
  showSessionTermination,
} from "../store/sessionTermination";
import { getOrCreateDeviceSession } from "../utils/deviceSession";

type AdminLifecycleAuthState = {
  isAuthenticated: boolean;
  role: string | null;
  userId: string | null;
  adminVerifiedAt: string | null;
  superVerifiedAt: string | null;
};

type AdminSessionLifecycleOptions = {
  auth: AdminLifecycleAuthState;
  route: RouteLocationNormalizedLoaded;
  router: Router;
  sessionTermination: ReturnType<typeof getSessionTerminationState>;
  isDevHost: MaybeRefOrGetter<boolean>;
  isTenantAdminArea: MaybeRefOrGetter<boolean>;
  shouldTrackTenantAdminSession: MaybeRefOrGetter<boolean>;
  closeMenu: () => void;
};

const IS_E2E_TEST_MODE = import.meta.env.VITE_E2E_TEST_UTILS === "true";
const DEFAULT_ADMIN_IDLE_TIMEOUT_MINUTES = 20;
const MIN_ADMIN_IDLE_TIMEOUT_MINUTES = 5;
const parsedAdminIdleTimeoutMinutes = Number(
  import.meta.env.VITE_ADMIN_IDLE_TIMEOUT_MINUTES || DEFAULT_ADMIN_IDLE_TIMEOUT_MINUTES,
);
const effectiveAdminIdleTimeoutMinutes =
  Number.isFinite(parsedAdminIdleTimeoutMinutes) && parsedAdminIdleTimeoutMinutes > 0
    ? IS_E2E_TEST_MODE
      ? parsedAdminIdleTimeoutMinutes
      : Math.max(parsedAdminIdleTimeoutMinutes, MIN_ADMIN_IDLE_TIMEOUT_MINUTES)
    : DEFAULT_ADMIN_IDLE_TIMEOUT_MINUTES;
const ADMIN_IDLE_TIMEOUT_MS = effectiveAdminIdleTimeoutMinutes * 60 * 1000;
const ADMIN_ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

export const useAdminSessionLifecycle = (options: AdminSessionLifecycleOptions) => {
  let idleTimer: number | null = null;
  let adminSessionTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let terminationRedirectTimer: number | null = null;
  let validationRetryTimer: number | null = null;
  let resolveValidationRetry: (() => void) | null = null;
  let authSessionEpoch = 0;
  const isIdleLogoutRunning = ref(false);
  const isAdminSessionCheckRunning = ref(false);
  const isSessionHeartbeatRunning = ref(false);

  const clearIdleTimer = () => {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = null;
  };

  const stopAdminSessionPolling = () => {
    if (adminSessionTimer) window.clearInterval(adminSessionTimer);
    adminSessionTimer = null;
  };

  const stopSessionHeartbeat = () => {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const clearValidationRetry = () => {
    if (validationRetryTimer) window.clearTimeout(validationRetryTimer);
    validationRetryTimer = null;
    resolveValidationRetry?.();
    resolveValidationRetry = null;
  };

  const waitForValidationRetry = () =>
    new Promise<void>((resolve) => {
      resolveValidationRetry = resolve;
      validationRetryTimer = window.setTimeout(() => {
        validationRetryTimer = null;
        resolveValidationRetry = null;
        resolve();
      }, 250);
    });

  const signInAgain = async () => {
    const recoveryRoute =
      options.sessionTermination.recoveryRoute ?? resolveRecoveryRouteFromPath(options.route.path);
    const getPostSignOutUrl =
      options.route.path.startsWith("/super-admin") || options.route.path.startsWith("/internal")
        ? null
        : (await import("../services/authService")).getPostSignOutUrl;
    const nextUrl = getPostSignOutUrl === null ? null : getPostSignOutUrl();
    if (terminationRedirectTimer) window.clearTimeout(terminationRedirectTimer);
    terminationRedirectTimer = null;
    clearSessionTermination();
    options.closeMenu();
    if (nextUrl) {
      if (nextUrl.startsWith("http")) {
        window.location.assign(nextUrl);
        return;
      }
      await options.router.replace(nextUrl);
      return;
    }
    await options.router.replace(recoveryRoute);
  };

  const handleSessionTermination = () => {
    clearAuthState(true);
    clearAdminVerification();
    options.closeMenu();
    showSessionTermination(resolveRecoveryRouteFromPath(options.route.path));
    if (terminationRedirectTimer) window.clearTimeout(terminationRedirectTimer);
    terminationRedirectTimer = window.setTimeout(() => {
      terminationRedirectTimer = null;
      void signInAgain();
    }, 5000);
  };

  const runIdleLogout = async () => {
    if (isIdleLogoutRunning.value || toValue(options.isDevHost)) return;
    if (
      !options.auth.isAuthenticated ||
      options.auth.role !== "tenant_admin" ||
      !toValue(options.isTenantAdminArea)
    ) {
      return;
    }
    isIdleLogoutRunning.value = true;
    try {
      clearAdminVerification();
      await options.router.replace("/tenant/checkout");
    } finally {
      isIdleLogoutRunning.value = false;
    }
  };

  const resetIdleTimer = () => {
    clearIdleTimer();
    if (toValue(options.isDevHost)) return;
    if (
      !options.auth.isAuthenticated ||
      options.auth.role !== "tenant_admin" ||
      !toValue(options.isTenantAdminArea)
    ) {
      return;
    }
    idleTimer = window.setTimeout(() => void runIdleLogout(), ADMIN_IDLE_TIMEOUT_MS);
  };

  const recordActivity = () => {
    resetIdleTimer();
  };

  const runSessionHeartbeat = async () => {
    if (IS_E2E_TEST_MODE || isSessionHeartbeatRunning.value) return;
    if (!options.auth.isAuthenticated) {
      stopSessionHeartbeat();
      return;
    }
    const epoch = authSessionEpoch;
    const userId = options.auth.userId;
    isSessionHeartbeatRunning.value = true;
    try {
      const summary = await fetchHttpSessionSummary();
      if (epoch !== authSessionEpoch || userId !== options.auth.userId) return;
      if (!summary.authenticated) handleSessionTermination();
    } catch {
      // Ignore transient heartbeat failures. Protected requests still trigger recovery.
    } finally {
      isSessionHeartbeatRunning.value = false;
    }
  };

  const startSessionHeartbeat = () => {
    if (
      IS_E2E_TEST_MODE ||
      !options.auth.isAuthenticated ||
      options.sessionTermination.visible ||
      document.visibilityState === "hidden"
    ) {
      stopSessionHeartbeat();
      return;
    }
    void runSessionHeartbeat();
    if (!heartbeatTimer) {
      heartbeatTimer = window.setInterval(() => void runSessionHeartbeat(), 30_000);
    }
  };

  const identityChanged = (epoch: number, userId: string | null, deviceId: string) =>
    epoch !== authSessionEpoch ||
    userId !== options.auth.userId ||
    deviceId !== getOrCreateDeviceSession().deviceId;

  const runAdminSessionCheck = async () => {
    if (isAdminSessionCheckRunning.value) return;
    if (!toValue(options.shouldTrackTenantAdminSession)) {
      stopAdminSessionPolling();
      return;
    }
    const epoch = authSessionEpoch;
    const userId = options.auth.userId;
    const deviceId = getOrCreateDeviceSession().deviceId;
    isAdminSessionCheckRunning.value = true;
    try {
      const { touchTenantAdminSession, validateTenantAdminSession } = await import(
        "../services/adminOpsService"
      );
      if (
        !toValue(options.shouldTrackTenantAdminSession) ||
        options.sessionTermination.visible ||
        document.visibilityState === "hidden"
      ) {
        stopAdminSessionPolling();
        return;
      }
      if (identityChanged(epoch, userId, deviceId)) return;
      try {
        await touchTenantAdminSession();
      } catch {
        // Best-effort keepalive; validation below is authoritative.
      }
      if (identityChanged(epoch, userId, deviceId)) return;
      const validation = await validateTenantAdminSession();
      if (identityChanged(epoch, userId, deviceId)) return;
      if (!validation.valid) {
        await waitForValidationRetry();
        if (identityChanged(epoch, userId, deviceId)) return;
        const retryValidation = await validateTenantAdminSession();
        if (!identityChanged(epoch, userId, deviceId) && !retryValidation.valid) {
          handleSessionTermination();
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Session revoked" &&
        !identityChanged(epoch, userId, deviceId)
      ) {
        handleSessionTermination();
      }
    } finally {
      isAdminSessionCheckRunning.value = false;
    }
  };

  const startAdminSessionPolling = () => {
    if (
      !toValue(options.shouldTrackTenantAdminSession) ||
      options.sessionTermination.visible ||
      document.visibilityState === "hidden"
    ) {
      stopAdminSessionPolling();
      return;
    }
    void runAdminSessionCheck();
    if (!adminSessionTimer) {
      adminSessionTimer = window.setInterval(() => void runAdminSessionCheck(), 45_000);
    }
  };

  const start = () => {
    resetIdleTimer();
    startAdminSessionPolling();
    startSessionHeartbeat();
  };

  const stop = () => {
    clearIdleTimer();
    stopAdminSessionPolling();
    stopSessionHeartbeat();
    clearValidationRetry();
  };

  const handleVisibility = () => {
    if (document.visibilityState === "hidden") {
      stopAdminSessionPolling();
      stopSessionHeartbeat();
      return;
    }
    start();
  };

  watch(
    () => [options.route.path, options.auth.isAuthenticated, options.auth.role] as const,
    start,
  );
  watch(
    () => [
      options.auth.isAuthenticated,
      options.auth.userId,
      options.auth.adminVerifiedAt,
      options.auth.superVerifiedAt,
    ] as const,
    () => {
      authSessionEpoch += 1;
    },
  );
  watch(
    () => options.sessionTermination.visible,
    (visible) => {
      if (!visible && terminationRedirectTimer) {
        window.clearTimeout(terminationRedirectTimer);
        terminationRedirectTimer = null;
      }
      if (visible) {
        stopAdminSessionPolling();
        stopSessionHeartbeat();
      }
    },
  );

  onMounted(() => {
    for (const eventName of ADMIN_ACTIVITY_EVENTS) {
      window.addEventListener(eventName, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", handleVisibility);
    start();
  });

  onScopeDispose(() => {
    stop();
    if (terminationRedirectTimer) window.clearTimeout(terminationRedirectTimer);
    terminationRedirectTimer = null;
    for (const eventName of ADMIN_ACTIVITY_EVENTS) {
      window.removeEventListener(eventName, recordActivity);
    }
    document.removeEventListener("visibilitychange", handleVisibility);
  });

  return {
    recordActivity,
    runAdminSessionCheck,
    runSessionHeartbeat,
    signInAgain,
    start,
    stop,
  };
};
