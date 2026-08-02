import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useAdminSessionLifecycle } from "./useAdminSessionLifecycle";
import { clearAuthState, clearAdminVerification as realClearAdminVerification } from "../store/authState";
import { clearSessionTermination, getSessionTerminationState } from "../store/sessionTermination";

// Network-touching services are mocked at the module boundary; the auth /
// session-termination stores are simple in-memory singletons already covered
// by their own specs, so we use the real modules here for realistic reactivity.
vi.mock("../services/httpSessionService", () => ({
  fetchHttpSessionSummary: vi.fn(),
}));
vi.mock("../services/adminOpsService", () => ({
  touchAccountSession: vi.fn(),
  validateAccountSession: vi.fn(),
}));
vi.mock("../services/authService", () => ({
  getPostSignOutUrl: vi.fn(),
}));

import { fetchHttpSessionSummary } from "../services/httpSessionService";
import { touchAccountSession, validateAccountSession } from "../services/adminOpsService";
import { getPostSignOutUrl } from "../services/authService";

const mockedFetchHttpSessionSummary = vi.mocked(fetchHttpSessionSummary);
const mockedTouchAccountSession = vi.mocked(touchAccountSession);
const mockedValidateAccountSession = vi.mocked(validateAccountSession);
const mockedGetPostSignOutUrl = vi.mocked(getPostSignOutUrl);

const ADMIN_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const ADMIN_POLL_INTERVAL_MS = 45_000;
const VALIDATION_RETRY_MS = 250;
const TERMINATION_REDIRECT_MS = 5000;

type Auth = {
  isAuthenticated: boolean;
  role: string | null;
  userId: string | null;
  adminVerifiedAt: string | null;
  superVerifiedAt: string | null;
};

const buildAuth = (overrides: Partial<Auth> = {}) =>
  reactive<Auth>({
    isAuthenticated: false,
    role: null,
    userId: null,
    adminVerifiedAt: null,
    superVerifiedAt: null,
    ...overrides,
  });

const buildRoute = (path = "/admin/items", query: Record<string, string> = {}) =>
  reactive({ path, query } as never);

const mountHost = (opts: {
  auth: Auth;
  route: ReturnType<typeof buildRoute>;
  isDevHost?: boolean;
  isWorkspaceAdminArea?: boolean;
  shouldTrackAccountSession?: boolean;
}) => {
  const router = { replace: vi.fn().mockResolvedValue(undefined) };
  const closeMenu = vi.fn();
  const isDevHost = ref(opts.isDevHost ?? false);
  const isWorkspaceAdminArea = ref(opts.isWorkspaceAdminArea ?? true);
  const shouldTrackAccountSession = ref(opts.shouldTrackAccountSession ?? true);

  let exposed!: ReturnType<typeof useAdminSessionLifecycle>;
  const Host = defineComponent({
    setup() {
      exposed = useAdminSessionLifecycle({
        auth: opts.auth,
        route: opts.route as never,
        router: router as never,
        sessionTermination: getSessionTerminationState(),
        isDevHost,
        isWorkspaceAdminArea,
        shouldTrackAccountSession,
        closeMenu,
      });
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return {
    wrapper,
    get: () => exposed,
    router,
    closeMenu,
    isDevHost,
    isWorkspaceAdminArea,
    shouldTrackAccountSession,
  };
};

describe("useAdminSessionLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedFetchHttpSessionSummary.mockReset().mockResolvedValue({ authenticated: true, user: null, profile: null });
    mockedTouchAccountSession.mockReset().mockResolvedValue({ ok: true });
    mockedValidateAccountSession.mockReset().mockResolvedValue({ valid: true });
    mockedGetPostSignOutUrl.mockReset().mockReturnValue(null as never);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    clearAuthState();
    realClearAdminVerification();
    clearSessionTermination();
    vi.restoreAllMocks();
  });

  it("registers activity + visibility listeners on mount and starts polling/heartbeat", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    const { wrapper } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockedTouchAccountSession).toHaveBeenCalled();
    expect(mockedValidateAccountSession).toHaveBeenCalled();
    expect(mockedFetchHttpSessionSummary).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("logs the workspace admin out after the idle timeout on an admin area", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    const { wrapper, router } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(ADMIN_IDLE_TIMEOUT_MS);

    expect(router.replace).toHaveBeenCalledWith("/checkout");
    wrapper.unmount();
  });

  it("does not idle-log-out on a dev host", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    const { wrapper, router } = mountHost({ auth, route, isDevHost: true });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(ADMIN_IDLE_TIMEOUT_MS);

    expect(router.replace).not.toHaveBeenCalledWith("/checkout");
    wrapper.unmount();
  });

  it("activity events reset the idle timer so logout does not fire early", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    const { wrapper, router } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(ADMIN_IDLE_TIMEOUT_MS - 1000);
    window.dispatchEvent(new Event("mousemove"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(router.replace).not.toHaveBeenCalledWith("/checkout");
    wrapper.unmount();
  });

  it("consumes a login_ctx query param, stripping it and touching the session with login context", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute("/admin/items", { login_ctx: "admin_login" });
    const { wrapper, router } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);

    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/admin/items", query: {} }),
    );
    expect(mockedTouchAccountSession).toHaveBeenCalledWith({
      loginMethod: "password",
      loginLocation: "admin_login",
    });
    wrapper.unmount();
  });

  it("retries validation once and shows session termination if it stays invalid", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    mockedValidateAccountSession.mockResolvedValue({ valid: false });
    const { wrapper } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(VALIDATION_RETRY_MS);

    expect(mockedValidateAccountSession).toHaveBeenCalledTimes(2);
    expect(getSessionTerminationState().visible).toBe(true);
    wrapper.unmount();
  });

  it("shows session termination immediately when validateAccountSession throws a revoked-session error", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    mockedValidateAccountSession.mockRejectedValue(new Error("Session revoked"));
    const { wrapper } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);

    expect(getSessionTerminationState().visible).toBe(true);
    wrapper.unmount();
  });

  it("stops admin polling once shouldTrackAccountSession becomes false", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    const { wrapper, shouldTrackAccountSession } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);
    const callsBefore = mockedValidateAccountSession.mock.calls.length;

    shouldTrackAccountSession.value = false;
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(ADMIN_POLL_INTERVAL_MS * 2);

    expect(mockedValidateAccountSession.mock.calls.length).toBe(callsBefore);
    wrapper.unmount();
  });

  it("logs a session termination via heartbeat when the http session is no longer authenticated", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "tenant_account", userId: "u1" });
    const route = buildRoute("/checkout");
    mockedFetchHttpSessionSummary.mockResolvedValue({ authenticated: false, user: null, profile: null });
    const { wrapper, closeMenu, router } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);

    expect(getSessionTerminationState().visible).toBe(true);
    expect(closeMenu).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TERMINATION_REDIRECT_MS);
    expect(router.replace).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("stops polling and heartbeat while the tab is hidden and resumes when visible", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    const { wrapper } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);
    const callsBefore = mockedFetchHttpSessionSummary.mock.calls.length;

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(ADMIN_POLL_INTERVAL_MS * 2);
    expect(mockedFetchHttpSessionSummary.mock.calls.length).toBe(callsBefore);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedFetchHttpSessionSummary.mock.calls.length).toBeGreaterThan(callsBefore);
    wrapper.unmount();
  });

  it("signInAgain replaces to a same-origin URL from getPostSignOutUrl when one is returned", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "tenant_account", userId: "u1" });
    const route = buildRoute("/checkout");
    mockedGetPostSignOutUrl.mockReturnValue("/public-login" as never);
    const { wrapper, get, router } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);

    await get().signInAgain();

    expect(router.replace).toHaveBeenCalledWith("/public-login");
    wrapper.unmount();
  });

  it("signInAgain navigates via location.assign for an absolute URL", async () => {
    // jsdom's window.location.assign is non-configurable, so vi.spyOn can't
    // touch it directly. Swap the whole location object out for one that
    // replaces assign with a spy, then restore the original afterward.
    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign },
    });
    try {
      const auth = buildAuth({ isAuthenticated: true, role: "tenant_account", userId: "u1" });
      const route = buildRoute("/checkout");
      mockedGetPostSignOutUrl.mockReturnValue("https://itemtraxx.com/login");
      const { wrapper, get } = mountHost({ auth, route });
      await vi.advanceTimersByTimeAsync(0);

      await get().signInAgain();

      expect(assign).toHaveBeenCalledWith("https://itemtraxx.com/login");
      wrapper.unmount();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });

  it("removes activity/visibility listeners and clears timers on unmount", async () => {
    const auth = buildAuth({ isAuthenticated: true, role: "workspace_admin", userId: "u1" });
    const route = buildRoute();
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { wrapper } = mountHost({ auth, route });
    await vi.advanceTimersByTimeAsync(0);

    wrapper.unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
  });
});
