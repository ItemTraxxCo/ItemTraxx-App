import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthState, setAuthStateFromBackend, setWorkspaceContext } from "../store/authState";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("./authenticatedDataClient", () => ({
  authenticatedSelect: vi.fn(),
  authenticatedSelectPage: vi.fn(),
}));
vi.mock("../utils/deviceSession", () => ({
  getOrCreateDeviceSession: vi.fn(() => ({ deviceId: "device-1", deviceLabel: "Mac" })),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect, authenticatedSelectPage } from "./authenticatedDataClient";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  createItem,
  deleteItem,
  fetchDeletedItem,
  fetchItem,
  fetchItemAccessGrantProfiles,
  fetchItemAccessGrants,
  fetchItemPage,
  fetchItemLogs,
  restoreItem,
  updateItem,
} from "./itemService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const mockedSelect = vi.mocked(authenticatedSelect);
const mockedSelectPage = vi.mocked(authenticatedSelectPage);
const mockedDeviceSession = vi.mocked(getOrCreateDeviceSession);

const WORKSPACE_ID = "ws-1";

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedSelect.mockReset();
  mockedSelectPage.mockReset();
  mockedDeviceSession.mockReturnValue({ deviceId: "device-1", deviceLabel: "Mac" });
  clearAuthState();
  setAuthStateFromBackend({ isAuthenticated: true, userId: "profile-1" });
  setWorkspaceContext(WORKSPACE_ID);
});

describe("fetchItem", () => {
  it("throws a missing-context error when there is no workspace in scope", async () => {
    setWorkspaceContext(null);
    await expect(fetchItem()).rejects.toThrow(/missing workspace context/i);
    expect(mockedSelectPage).not.toHaveBeenCalled();
  });

  it("requests items scoped to the current workspace, excluding soft-deleted rows", async () => {
    mockedSelectPage.mockResolvedValue({ rows: [{ id: "item-1" }], hasMore: false } as never);

    const result = await fetchItem();

    expect(mockedSelectPage).toHaveBeenCalledWith("items", {
      select: "id,workspace_id,name,barcode,serial_number,status,notes,access_mode",
      workspace_id: `eq.${WORKSPACE_ID}`,
      deleted_at: "is.null",
      order: "created_at.desc",
    }, { page: 0, pageSize: 500 });
    expect(result).toEqual([{ id: "item-1" }]);
  });

  it("normalizes a null response to an empty array", async () => {
    mockedSelectPage.mockResolvedValue({ rows: [], hasMore: false } as never);
    expect(await fetchItem()).toEqual([]);
  });

  it("accumulates bounded pages for admin search and export", async () => {
    mockedSelectPage
      .mockResolvedValueOnce({
        rows: Array.from({ length: 500 }, (_, index) => ({ id: `item-${index}` })),
        hasMore: true,
      } as never)
      .mockResolvedValueOnce({ rows: [{ id: "item-500" }], hasMore: false } as never);

    const result = await fetchItem();

    expect(result).toHaveLength(501);
    expect(mockedSelectPage).toHaveBeenNthCalledWith(2, "items", expect.any(Object), {
      page: 1,
      pageSize: 500,
    });
  });
});

describe("fetchItemPage", () => {
  it("requests a bounded workspace-scoped page", async () => {
    mockedSelectPage.mockResolvedValue({ rows: [{ id: "item-1" }], hasMore: true } as never);

    const result = await fetchItemPage(2, 20, "name.asc");

    expect(mockedSelectPage).toHaveBeenCalledWith("items", {
      select: "id,workspace_id,name,barcode,serial_number,status,notes,access_mode",
      workspace_id: `eq.${WORKSPACE_ID}`,
      deleted_at: "is.null",
      order: "name.asc",
    }, { page: 2, pageSize: 20 });
    expect(result).toEqual({ rows: [{ id: "item-1" }], hasMore: true });
  });
});

describe("item access grants", () => {
  it("does not query when there are no restricted items", async () => {
    await expect(fetchItemAccessGrants([])).resolves.toEqual([]);
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it("loads grants through the service boundary", async () => {
    mockedSelect
      .mockResolvedValueOnce([{ item_id: "item-1", profile_id: "profile-1" }] as never)
      .mockResolvedValueOnce([{ profile_id: "profile-1" }] as never);

    await expect(fetchItemAccessGrants(["item-1"])).resolves.toEqual([
      { item_id: "item-1", profile_id: "profile-1" },
    ]);
    await expect(fetchItemAccessGrantProfiles("item-1")).resolves.toEqual([{ profile_id: "profile-1" }]);
    expect(mockedSelect).toHaveBeenNthCalledWith(1, "item_access_grants", {
      select: "item_id,profile_id",
      item_id: "in.(item-1)",
    });
    expect(mockedSelect).toHaveBeenNthCalledWith(2, "item_access_grants", {
      select: "profile_id",
      item_id: "eq.item-1",
    });
  });

  it("chunks large grant lookups to keep query URLs bounded", async () => {
    mockedSelect.mockResolvedValue([] as never);
    const itemIds = Array.from({ length: 101 }, (_, index) => `item-${index}`);

    await expect(fetchItemAccessGrants(itemIds)).resolves.toEqual([]);

    expect(mockedSelect).toHaveBeenCalledTimes(2);
    expect(mockedSelect.mock.calls[0]?.[1]?.item_id).toBe(
      `in.(${itemIds.slice(0, 100).join(",")})`,
    );
    expect(mockedSelect.mock.calls[1]?.[1]?.item_id).toBe("in.(item-100)");
  });
});

describe("fetchDeletedItem", () => {
  it("returns the archived items on success", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: [{ id: "item-2" }] },
    } as never);

    const result = await fetchDeletedItem();

    expect(mockedInvoke).toHaveBeenCalledWith("admin-item-mutate", {
      method: "POST",
      body: { action: "list_deleted", payload: { device_id: "device-1" } },
    });
    expect(result).toEqual([{ id: "item-2" }]);
  });

  it("defaults to an empty array when data is missing", async () => {
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: {} } as never);
    expect(await fetchDeletedItem()).toEqual([]);
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "boom", data: null } as never);
    await expect(fetchDeletedItem()).rejects.toThrow("boom");
  });
});

describe("createItem", () => {
  const payload = {
    workspace_id: WORKSPACE_ID,
    name: "Drill",
    barcode: "BC-1",
    status: "available",
    access_mode: "all" as const,
    profile_ids: [] as string[],
  };

  it("sends the create action with device context and optional fields defaulted", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { id: "item-1", ...payload } },
    } as never);

    const result = await createItem(payload);

    expect(mockedInvoke).toHaveBeenCalledWith("admin-item-mutate", {
      method: "POST",
      body: {
        action: "create",
        payload: {
          device_id: "device-1",
          workspace_id: payload.workspace_id,
          name: payload.name,
          barcode: payload.barcode,
          serial_number: null,
          status: payload.status,
          notes: null,
          access_mode: payload.access_mode,
          profile_ids: payload.profile_ids,
        },
      },
    });
    expect(result).toMatchObject({ id: "item-1" });
  });

  it("throws a mapped error with a fallback message when creation fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 422, error: "", data: null } as never);
    await expect(createItem(payload)).rejects.toThrow(/unable to create item/i);
  });
});

describe("updateItem", () => {
  const payload = {
    id: "item-1",
    name: "Drill",
    barcode: "BC-1",
    status: "available",
    access_mode: "restricted" as const,
    profile_ids: ["p-1"],
  };

  it("sends the update action and returns the updated item", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { ...payload } },
    } as never);

    const result = await updateItem(payload);

    expect(mockedInvoke).toHaveBeenCalledWith("admin-item-mutate", {
      method: "POST",
      body: {
        action: "update",
        payload: {
          device_id: "device-1",
          id: payload.id,
          name: payload.name,
          barcode: payload.barcode,
          status: payload.status,
          notes: null,
          access_mode: payload.access_mode,
          profile_ids: payload.profile_ids,
        },
      },
    });
    expect(result).toMatchObject({ id: "item-1" });
  });

  it("throws when the update request fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(updateItem(payload)).rejects.toThrow(/unable to update item/i);
  });
});

describe("deleteItem / restoreItem", () => {
  it("deletes an item by id with the device id attached", async () => {
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: null } as never);

    await deleteItem("item-1");

    expect(mockedInvoke).toHaveBeenCalledWith("admin-item-mutate", {
      method: "POST",
      body: { action: "delete", payload: { id: "item-1", device_id: "device-1" } },
    });
  });

  it("throws when delete fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(deleteItem("item-1")).rejects.toThrow(/unable to remove item/i);
  });

  it("restores an item and returns the restored record", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { id: "item-1", status: "available" } },
    } as never);

    const result = await restoreItem("item-1");
    expect(result).toMatchObject({ id: "item-1" });
  });

  it("throws when restore fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(restoreItem("item-1")).rejects.toThrow(/unable to restore item/i);
  });
});

describe("fetchItemLogs", () => {
  it("throws a missing-context error without a workspace", async () => {
    setWorkspaceContext(null);
    await expect(fetchItemLogs()).rejects.toThrow(/missing workspace context/i);
  });

  it("joins performer profiles and normalizes array/object/null relations", async () => {
    mockedSelect.mockImplementation(async (table: string) => {
      if (table === "item_logs") {
        return [
          {
            id: "log-1",
            workspace_id: WORKSPACE_ID,
            item_id: "item-1",
            checked_out_by: "b-1",
            action_type: "checkout",
            action_time: "2026-01-01T00:00:00Z",
            performed_by: "perf-1",
            item: [{ name: "Drill", barcode: "BC-1" }],
            borrower: { username: "jdoe", borrower_id: "1234AB" },
          },
          {
            id: "log-2",
            workspace_id: WORKSPACE_ID,
            item_id: "item-2",
            checked_out_by: null,
            action_type: "return",
            action_time: "2026-01-02T00:00:00Z",
            performed_by: null,
            item: null,
            borrower: null,
          },
        ] as never;
      }
      if (table === "profiles") {
        return [{ id: "perf-1", auth_email: "admin@example.com" }] as never;
      }
      return [] as never;
    });

    const rows = await fetchItemLogs();

    expect(mockedSelect).toHaveBeenCalledWith(
      "profiles",
      expect.objectContaining({ id: "in.(perf-1)" })
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "log-1",
      tenant_account: { id: "perf-1", auth_email: "admin@example.com" },
      item: { name: "Drill", barcode: "BC-1" },
      borrower: { username: "jdoe", borrower_id: "1234AB" },
    });
    expect(rows[1]).toMatchObject({
      id: "log-2",
      tenant_account: null,
      item: null,
      borrower: null,
    });
  });

  it("skips the profiles lookup when no row has a performer", async () => {
    mockedSelect.mockImplementation(async (table: string) => {
      if (table === "item_logs") {
        return [
          {
            id: "log-1",
            workspace_id: WORKSPACE_ID,
            item_id: "item-1",
            checked_out_by: null,
            action_type: "checkout",
            action_time: "2026-01-01T00:00:00Z",
            performed_by: null,
            item: null,
            borrower: null,
          },
        ] as never;
      }
      return [] as never;
    });

    const rows = await fetchItemLogs();

    expect(mockedSelect).toHaveBeenCalledTimes(1);
    expect(rows[0]!.tenant_account).toBeNull();
  });

  it("defaults to an empty array when item_logs lookup returns null", async () => {
    mockedSelect.mockResolvedValue(null as never);
    expect(await fetchItemLogs()).toEqual([]);
  });
});
