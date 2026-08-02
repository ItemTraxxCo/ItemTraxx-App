import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  createWorkspace,
  listWorkspaces,
  sendPrimaryWorkspaceAdminReset,
  setPrimaryWorkspaceAdmin,
  setWorkspaceStatus,
  updateWorkspace,
  type SuperWorkspace,
  type WorkspacePolicyInput,
} from "./superWorkspaceService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const workspace: SuperWorkspace = {
  id: "ws-1",
  name: "Acme High",
  slug: "acme",
  status: "active",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  primary_admin_profile_id: null,
  primary_admin_email: null,
};

const policy: WorkspacePolicyInput = {
  account_category: "education",
  checkout_due_hours: 24,
  feature_flags: { enable_notifications: true },
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("listWorkspaces", () => {
  it("defaults to an empty search and status 'all'", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [workspace] } });

    const result = await listWorkspaces();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-workspace-mutate", {
      method: "POST",
      body: { action: "list_workspaces", payload: { search: "", status: "all" } },
    });
    expect(result).toEqual([workspace]);
  });

  it("scopes the request to a status and search term", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [] } });

    await listWorkspaces("acme", "suspended");

    expect(invokeEdgeFunction).toHaveBeenCalledWith(
      "super-workspace-mutate",
      expect.objectContaining({ body: { action: "list_workspaces", payload: { search: "acme", status: "suspended" } } })
    );
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(listWorkspaces()).rejects.toThrow("boom");
  });
});

describe("createWorkspace", () => {
  it("sends the full workspace creation payload including policy fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: workspace } });

    const payload = {
      ...policy,
      name: "Acme High",
      slug: "acme",
      auth_email: "admin@acme.edu",
      password: "hunter2",
    };
    const result = await createWorkspace(payload);

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-workspace-mutate", {
      method: "POST",
      body: { action: "create_workspace", payload },
    });
    expect(result).toEqual(workspace);
  });

  it("throws when creation fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 409, error: "slug taken", data: null });

    await expect(
      createWorkspace({ ...policy, name: "Acme High", slug: "acme", auth_email: "admin@acme.edu", password: "hunter2" })
    ).rejects.toThrow("slug taken");
  });
});

describe("updateWorkspace", () => {
  it("sends the id alongside the policy and identity fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: workspace } });

    const payload = { ...policy, id: "ws-1", name: "Acme High", slug: "acme" };
    await updateWorkspace(payload);

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-workspace-mutate", {
      method: "POST",
      body: { action: "update_workspace", payload },
    });
  });
});

describe("setWorkspaceStatus", () => {
  it("sends the id and target status", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: workspace } });

    await setWorkspaceStatus("ws-1", "suspended");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-workspace-mutate", {
      method: "POST",
      body: { action: "set_workspace_status", payload: { id: "ws-1", status: "suspended" } },
    });
  });
});

describe("setPrimaryWorkspaceAdmin", () => {
  it("sends the workspace_id and profile_id", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: workspace } });

    await setPrimaryWorkspaceAdmin("ws-1", "profile-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-workspace-mutate", {
      method: "POST",
      body: { action: "set_primary_admin", payload: { workspace_id: "ws-1", profile_id: "profile-1" } },
    });
  });
});

describe("sendPrimaryWorkspaceAdminReset", () => {
  it("sends the workspace_id and returns the reset email", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { data: { success: true, auth_email: "admin@acme.edu" } },
    });

    const result = await sendPrimaryWorkspaceAdminReset("ws-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-workspace-mutate", {
      method: "POST",
      body: { action: "send_primary_admin_reset", payload: { workspace_id: "ws-1" } },
    });
    expect(result).toEqual({ success: true, auth_email: "admin@acme.edu" });
  });

  it("throws when there is no primary admin to reset", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 400, error: "no primary admin set", data: null });

    await expect(sendPrimaryWorkspaceAdminReset("ws-1")).rejects.toThrow("no primary admin set");
  });
});
