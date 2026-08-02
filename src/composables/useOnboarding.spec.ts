import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { useOnboarding } from "./useOnboarding";

vi.mock("../services/onboardingService", () => ({
  hasCompletedOnboarding: vi.fn(),
  markOnboardingCompleted: vi.fn(),
  resetOnboarding: vi.fn(),
}));

import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
  resetOnboarding,
} from "../services/onboardingService";

const mockedHasCompletedOnboarding = vi.mocked(hasCompletedOnboarding);
const mockedMarkOnboardingCompleted = vi.mocked(markOnboardingCompleted);
const mockedResetOnboarding = vi.mocked(resetOnboarding);

const mountHost = (auth: { isInitialized: boolean; isAuthenticated: boolean; role: string | null }, path = "/checkout") => {
  const authRef = reactive(auth);
  const route = reactive({ path });
  let exposed!: ReturnType<typeof useOnboarding>;
  const Host = defineComponent({
    setup() {
      exposed = useOnboarding(authRef, route as never);
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get: () => exposed, auth: authRef, route };
};

describe("useOnboarding", () => {
  beforeEach(() => {
    mockedHasCompletedOnboarding.mockReset().mockReturnValue(false);
    mockedMarkOnboardingCompleted.mockReset();
    mockedResetOnboarding.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays hidden when auth is not yet initialized", () => {
    const { wrapper, get } = mountHost({ isInitialized: false, isAuthenticated: true, role: "tenant_account" });
    expect(get().visible.value).toBe(false);
    wrapper.unmount();
  });

  it("stays hidden when unauthenticated", () => {
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: false, role: null });
    expect(get().visible.value).toBe(false);
    wrapper.unmount();
  });

  it("stays hidden for a role outside tenant_account/workspace_admin", () => {
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: true, role: "super_admin" });
    expect(get().visible.value).toBe(false);
    expect(get().currentRole.value).toBeNull();
    wrapper.unmount();
  });

  it("stays hidden off a workspace route even for a valid role", () => {
    const { wrapper, get } = mountHost(
      { isInitialized: true, isAuthenticated: true, role: "tenant_account" },
      "/some-other-page",
    );
    expect(get().visible.value).toBe(false);
    expect(get().canReplay.value).toBe(false);
    wrapper.unmount();
  });

  it("shows onboarding on a workspace route for a tenant_account who has not completed it", () => {
    mockedHasCompletedOnboarding.mockReturnValue(false);
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: true, role: "tenant_account" }, "/checkout");

    expect(get().visible.value).toBe(true);
    expect(get().role.value).toBe("tenant_account");
    expect(get().variant.value).toBe("tenant_checkout");
    wrapper.unmount();
  });

  it("does not show onboarding when already completed", () => {
    mockedHasCompletedOnboarding.mockReturnValue(true);
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: true, role: "tenant_account" }, "/items");

    expect(get().visible.value).toBe(false);
    wrapper.unmount();
  });

  it("uses the workspace_admin variant on /admin routes", () => {
    mockedHasCompletedOnboarding.mockReturnValue(false);
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: true, role: "workspace_admin" }, "/admin/items");

    expect(get().visible.value).toBe(true);
    expect(get().variant.value).toBe("workspace_admin");
    expect(get().canReplay.value).toBe(true);
    wrapper.unmount();
  });

  it("only evaluates whether to auto-show once per session, even if evaluate() re-runs", () => {
    mockedHasCompletedOnboarding.mockReturnValue(false);
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: true, role: "tenant_account" }, "/checkout");
    expect(get().visible.value).toBe(true);

    get().complete();
    expect(get().visible.value).toBe(false);

    // Re-running evaluate (e.g. a route watch firing again) must not re-open
    // the modal now that evaluationDone is latched for this session.
    get().evaluate();
    expect(get().visible.value).toBe(false);
    wrapper.unmount();
  });

  it("open() resets onboarding for the current role and forces the modal visible", () => {
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: true, role: "workspace_admin" }, "/admin/items");
    get().complete();
    expect(get().visible.value).toBe(false);

    get().open();

    expect(mockedResetOnboarding).toHaveBeenCalledWith("workspace_admin");
    expect(get().visible.value).toBe(true);
    wrapper.unmount();
  });

  it("open() is a no-op without a current role", () => {
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: false, role: null });
    get().open();
    expect(mockedResetOnboarding).not.toHaveBeenCalled();
    expect(get().visible.value).toBe(false);
    wrapper.unmount();
  });

  it("complete() marks onboarding completed for the current role and hides the modal", () => {
    mockedHasCompletedOnboarding.mockReturnValue(false);
    const { wrapper, get } = mountHost({ isInitialized: true, isAuthenticated: true, role: "tenant_account" }, "/borrowers");

    get().complete();

    expect(mockedMarkOnboardingCompleted).toHaveBeenCalledWith("tenant_account");
    expect(get().visible.value).toBe(false);
    wrapper.unmount();
  });

  it("re-evaluates and can newly show the modal after auth/role/route changes", async () => {
    mockedHasCompletedOnboarding.mockReturnValue(false);
    const { wrapper, get, auth, route } = mountHost({ isInitialized: true, isAuthenticated: false, role: null }, "/some-other-page");
    expect(get().visible.value).toBe(false);

    auth.isAuthenticated = true;
    auth.role = "tenant_account";
    route.path = "/checkout";
    await nextTick();

    expect(get().visible.value).toBe(true);
    wrapper.unmount();
  });
});
