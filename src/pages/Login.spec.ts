import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAdminVerification: vi.fn(),
  capturePostHogEvent: vi.fn(),
  getAuthState: vi.fn(),
  identifyPostHogUser: vi.fn(),
  resetTurnstile: vi.fn(),
  routerPush: vi.fn(),
  workspaceLogin: vi.fn(),
}));

vi.mock("vue-router", () => ({
  RouterLink: { template: "<a><slot /></a>" },
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock("../composables/useTurnstile", () => ({
  useTurnstile: () => ({
    containerRef: { value: null },
    reset: mocks.resetTurnstile,
    token: { value: "turnstile-token" },
  }),
}));

vi.mock("../store/authState", () => ({
  clearAdminVerification: mocks.clearAdminVerification,
  getAuthState: mocks.getAuthState,
}));

vi.mock("../services/authService", () => ({
  workspaceLogin: mocks.workspaceLogin,
}));

vi.mock("../services/posthogService", () => ({
  capturePostHogEvent: mocks.capturePostHogEvent,
  identifyPostHogUser: mocks.identifyPostHogUser,
}));

import Login from "./Login.vue";

const mountLogin = () =>
  mount(Login, {
    global: {
      stubs: {
        SafeExternalLink: { template: "<a><slot /></a>" },
      },
    },
  });

const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthState.mockReturnValue({ userId: null, role: null });
    mocks.routerPush.mockResolvedValue(undefined);
  });

  it("records invalid credentials under the role-neutral login_failed event", async () => {
    mocks.workspaceLogin.mockRejectedValueOnce(new Error("Invalid email or password."));
    const wrapper = mountLogin();

    await wrapper.get('input[placeholder="Email address"]').setValue("admin@example.com");
    await wrapper.get('input[placeholder="Enter password"]').setValue("wrong-password");
    await wrapper.get("form").trigger("submit");
    await settle();

    expect(mocks.capturePostHogEvent).toHaveBeenCalledWith("login_failed", {
      error_code: "invalid_credentials",
      consecutive_failures: 1,
    });
    expect(mocks.capturePostHogEvent).not.toHaveBeenCalledWith(
      "tenant_login_failed",
      expect.anything(),
    );
    wrapper.unmount();
  });

  it("uses login_failed for unexpected authentication errors too", async () => {
    mocks.workspaceLogin.mockRejectedValueOnce(
      new Error("Backend diagnostic token=secret for person@example.com")
    );
    const wrapper = mountLogin();

    await wrapper.get('input[placeholder="Email address"]').setValue("person@example.com");
    await wrapper.get('input[placeholder="Enter password"]').setValue("wrong-password");
    await wrapper.get("form").trigger("submit");
    await settle();

    expect(mocks.capturePostHogEvent).toHaveBeenCalledWith("login_failed", {
      error_code: "authentication_failed",
      consecutive_failures: 1,
    });
    expect(mocks.capturePostHogEvent).not.toHaveBeenCalledWith(
      "tenant_login_failed",
      expect.anything(),
    );
    wrapper.unmount();
  });

  it("surfaces a password-reset prompt after repeated sign-in failures", async () => {
    mocks.workspaceLogin.mockRejectedValue(new Error("Invalid email or password."));
    const wrapper = mountLogin();

    const submitOnce = async () => {
      await wrapper.get('input[placeholder="Email address"]').setValue("admin@example.com");
      await wrapper.get('input[placeholder="Enter password"]').setValue("wrong-password");
      await wrapper.get("form").trigger("submit");
      await settle();
    };

    await submitOnce();
    await submitOnce();
    expect(wrapper.find(".login-reset-hint").exists()).toBe(false);

    await submitOnce();
    expect(wrapper.find(".login-reset-hint").exists()).toBe(true);
    expect(mocks.capturePostHogEvent).toHaveBeenCalledWith("login_failed", {
      error_code: "invalid_credentials",
      consecutive_failures: 3,
    });
    wrapper.unmount();
  });

  it("clears the failure counter after a successful sign-in", async () => {
    mocks.workspaceLogin
      .mockRejectedValueOnce(new Error("Invalid email or password."))
      .mockRejectedValueOnce(new Error("Invalid email or password."))
      .mockRejectedValueOnce(new Error("Invalid email or password."))
      .mockResolvedValueOnce({ role: "workspace_admin", workspaceSlug: null });
    mocks.getAuthState.mockReturnValue({ userId: "user-1", role: "workspace_admin" });
    const wrapper = mountLogin();

    const submitOnce = async () => {
      await wrapper.get('input[placeholder="Email address"]').setValue("admin@example.com");
      await wrapper.get('input[placeholder="Enter password"]').setValue("secret");
      await wrapper.get("form").trigger("submit");
      await settle();
    };

    await submitOnce();
    await submitOnce();
    await submitOnce();
    expect(wrapper.find(".login-reset-hint").exists()).toBe(true);

    await submitOnce();
    expect(wrapper.find(".login-reset-hint").exists()).toBe(false);
    wrapper.unmount();
  });

  it.each([
    ["TURNSTILE_FAILED", "turnstile_failed"],
    ["LIMITER_UNAVAILABLE", "rate_limit"],
    ["WORKSPACE_DISABLED", "workspace_disabled"],
    ["MAINTENANCE_MODE", "maintenance_mode"],
  ])("reports %s as a blocked login instead of staying silent", async (thrown, code) => {
    mocks.workspaceLogin.mockRejectedValueOnce(new Error(thrown));
    const wrapper = mountLogin();

    await wrapper.get('input[placeholder="Email address"]').setValue("admin@example.com");
    await wrapper.get('input[placeholder="Enter password"]').setValue("secret");
    await wrapper.get("form").trigger("submit");
    await settle();

    expect(mocks.capturePostHogEvent).toHaveBeenCalledWith("login_failed", {
      error_code: code,
    });
    wrapper.unmount();
  });

  it("does not count a blocked login toward the password-reset prompt", async () => {
    mocks.workspaceLogin.mockRejectedValue(new Error("TURNSTILE_FAILED"));
    const wrapper = mountLogin();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await wrapper.get('input[placeholder="Email address"]').setValue("admin@example.com");
      await wrapper.get('input[placeholder="Enter password"]').setValue("secret");
      await wrapper.get("form").trigger("submit");
      await settle();
    }

    // A failed bot check says nothing about the password, so it must not push
    // the operator toward resetting a credential that already works.
    expect(wrapper.find(".login-reset-hint").exists()).toBe(false);
    wrapper.unmount();
  });
});
