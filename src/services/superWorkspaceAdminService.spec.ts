import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  createWorkspaceAdmin,
  listWorkspaceAdmins,
  sendWorkspaceAdminReset,
  setWorkspaceAdminStatus,
  type SuperWorkspaceAdmin,
} from "./superWorkspaceAdminService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const admin: SuperWorkspaceAdmin = {
  id: "wa-1",
  workspace_id: "ws-1",
  auth_email: "admin@example.com",
  role: "workspace_admin",
  is_active: true,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("listWorkspaceAdmins", () => {
  it("defaults to an empty search and scope 'all'", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [admin] } });

    const result = await listWorkspaceAdmins();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "list_workspace_admins", payload: { search: "", workspace_id: "all" } },
    });
    expect(result).toEqual([admin]);
  });

  it("scopes the request to a specific workspace and search term", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [] } });

    await listWorkspaceAdmins("admin", "ws-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith(
      "super-admin-mutate",
      expect.objectContaining({
        body: { action: "list_workspace_admins", payload: { search: "admin", workspace_id: "ws-1" } },
      })
    );
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(listWorkspaceAdmins()).rejects.toThrow("boom");
  });

  it("falls back to the default message when no error text is returned", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "", data: null });

    await expect(listWorkspaceAdmins()).rejects.toThrow("Workspace Admin request failed.");
  });
});

describe("createWorkspaceAdmin", () => {
  it("sends the workspace_id and auth_email", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: admin } });

    const result = await createWorkspaceAdmin("ws-1", "admin@example.com");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "create_workspace_admin", payload: { workspace_id: "ws-1", auth_email: "admin@example.com" } },
    });
    expect(result).toEqual(admin);
  });

  it("throws when creation fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 409, error: "already exists", data: null });

    await expect(createWorkspaceAdmin("ws-1", "admin@example.com")).rejects.toThrow("already exists");
  });
});

describe("setWorkspaceAdminStatus", () => {
  it("sends the id and is_active flag", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: admin } });

    await setWorkspaceAdminStatus("wa-1", false);

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "set_workspace_admin_status", payload: { id: "wa-1", is_active: false } },
    });
  });
});

describe("sendWorkspaceAdminReset", () => {
  it("sends the id and returns the success flag", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    const result = await sendWorkspaceAdminReset("wa-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "send_workspace_admin_reset", payload: { id: "wa-1" } },
    });
    expect(result).toEqual({ success: true });
  });
});
