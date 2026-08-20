import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthState, setAuthStateFromBackend, setWorkspaceContext } from "../store/authState";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("./authenticatedDataClient", () => ({
  authenticatedSelect: vi.fn(),
}));
vi.mock("../utils/deviceSession", () => ({
  getOrCreateDeviceSession: vi.fn(() => ({ deviceId: "device-1", deviceLabel: "Mac" })),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect } from "./authenticatedDataClient";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  bulkCreateBorrowers,
  createBorrower,
  deleteBorrower,
  fetchBorrowerDetails,
  fetchBorrowers,
  fetchDeletedBorrowers,
  restoreBorrower,
  updateBorrowerAccess,
} from "./borrowerService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const mockedSelect = vi.mocked(authenticatedSelect);
const mockedDeviceSession = vi.mocked(getOrCreateDeviceSession);

const WORKSPACE_ID = "ws-1";

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedSelect.mockReset();
  mockedDeviceSession.mockReturnValue({ deviceId: "device-1", deviceLabel: "Mac" });
  clearAuthState();
  setAuthStateFromBackend({ isAuthenticated: true, userId: "profile-1" });
  setWorkspaceContext(WORKSPACE_ID);
});

describe("fetchBorrowers", () => {
  it("throws a missing-context error without a workspace", async () => {
    setWorkspaceContext(null);
    await expect(fetchBorrowers()).rejects.toThrow(/missing workspace context/i);
  });

  it("requests borrowers scoped to the current workspace, excluding soft-deleted rows", async () => {
    mockedSelect.mockResolvedValue([{ id: "b-1" }] as never);

    const result = await fetchBorrowers();

    expect(mockedSelect).toHaveBeenCalledWith("borrowers", {
      select: "id,workspace_id,username,borrower_id,access_mode",
      workspace_id: `eq.${WORKSPACE_ID}`,
      deleted_at: "is.null",
      order: "created_at.desc",
    });
    expect(result).toEqual([{ id: "b-1" }]);
  });

  it("normalizes a null response to an empty array", async () => {
    mockedSelect.mockResolvedValue(null as never);
    expect(await fetchBorrowers()).toEqual([]);
  });
});

describe("fetchDeletedBorrowers", () => {
  it("returns the archived borrowers on success", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: [{ id: "b-2" }] },
    } as never);

    const result = await fetchDeletedBorrowers();
    expect(mockedInvoke).toHaveBeenCalledWith("admin-borrower-mutate", {
      method: "POST",
      body: { action: "list_deleted", payload: { device_id: "device-1" } },
    });
    expect(result).toEqual([{ id: "b-2" }]);
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "boom", data: null } as never);
    await expect(fetchDeletedBorrowers()).rejects.toThrow("boom");
  });
});

describe("createBorrower", () => {
  const payload = {
    workspace_id: WORKSPACE_ID,
    username: "jdoe",
    borrower_id: "1234AB",
    access_mode: "all" as const,
    profile_ids: [] as string[],
  };

  it("sends the create action, defaulting optional fields to empty strings", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { id: "b-1", ...payload } },
    } as never);

    const result = await createBorrower(payload);

    expect(mockedInvoke).toHaveBeenCalledWith("admin-borrower-mutate", {
      method: "POST",
      body: {
        action: "create",
        payload: {
          device_id: "device-1",
          workspace_id: payload.workspace_id,
          username: payload.username,
          borrower_id: payload.borrower_id,
          access_mode: payload.access_mode,
          profile_ids: payload.profile_ids,
        },
      },
    });
    expect(result).toMatchObject({ id: "b-1" });
  });

  it("defaults missing username/borrower_id to empty strings", async () => {
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: { data: {} } } as never);

    await createBorrower({ workspace_id: WORKSPACE_ID, access_mode: "all", profile_ids: [] });

    expect(mockedInvoke).toHaveBeenCalledWith(
      "admin-borrower-mutate",
      expect.objectContaining({
        body: expect.objectContaining({
          payload: expect.objectContaining({ username: "", borrower_id: "" }),
        }),
      })
    );
  });

  it("throws a mapped error with a fallback message when creation fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 422, error: "", data: null } as never);
    await expect(createBorrower(payload)).rejects.toThrow(/unable to create borrower/i);
  });
});

describe("updateBorrowerAccess", () => {
  it("sends the update_access action with device context", async () => {
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: { success: true } } as never);

    await updateBorrowerAccess({ id: "b-1", access_mode: "restricted", profile_ids: ["p-1"] });

    expect(mockedInvoke).toHaveBeenCalledWith("admin-borrower-mutate", {
      method: "POST",
      body: {
        action: "update_access",
        payload: {
          device_id: "device-1",
          id: "b-1",
          access_mode: "restricted",
          profile_ids: ["p-1"],
        },
      },
    });
  });

  it("throws when the update fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(
      updateBorrowerAccess({ id: "b-1", access_mode: "all", profile_ids: [] })
    ).rejects.toThrow(/unable to update tenant account access/i);
  });
});

describe("bulkCreateBorrowers", () => {
  it("sends the rows and returns the insertion summary", async () => {
    const summary = {
      inserted_count: 1,
      skipped_count: 1,
      inserted: [{ id: "b-1" }],
      skipped: [{ row: 2, reason: "duplicate borrower_id" }],
    };
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: { data: summary } } as never);

    const rows = [{ username: "jdoe", borrower_id: "1234AB" }, { username: "dup" }];
    const result = await bulkCreateBorrowers(rows);

    expect(mockedInvoke).toHaveBeenCalledWith("admin-borrower-mutate", {
      method: "POST",
      body: { action: "bulk_create", payload: { rows, device_id: "device-1" } },
    });
    expect(result).toEqual(summary);
  });

  it("throws a mapped error when the import fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(bulkCreateBorrowers([])).rejects.toThrow(/unable to import borrowers/i);
  });
});

describe("deleteBorrower / restoreBorrower", () => {
  it("deletes a borrower by id with the device id attached", async () => {
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: null } as never);

    await deleteBorrower("b-1");

    expect(mockedInvoke).toHaveBeenCalledWith("admin-borrower-mutate", {
      method: "POST",
      body: { action: "delete", payload: { id: "b-1", device_id: "device-1" } },
    });
  });

  it("throws when delete fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(deleteBorrower("b-1")).rejects.toThrow(/unable to remove borrower/i);
  });

  it("restores a borrower and returns the restored record", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { id: "b-1" } },
    } as never);

    const result = await restoreBorrower("b-1");
    expect(result).toMatchObject({ id: "b-1" });
  });

  it("throws when restore fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(restoreBorrower("b-1")).rejects.toThrow(/unable to restore borrower/i);
  });
});

describe("fetchBorrowerDetails", () => {
  it("throws a missing-context error without a workspace", async () => {
    setWorkspaceContext(null);
    await expect(fetchBorrowerDetails("b-1")).rejects.toThrow(/missing workspace context/i);
  });

  it("normalizes array-relation, object-relation, and null-relation item names", async () => {
    mockedSelect.mockImplementation(async (table: string, query: Record<string, string>) => {
      if (table === "items") {
        return [{ id: "item-1", name: "Drill", barcode: "BC-1" }] as never;
      }
      if (table === "item_logs" && query.action_type === "eq.checkout") {
        return [{ action_time: "2026-01-01T00:00:00Z", item: [{ name: "Drill" }] }] as never;
      }
      if (table === "item_logs" && query.action_type === "eq.return") {
        return [{ action_time: "2026-01-02T00:00:00Z", item: { name: "Hammer" } }] as never;
      }
      return [] as never;
    });

    const details = await fetchBorrowerDetails("b-1");

    expect(details.checkedOutItem).toEqual([{ id: "item-1", name: "Drill", barcode: "BC-1" }]);
    expect(details.lastCheckout).toEqual({ action_time: "2026-01-01T00:00:00Z", item_name: "Drill" });
    expect(details.lastReturn).toEqual({ action_time: "2026-01-02T00:00:00Z", item_name: "Hammer" });
  });

  it("returns nulls for checkout/return history when there is none, and defaults missing arrays", async () => {
    mockedSelect.mockResolvedValue(null as never);

    const details = await fetchBorrowerDetails("b-1");

    expect(details).toEqual({
      checkedOutItem: [],
      lastCheckout: null,
      lastReturn: null,
    });
  });

  it("resolves a null item relation to a null item_name", async () => {
    mockedSelect.mockImplementation(async (table: string, query: Record<string, string>) => {
      if (table === "items") return [] as never;
      if (table === "item_logs" && query.action_type === "eq.checkout") {
        return [{ action_time: "2026-01-01T00:00:00Z", item: null }] as never;
      }
      return [] as never;
    });

    const details = await fetchBorrowerDetails("b-1");
    expect(details.lastCheckout).toEqual({ action_time: "2026-01-01T00:00:00Z", item_name: null });
  });
});
