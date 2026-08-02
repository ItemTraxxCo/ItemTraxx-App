import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("../utils/deviceSession", () => ({
  getOrCreateDeviceSession: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  createTenantAccount,
  createTenantManagedAdmin,
  listTenantAccounts,
  listTenantManagedAdmins,
  removeTenantAccount,
  sendTenantAccountReset,
  sendTenantManagedAdminReset,
  setTenantAccountStatus,
  setTenantManagedAdminStatus,
  updateTenantManagedAdminEmail,
  type TenantManagedAdmin,
} from "./workspaceAdminManageService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const mockedDeviceSession = vi.mocked(getOrCreateDeviceSession);

const admin: TenantManagedAdmin = {
  id: "wa-1",
  workspace_id: "ws-1",
  auth_email: "admin@example.com",
  role: "workspace_admin",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  is_primary_admin: false,
};

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedDeviceSession.mockReturnValue({ deviceId: "device-1", deviceLabel: "Mac" });
});

describe("listTenantManagedAdmins", () => {
  it("stamps the device id/label onto the payload and returns the envelope data", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { data: { admins: [admin], can_manage_admins: true, primary_admin_profile_id: "wa-2" } },
    });

    const result = await listTenantManagedAdmins();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: {
        action: "list_workspace_admins",
        payload: { device_id: "device-1", device_label: "Mac" },
      },
    });
    expect(result).toEqual({ admins: [admin], can_manage_admins: true, primary_admin_profile_id: "wa-2" });
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(listTenantManagedAdmins()).rejects.toThrow("boom");
  });

  it("falls back to the default message when no error text is returned", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "", data: null });

    await expect(listTenantManagedAdmins()).rejects.toThrow("Workspace Admin request failed.");
  });
});

describe("createTenantManagedAdmin", () => {
  it("merges the caller payload with the device fields", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { data: { success: true, auth_email: "new@example.com" } },
    });

    const result = await createTenantManagedAdmin({ auth_email: "new@example.com" });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: {
        action: "create_workspace_admin",
        payload: { auth_email: "new@example.com", device_id: "device-1", device_label: "Mac" },
      },
    });
    expect(result).toEqual({ success: true, auth_email: "new@example.com" });
  });

  it("throws when the invite is rejected", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 409, error: "already invited", data: null });

    await expect(createTenantManagedAdmin({ auth_email: "new@example.com" })).rejects.toThrow("already invited");
  });
});

describe("setTenantManagedAdminStatus", () => {
  it("sends the id and is_active flag with the device fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: admin } });

    await setTenantManagedAdminStatus({ id: "wa-1", is_active: false });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: {
        action: "set_admin_status",
        payload: { id: "wa-1", is_active: false, device_id: "device-1", device_label: "Mac" },
      },
    });
  });
});

describe("updateTenantManagedAdminEmail", () => {
  it("sends the id and new email with the device fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: admin } });

    await updateTenantManagedAdminEmail({ id: "wa-1", auth_email: "new@example.com" });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: {
        action: "update_admin_email",
        payload: { id: "wa-1", auth_email: "new@example.com", device_id: "device-1", device_label: "Mac" },
      },
    });
  });
});

describe("sendTenantManagedAdminReset", () => {
  it("sends the auth_email with the device fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    const result = await sendTenantManagedAdminReset({ auth_email: "admin@example.com" });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: {
        action: "send_workspace_admin_reset",
        payload: { auth_email: "admin@example.com", device_id: "device-1", device_label: "Mac" },
      },
    });
    expect(result).toEqual({ success: true });
  });
});

describe("tenant account helpers", () => {
  it("listTenantAccounts sends only the device fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [] } });

    await listTenantAccounts();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: { action: "list_tenant_accounts", payload: { device_id: "device-1", device_label: "Mac" } },
    });
  });

  it("createTenantAccount sends the auth_email with the device fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: {} } });

    await createTenantAccount("tenant@example.com");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: {
        action: "create_tenant_account",
        payload: { auth_email: "tenant@example.com", device_id: "device-1", device_label: "Mac" },
      },
    });
  });

  it("setTenantAccountStatus sends the id and is_active flag", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: {} } });

    await setTenantAccountStatus("ta-1", true);

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: {
        action: "set_tenant_account_status",
        payload: { id: "ta-1", is_active: true, device_id: "device-1", device_label: "Mac" },
      },
    });
  });

  it("removeTenantAccount sends the id", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    const result = await removeTenantAccount("ta-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: { action: "remove_tenant_account", payload: { id: "ta-1", device_id: "device-1", device_label: "Mac" } },
    });
    expect(result).toEqual({ success: true });
  });

  it("sendTenantAccountReset sends the id", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    await sendTenantAccountReset("ta-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-admin-mutate", {
      method: "POST",
      body: {
        action: "send_tenant_account_reset",
        payload: { id: "ta-1", device_id: "device-1", device_label: "Mac" },
      },
    });
  });

  it("throws a mapped error when a tenant account request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 403, error: "not permitted", data: null });

    await expect(removeTenantAccount("ta-1")).rejects.toThrow("not permitted");
  });
});
