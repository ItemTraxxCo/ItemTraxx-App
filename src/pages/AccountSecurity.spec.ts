import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authState: { role: "super_admin" as string | null },
  router: { back: vi.fn() },
  revokeAllSuperAdminSessions: vi.fn(),
  revokeOtherSessions: vi.fn(),
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn() },
}));

vi.mock("vue-router", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("../auth/client", () => ({
  authClient: {
    getSession: vi.fn().mockResolvedValue({ data: { user: { twoFactorEnabled: false } } }),
    passkey: { listUserPasskeys: vi.fn().mockResolvedValue({ data: [] }) },
    revokeOtherSessions: mocks.revokeOtherSessions,
  },
}));

vi.mock("../services/superOps/sessions", () => ({
  revokeAllSuperAdminSessions: mocks.revokeAllSuperAdminSessions,
}));

vi.mock("../store/authState", () => ({
  getAuthState: () => mocks.authState,
}));

import AccountSecurity from "./AccountSecurity.vue";

const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("AccountSecurity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.role = "super_admin";
    mocks.revokeAllSuperAdminSessions.mockResolvedValue({ revoked: 1 });
    mocks.revokeOtherSessions.mockResolvedValue({ error: null });
  });

  it("revokes only other super-admin device sessions", async () => {
    const wrapper = mount(AccountSecurity);
    await settle();

    const signOutButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Sign out other sessions"));
    expect(signOutButton).toBeDefined();
    await signOutButton!.trigger("click");
    await settle();

    expect(mocks.revokeAllSuperAdminSessions).toHaveBeenCalledWith(false);
    expect(mocks.revokeOtherSessions).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Other sessions signed out.");
    wrapper.unmount();
  });

  it("returns to the previous page instead of a role-specific settings route", async () => {
    mocks.authState.role = "tenant_account";
    const wrapper = mount(AccountSecurity);
    await settle();

    const backButton = wrapper.get("button.back-link");
    expect(backButton.text()).toBe("Back");
    await backButton.trigger("click");

    expect(mocks.router.back).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
