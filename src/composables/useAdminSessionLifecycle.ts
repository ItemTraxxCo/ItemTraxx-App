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
import {
  touchAccountSession,
  validateAccountSession,
} from "../services/adminOpsService";
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
};
type AdminSessionLifecycleOptions = {
  auth: AdminLifecycleAuthState;
  route: RouteLocationNormalizedLoaded;
  router: Router;
  sessionTermination: ReturnType<typeof getSessionTerminationState>;
  shouldTrackAccountSession: MaybeRefOrGetter<boolean>;
  closeMenu: () => void;
};

const IS_E2E_TEST_MODE = import.meta.env.VITE_E2E_TEST_UTILS === "true";
const DEFAULT_SESSION_HEARTBEAT_INTERVAL_MS = 30_000;
const parsedE2EHeartbeatIntervalMs = Number(
  import.meta.env.VITE_E2E_SESSION_HEARTBEAT_INTERVAL_MS || DEFAULT_SESSION_HEARTBEAT_INTERVAL_MS,
);
const SESSION_HEARTBEAT_INTERVAL_MS =
  IS_E2E_TEST_MODE &&
  Number.isFinite(parsedE2EHeartbeatIntervalMs) &&
  parsedE2EHeartbeatIntervalMs > 0
    ? parsedE2EHeartbeatIntervalMs
    : DEFAULT_SESSION_HEARTBEAT_INTERVAL_MS;
const LOGIN_CONTEXT_QUERY_KEY = "login_ctx";
const LOGIN_CONTEXT_VALUES = new Set(["admin_login", "regular_login"]);
const SSO_PROOF_QUERY_KEY = "itx_sso_proof";
const LEGACY_SSO_PROVIDER_QUERY_KEY = "itx_sso_provider_id";
const LEGACY_SSO_PROTOCOL_QUERY_KEY = "itx_sso_protocol";
const SSO_CONTEXT_MAX_AGE_MS = 5 * 60_000;

type ConsumedLoginContext = {
  loginContext: "admin_login" | "regular_login" | null;
  ssoLoginProof: string | null;
  ssoContext: PendingSsoLoginContext | null;
};

type PendingSsoLoginContext = {
  proof: string;
  capturedAt: number;
};

const firstQueryString = (value: unknown) =>
  Array.isArray(value) ? value[0] : value;

export const useAdminSessionLifecycle = (options: AdminSessionLifecycleOptions) => {
  const heartbeatEnabled =
    !IS_E2E_TEST_MODE ||
    new URLSearchParams(window.location.search).get("e2e-session-heartbeat") === "1";
  let adminSessionTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let terminationRedirectTimer: number | null = null;
  let validationRetryTimer: number | null = null;
  let resolveValidationRetry: (() => void) | null = null;
  let authSessionEpoch = 0;
  let bootstrappedSessionEpoch: number | null = null;
  let pendingSsoLoginContext: PendingSsoLoginContext | null = null;
  let adminCheckGeneration = 0;
  let runningAdminCheckGeneration: number | null = null;
  let disposed = false;
  const isAdminSessionCheckRunning = ref(false);
  const isSessionHeartbeatRunning = ref(false);

  const stopAdminSessionPolling = () => {
    if (adminSessionTimer) window.clearInterval(adminSessionTimer);
    adminSessionTimer = null;
    adminCheckGeneration += 1;
    clearValidationRetry();
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
    const authService = await import("../services/authService");
    const getPostSignOutUrl =
      options.route.path.startsWith("/super-admin") || options.route.path.startsWith("/internal")
        ? null
        : authService.getPostSignOutUrl;
    const nextUrl = getPostSignOutUrl === null ? null : getPostSignOutUrl();
    if (terminationRedirectTimer) window.clearTimeout(terminationRedirectTimer);
    terminationRedirectTimer = null;
    // A revoked application session can still have a valid HttpOnly auth
    // cookie. Clear that server session before navigating so a fresh tab
    // cannot bootstrap the revoked identity and redirect back into the
    // workspace again.
    const signOutResult = await authService.signOut();
    if (signOutResult && !signOutResult.ok) {
      showSessionTermination(recoveryRoute, {
        title: "Unable to complete logout.",
        message: "Please try again when the connection is available.",
      });
      return;
    }
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
    if (disposed) return;
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

  const runSessionHeartbeat = async () => {
    if (!heartbeatEnabled || isSessionHeartbeatRunning.value || disposed) return;
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
      !heartbeatEnabled ||
      !options.auth.isAuthenticated ||
      options.sessionTermination.visible ||
      document.visibilityState === "hidden"
    ) {
      stopSessionHeartbeat();
      return;
    }
    void runSessionHeartbeat();
    if (!heartbeatTimer) {
      heartbeatTimer = window.setInterval(
        () => void runSessionHeartbeat(),
        SESSION_HEARTBEAT_INTERVAL_MS,
      );
    }
  };

  const captureSsoLoginContext = () => {
    const proof = firstQueryString(
      options.route.query[SSO_PROOF_QUERY_KEY],
    );
    if (typeof proof !== "string" || !/^[a-z0-9_-]{1,1900}\.[a-z0-9_-]{43}$/i.test(proof)) {
      return;
    }
    pendingSsoLoginContext = {
      proof,
      capturedAt: Date.now(),
    };
  };

  watch(
    () => [
      options.route.query[SSO_PROOF_QUERY_KEY],
      options.route.query[LEGACY_SSO_PROVIDER_QUERY_KEY],
      options.route.query[LEGACY_SSO_PROTOCOL_QUERY_KEY],
    ],
    captureSsoLoginContext,
    { immediate: true },
  );

  const consumeLoginContext = (): ConsumedLoginContext | null => {
    const raw = options.route.query[LOGIN_CONTEXT_QUERY_KEY];
    const value = firstQueryString(raw);
    const loginContext = typeof value === "string" && LOGIN_CONTEXT_VALUES.has(value)
      ? value as ConsumedLoginContext["loginContext"]
      : null;
    const hasSsoQuery = SSO_PROOF_QUERY_KEY in options.route.query ||
      LEGACY_SSO_PROVIDER_QUERY_KEY in options.route.query ||
      LEGACY_SSO_PROTOCOL_QUERY_KEY in options.route.query;

    let ssoLogin = pendingSsoLoginContext;
    if (ssoLogin && Date.now() - ssoLogin.capturedAt > SSO_CONTEXT_MAX_AGE_MS) {
      pendingSsoLoginContext = null;
      ssoLogin = null;
    }

    if (!loginContext && !hasSsoQuery && !ssoLogin) return null;
    if (loginContext || hasSsoQuery) {
      const {
        [LOGIN_CONTEXT_QUERY_KEY]: _discardLoginContext,
        [SSO_PROOF_QUERY_KEY]: _discardSsoProof,
        [LEGACY_SSO_PROVIDER_QUERY_KEY]: _discardSsoProvider,
        [LEGACY_SSO_PROTOCOL_QUERY_KEY]: _discardSsoProtocol,
        ...restQuery
      } = options.route.query;
      void options.router.replace({ path: options.route.path, query: restQuery });
    }
    return {
      loginContext,
      ssoLoginProof: ssoLogin?.proof ?? null,
      ssoContext: ssoLogin,
    };
  };

  const identityChanged = (epoch: number, userId: string | null, deviceId: string) =>
    epoch !== authSessionEpoch ||
    userId !== options.auth.userId ||
    deviceId !== getOrCreateDeviceSession().deviceId;

  const adminCheckCancelled = (
    generation: number,
    epoch: number,
    userId: string | null,
    deviceId: string,
  ) =>
    disposed ||
    generation !== adminCheckGeneration ||
    !toValue(options.shouldTrackAccountSession) ||
    options.sessionTermination.visible ||
    document.visibilityState === "hidden" ||
    identityChanged(epoch, userId, deviceId);

  const runAdminSessionCheck = async () => {
    const generation = adminCheckGeneration;
    if (
      isAdminSessionCheckRunning.value &&
      runningAdminCheckGeneration === generation
    ) return;
    if (!toValue(options.shouldTrackAccountSession)) {
      stopAdminSessionPolling();
      return;
    }
    const epoch = authSessionEpoch;
    const userId = options.auth.userId;
    const deviceId = getOrCreateDeviceSession().deviceId;
    isAdminSessionCheckRunning.value = true;
    runningAdminCheckGeneration = generation;
    try {
      if (adminCheckCancelled(generation, epoch, userId, deviceId)) {
        return;
      }
      try {
        const loginContext = consumeLoginContext();
        if (loginContext?.ssoLoginProof) {
          await touchAccountSession({
            ssoLoginProof: loginContext.ssoLoginProof,
          });
          if (pendingSsoLoginContext === loginContext.ssoContext) {
            pendingSsoLoginContext = null;
          }
          bootstrappedSessionEpoch = epoch;
        } else if (loginContext?.loginContext || bootstrappedSessionEpoch !== epoch) {
          await touchAccountSession(
            loginContext?.loginContext
              ? { loginMethod: "password", loginLocation: loginContext.loginContext }
              : {},
          );
          bootstrappedSessionEpoch = epoch;
        }
      } catch {
        // Best-effort keepalive; validation below is authoritative.
      }
      if (adminCheckCancelled(generation, epoch, userId, deviceId)) return;
      const validation = await validateAccountSession();
      if (adminCheckCancelled(generation, epoch, userId, deviceId)) return;
      if (!validation.valid) {
        await waitForValidationRetry();
        if (adminCheckCancelled(generation, epoch, userId, deviceId)) return;
        const retryValidation = await validateAccountSession();
        if (
          !adminCheckCancelled(generation, epoch, userId, deviceId) &&
          !retryValidation.valid
        ) {
          handleSessionTermination();
        }
      } else {
        // validate_session refreshes last_seen_at on the server, so after the
        // first successful check the periodic lifecycle poll does not need a
        // second HTTP request to touch the same session.
        bootstrappedSessionEpoch = epoch;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Session revoked" &&
        !adminCheckCancelled(generation, epoch, userId, deviceId)
      ) {
        handleSessionTermination();
      }
    } finally {
      if (runningAdminCheckGeneration === generation) {
        isAdminSessionCheckRunning.value = false;
        runningAdminCheckGeneration = null;
      }
    }
  };

  const startAdminSessionPolling = () => {
    if (
      !toValue(options.shouldTrackAccountSession) ||
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
    startAdminSessionPolling();
    startSessionHeartbeat();
  };

  const stop = () => {
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
    ] as const,
    () => {
      authSessionEpoch += 1;
      bootstrappedSessionEpoch = null;
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

  // Start the account-session bootstrap during setup, before descendant
  // components mount. Workspace-admin pages load settings and notifications
  // from their own onMounted hooks; starting only from this component's
  // onMounted hook allowed those requests to race the initial touch_session
  // call and be rejected as "Session revoked" because no device row existed
  // yet. The setup-time start preserves the existing revocation/validation
  // checks while making the first protected request deterministic.
  start();

  onMounted(() => {
    document.addEventListener("visibilitychange", handleVisibility);
  });

  onScopeDispose(() => {
    disposed = true;
    stop();
    if (terminationRedirectTimer) window.clearTimeout(terminationRedirectTimer);
    terminationRedirectTimer = null;
    document.removeEventListener("visibilitychange", handleVisibility);
  });

  return {
    runAdminSessionCheck,
    runSessionHeartbeat,
    signInAgain,
    start,
    stop,
  };
};
