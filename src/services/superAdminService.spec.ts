import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  createSuperAdmin,
  listSuperAdmins,
  sendSuperAdminReset,
  setSuperAdminStatus,
  updateSuperAdminEmail,
} from "./superAdminService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const account = {
  id: "sa-1",
  auth_email: "root@itemtraxx.com",
  role: "super_admin" as const,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("listSuperAdmins", () => {
  it("requests list_super_admins with an empty search by default", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [account] } });

    const result = await listSuperAdmins();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "list_super_admins", payload: { search: "" } },
    });
    expect(result).toEqual([account]);
  });

  it("passes through a search term", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [] } });

    await listSuperAdmins("root");

    expect(invokeEdgeFunction).toHaveBeenCalledWith(
      "super-admin-mutate",
      expect.objectContaining({ body: { action: "list_super_admins", payload: { search: "root" } } })
    );
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(listSuperAdmins()).rejects.toThrow("boom");
  });

  it("falls back to a generic message when the server returns no error text", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "", data: null });

    await expect(listSuperAdmins()).rejects.toThrow("Super Admin request failed.");
  });
});

describe("createSuperAdmin", () => {
  it("sends the auth_email and password payload", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: account } });

    const result = await createSuperAdmin({ auth_email: "root@itemtraxx.com", password: "hunter2" });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: {
        action: "create_super_admin",
        payload: { auth_email: "root@itemtraxx.com", password: "hunter2" },
      },
    });
    expect(result).toEqual(account);
  });

  it("throws when creation fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 409, error: "already exists", data: null });

    await expect(createSuperAdmin({ auth_email: "root@itemtraxx.com", password: "hunter2" })).rejects.toThrow(
      "already exists"
    );
  });
});

describe("setSuperAdminStatus", () => {
  it("sends the id and is_active flag", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: account } });

    await setSuperAdminStatus({ id: "sa-1", is_active: false });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "set_super_admin_status", payload: { id: "sa-1", is_active: false } },
    });
  });
});

describe("updateSuperAdminEmail", () => {
  it("sends the id and new email", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: account } });

    await updateSuperAdminEmail({ id: "sa-1", auth_email: "new@itemtraxx.com" });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "update_super_admin_email", payload: { id: "sa-1", auth_email: "new@itemtraxx.com" } },
    });
  });
});

describe("sendSuperAdminReset", () => {
  it("sends the auth_email and returns the success flag", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    const result = await sendSuperAdminReset({ auth_email: "root@itemtraxx.com" });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "send_super_admin_reset", payload: { auth_email: "root@itemtraxx.com" } },
    });
    expect(result).toEqual({ success: true });
  });

  it("throws a 401-mapped unauthorized error", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized", data: null });

    await expect(sendSuperAdminReset({ auth_email: "root@itemtraxx.com" })).rejects.toThrow();
  });
});
