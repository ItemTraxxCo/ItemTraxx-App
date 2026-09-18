import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAdminVerification: vi.fn(),
  capturePostHogEvent: vi.fn(),
  getAuthState: vi.fn(),
  identifyPostHogUser: vi.fn(),
  resetTurnstile: vi.fn(),
  routerReplace: vi.fn(),
  routerPush: vi.fn(),
  routeQuery: {} as Record<string, string>,
  workspaceLogin: vi.fn(),
}));

vi.mock("vue-router", () => ({
  RouterLink: { template: "<a><slot /></a>" },
  useRoute: () => ({ query: mocks.routeQuery }),
  useRouter: () => ({ push: mocks.routerPush, replace: mocks.routerReplace }),
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
    mocks.routerReplace.mockResolvedValue(undefined);
    mocks.routeQuery = {};
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
    });
    expect(mocks.capturePostHogEvent).not.toHaveBeenCalledWith(
      "tenant_login_failed",
      expect.anything(),
    );
    wrapper.unmount();
  });

  it("returns to a safe requested path after password sign-in", async () => {
    mocks.routeQuery = { redirect: "/checkout?source=email" };
    mocks.getAuthState.mockReturnValue({ userId: "user-1", role: "tenant_account" });
    mocks.workspaceLogin.mockResolvedValue({
      role: "tenant_account",
      workspaceSlug: null,
    });
    const wrapper = mountLogin();

    await wrapper.get('input[placeholder="Email address"]').setValue("tenant@example.com");
    await wrapper.get('input[placeholder="Enter password"]').setValue("correct-password");
    await wrapper.get("form").trigger("submit");
    await settle();

    expect(mocks.routerReplace).toHaveBeenCalledWith(
      "/checkout?source=email&login_ctx=regular_login",
    );
    wrapper.unmount();
  });
});
