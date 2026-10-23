import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  router: {},
  createSuperAdmin: vi.fn(),
  listSuperAdmins: vi.fn(),
  sendSuperAdminReset: vi.fn(),
  setSuperAdminStatus: vi.fn(),
  updateSuperAdminEmail: vi.fn(),
  verifySuperAdminPassword: vi.fn(),
}));

vi.mock("vue-router", () => ({
  RouterLink: { template: "<a><slot /></a>" },
  useRouter: () => mocks.router,
}));

vi.mock("../../services/authErrorHandling", () => ({
  handleSuperAdminUnauthorized: vi.fn(),
  isUnauthorizedError: () => false,
}));

vi.mock("../../services/appErrors", () => ({
  toUserFacingErrorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
}));

vi.mock("../../services/superAdminService", () => ({
  createSuperAdmin: mocks.createSuperAdmin,
  listSuperAdmins: mocks.listSuperAdmins,
  sendSuperAdminReset: mocks.sendSuperAdminReset,
  setSuperAdminStatus: mocks.setSuperAdminStatus,
  updateSuperAdminEmail: mocks.updateSuperAdminEmail,
}));

vi.mock("../../services/superOps/sessions", () => ({
  verifySuperAdminPassword: mocks.verifySuperAdminPassword,
}));

import SuperAdmins from "./SuperAdmins.vue";

const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("SuperAdmins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSuperAdmins.mockResolvedValue([]);
    mocks.verifySuperAdminPassword.mockResolvedValue({ verified: true });
    mocks.createSuperAdmin.mockResolvedValue({
      id: "created-profile",
      auth_email: "new-admin@example.test",
      role: "super_admin",
      is_active: true,
      created_at: "2026-10-03T00:00:00Z",
    });
  });

  it("confirms the current password before requesting super-admin creation", async () => {
    const wrapper = mount(SuperAdmins);
    await settle();

    await wrapper.get('input[type="email"]').setValue("new-admin@example.test");
    await wrapper.get('input[autocomplete="new-password"]').setValue("temporary-password");
    await wrapper.get('input[autocomplete="current-password"]').setValue("current-password");
    await wrapper.get("form").trigger("submit");
    await settle();

    expect(mocks.verifySuperAdminPassword).toHaveBeenCalledWith("current-password");
    expect(mocks.createSuperAdmin).toHaveBeenCalledWith({
      auth_email: "new-admin@example.test",
      password: "temporary-password",
    });
    expect(mocks.verifySuperAdminPassword.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createSuperAdmin.mock.invocationCallOrder[0]);
    expect(wrapper.text()).toContain("Super admin created");
    wrapper.unmount();
  });

  it("does not create a super admin when password confirmation fails", async () => {
    mocks.verifySuperAdminPassword.mockRejectedValue(new Error("Invalid password."));
    const wrapper = mount(SuperAdmins);
    await settle();

    await wrapper.get('input[type="email"]').setValue("new-admin@example.test");
    await wrapper.get('input[autocomplete="new-password"]').setValue("temporary-password");
    await wrapper.get('input[autocomplete="current-password"]').setValue("wrong-password");
    await wrapper.get("form").trigger("submit");
    await settle();

    expect(mocks.verifySuperAdminPassword).toHaveBeenCalledOnce();
    expect(mocks.createSuperAdmin).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Invalid password.");
    wrapper.unmount();
  });
});
