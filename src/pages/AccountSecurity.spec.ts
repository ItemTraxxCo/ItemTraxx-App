import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authState: { role: "super_admin" as string | null, email: "owner@example.com" as string | null },
  router: { back: vi.fn() },
  revokeAllSuperAdminSessions: vi.fn(),
  revokeOtherSessions: vi.fn(),
  addPasskey: vi.fn(),
  verifySuperAdminPassword: vi.fn(),
  requestAccountEmailChange: vi.fn(),
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
    passkey: {
      listUserPasskeys: vi.fn().mockResolvedValue({ data: [] }),
      addPasskey: mocks.addPasskey,
    },
    revokeOtherSessions: mocks.revokeOtherSessions,
  },
}));

vi.mock("../services/superOps/sessions", () => ({
  revokeAllSuperAdminSessions: mocks.revokeAllSuperAdminSessions,
  verifySuperAdminPassword: mocks.verifySuperAdminPassword,
}));

vi.mock("../services/accountEmailChangeService", () => ({
  requestAccountEmailChange: mocks.requestAccountEmailChange,
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
    mocks.authState.email = "owner@example.com";
    mocks.revokeAllSuperAdminSessions.mockResolvedValue({ revoked: 1 });
    mocks.revokeOtherSessions.mockResolvedValue({ error: null });
    mocks.addPasskey.mockResolvedValue({ error: null });
    mocks.verifySuperAdminPassword.mockResolvedValue({ verified: true });
  });

  it("confirms a Super Admin password before enrolling a passkey on the current session", async () => {
    const wrapper = mount(AccountSecurity);
    await settle();

    const password = wrapper.get('input[type="password"][data-session-replay-mask]');
    await password.setValue("current-password");
    const addButton = wrapper.findAll("button").find((button) => button.text() === "Add passkey");
    await addButton!.trigger("click");
    await settle();

    expect(mocks.verifySuperAdminPassword).toHaveBeenCalledWith("current-password");
    expect(mocks.addPasskey).toHaveBeenCalledOnce();
    expect(mocks.verifySuperAdminPassword.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.addPasskey.mock.invocationCallOrder[0]);
    expect(wrapper.text()).toContain("Passkey added.");
    wrapper.unmount();
  });

  it("does not enroll a passkey when current-password confirmation fails", async () => {
    mocks.verifySuperAdminPassword.mockRejectedValue(new Error("Invalid password."));
    const wrapper = mount(AccountSecurity);
    await settle();

    await wrapper.get('input[type="password"][data-session-replay-mask]').setValue("wrong-password");
    const addButton = wrapper.findAll("button").find((button) => button.text() === "Add passkey");
    await addButton!.trigger("click");
    await settle();

    expect(mocks.verifySuperAdminPassword).toHaveBeenCalledOnce();
    expect(mocks.addPasskey).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Invalid password.");
    wrapper.unmount();
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

  it("requests an email change through the owner verification flow", async () => {
    mocks.requestAccountEmailChange.mockResolvedValue(
      "Approval instructions were sent to your current email address.",
    );
    const wrapper = mount(AccountSecurity);
    await settle();

    await wrapper.get('input[type="email"]').setValue("new@example.com");
    await wrapper.get("form.email-change-form").trigger("submit");
    await settle();

    expect(mocks.requestAccountEmailChange).toHaveBeenCalledWith("new@example.com");
    expect(wrapper.text()).toContain("Approval instructions were sent to your current email address.");
    wrapper.unmount();
  });
});
