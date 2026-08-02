import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  createTenantAccount,
  listTenantAccounts,
  removeTenantAccount,
  sendTenantAccountReset,
  setTenantAccountStatus,
  updateTenantAccountEmail,
  type SuperTenantAccount,
} from "./superTenantAccountService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const tenantAccount: SuperTenantAccount = {
  id: "ta-1",
  workspace_id: "ws-1",
  workspace_name: "Acme",
  auth_email: "tenant@example.com",
  role: "tenant_account",
  is_active: true,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("listTenantAccounts", () => {
  it("defaults to an empty search and scope 'all'", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [tenantAccount] } });

    const result = await listTenantAccounts();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "list_tenant_accounts", payload: { search: "", workspace_id: "all" } },
    });
    expect(result).toEqual([tenantAccount]);
  });

  it("scopes the request to a specific workspace and search term", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [] } });

    await listTenantAccounts("tenant", "ws-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith(
      "super-admin-mutate",
      expect.objectContaining({
        body: { action: "list_tenant_accounts", payload: { search: "tenant", workspace_id: "ws-1" } },
      })
    );
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(listTenantAccounts()).rejects.toThrow("boom");
  });
});

describe("createTenantAccount", () => {
  it("sends the workspace_id and auth_email", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: tenantAccount } });

    const result = await createTenantAccount("ws-1", "tenant@example.com");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "create_tenant_account", payload: { workspace_id: "ws-1", auth_email: "tenant@example.com" } },
    });
    expect(result).toEqual(tenantAccount);
  });

  it("throws when creation fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 409, error: "already exists", data: null });

    await expect(createTenantAccount("ws-1", "tenant@example.com")).rejects.toThrow("already exists");
  });
});

describe("setTenantAccountStatus", () => {
  it("sends the id and is_active flag", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: tenantAccount } });

    await setTenantAccountStatus("ta-1", false);

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "set_tenant_account_status", payload: { id: "ta-1", is_active: false } },
    });
  });
});

describe("updateTenantAccountEmail", () => {
  it("sends the id and new email", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: tenantAccount } });

    await updateTenantAccountEmail("ta-1", "new@example.com");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "update_tenant_account_email", payload: { id: "ta-1", auth_email: "new@example.com" } },
    });
  });
});

describe("sendTenantAccountReset", () => {
  it("sends the id and returns the success flag", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    const result = await sendTenantAccountReset("ta-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "send_tenant_account_reset", payload: { id: "ta-1" } },
    });
    expect(result).toEqual({ success: true });
  });
});

describe("removeTenantAccount", () => {
  it("sends the id to remove", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    const result = await removeTenantAccount("ta-1");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-admin-mutate", {
      method: "POST",
      body: { action: "remove_tenant_account", payload: { id: "ta-1" } },
    });
    expect(result).toEqual({ success: true });
  });

  it("throws when removal is rejected", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 400, error: "cannot remove primary admin", data: null });

    await expect(removeTenantAccount("ta-1")).rejects.toThrow("cannot remove primary admin");
  });
});
