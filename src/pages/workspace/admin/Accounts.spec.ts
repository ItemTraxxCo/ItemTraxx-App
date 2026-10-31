import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthState, setAuthStateFromBackend } from "../../../store/authState";

const mocks = vi.hoisted(() => ({
  listWorkspaceAccounts: vi.fn(),
}));

vi.mock("../../../services/workspaceAdminManageService", () => ({
  createTenantAccount: vi.fn(),
  listWorkspaceAccounts: mocks.listWorkspaceAccounts,
  removeTenantAccount: vi.fn(),
  sendTenantAccountReset: vi.fn(),
  setTenantAccountStatus: vi.fn(),
  setWorkspaceAccountRole: vi.fn(),
  sendTenantManagedAdminReset: vi.fn(),
  setTenantManagedAdminStatus: vi.fn(),
}));

import Accounts from "./Accounts.vue";

const account = (overrides: Record<string, unknown>) => ({
  id: "account",
  workspace_id: "workspace-1",
  auth_email: "account@example.test",
  role: "tenant_account",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  is_primary_admin: false,
  ...overrides,
});

const accounts = [
  account({ id: "primary", auth_email: "primary@example.test", role: "workspace_admin", is_primary_admin: true }),
  account({ id: "me", auth_email: "me@example.test", role: "workspace_admin" }),
  account({ id: "other-admin", auth_email: "other-admin@example.test", role: "workspace_admin" }),
  account({ id: "tenant", auth_email: "tenant@example.test", role: "tenant_account" }),
];

const mountAs = async (canManageAdmins: boolean) => {
  mocks.listWorkspaceAccounts.mockResolvedValue({ accounts, can_manage_admins: canManageAdmins });
  const wrapper = mount(Accounts, {
    global: {
      stubs: { RouterLink: true },
      directives: { "app-toast-error": {} },
    },
  });
  await flushPromises();
  return wrapper;
};

const roleSelectDisabled = (wrapper: Awaited<ReturnType<typeof mountAs>>, email: string) =>
  wrapper.get(`select[aria-label="Role for ${email}"]`).attributes("disabled") !== undefined;

describe("workspace account role controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthState();
    setAuthStateFromBackend({
      isAuthenticated: true,
      userId: "me",
      role: "tenant_admin",
    } as never);
  });

  it("lets a non-primary admin promote tenant accounts but not demote admins", async () => {
    const wrapper = await mountAs(false);

    expect(roleSelectDisabled(wrapper, "tenant@example.test")).toBe(false);
    expect(roleSelectDisabled(wrapper, "other-admin@example.test")).toBe(true);
    expect(roleSelectDisabled(wrapper, "primary@example.test")).toBe(true);
    expect(roleSelectDisabled(wrapper, "me@example.test")).toBe(true);
  });

  it("lets the primary admin change every role except their own and the primary admin's", async () => {
    const wrapper = await mountAs(true);

    expect(roleSelectDisabled(wrapper, "tenant@example.test")).toBe(false);
    expect(roleSelectDisabled(wrapper, "other-admin@example.test")).toBe(false);
    expect(roleSelectDisabled(wrapper, "primary@example.test")).toBe(true);
    expect(roleSelectDisabled(wrapper, "me@example.test")).toBe(true);
  });
});
