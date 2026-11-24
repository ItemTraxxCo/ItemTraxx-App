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
  bulkCreateBorrowers,
  createBorrower,
  deleteBorrower,
  fetchBorrowerAccessGrants,
  fetchBorrowerDetails,
  fetchBorrowerPage,
  fetchBorrowers,
  fetchSortedBorrowers,
  fetchDeletedBorrowers,
  restoreBorrower,
  updateBorrowerAccess,
} from "./borrowerService";

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

describe("fetchBorrowers", () => {
  it("throws a missing-context error without a workspace", async () => {
    setWorkspaceContext(null);
    await expect(fetchBorrowers()).rejects.toThrow(/missing workspace context/i);
    expect(mockedSelectPage).not.toHaveBeenCalled();
  });

  it("requests borrowers scoped to the current workspace, excluding soft-deleted rows", async () => {
    mockedSelectPage.mockResolvedValue({ rows: [{ id: "b-1" }], hasMore: false } as never);

    const result = await fetchBorrowers();

    expect(mockedSelectPage).toHaveBeenCalledWith("borrowers", {
      select: "id,workspace_id,username,borrower_id,access_mode",
      workspace_id: `eq.${WORKSPACE_ID}`,
      deleted_at: "is.null",
      order: "created_at.desc",
    }, { page: 0, pageSize: 500 });
    expect(result).toEqual([{ id: "b-1" }]);
  });

  it("normalizes a null response to an empty array", async () => {
    mockedSelectPage.mockResolvedValue({ rows: [], hasMore: false } as never);
    expect(await fetchBorrowers()).toEqual([]);
  });

  it("accumulates bounded pages for admin search and export", async () => {
    mockedSelectPage
      .mockResolvedValueOnce({
        rows: Array.from({ length: 500 }, (_, index) => ({ id: `borrower-${index}` })),
        hasMore: true,
      } as never)
      .mockResolvedValueOnce({ rows: [{ id: "borrower-500" }], hasMore: false } as never);

    const result = await fetchBorrowers();

    expect(result).toHaveLength(501);
    expect(mockedSelectPage).toHaveBeenNthCalledWith(2, "borrowers", expect.any(Object), {
      page: 1,
      pageSize: 500,
    });
  });
});

describe("fetchBorrowerPage", () => {
  it("requests a bounded workspace-scoped page", async () => {
    mockedSelectPage.mockResolvedValue({ rows: [{ id: "b-1" }], hasMore: false } as never);

    const result = await fetchBorrowerPage(1, 20, "username.asc");

    expect(mockedSelectPage).toHaveBeenCalledWith("borrowers", {
      select: "id,workspace_id,username,borrower_id,access_mode",
      workspace_id: `eq.${WORKSPACE_ID}`,
      deleted_at: "is.null",
      order: "username.asc",
    }, { page: 1, pageSize: 20 });
    expect(result).toEqual({ rows: [{ id: "b-1" }], hasMore: false });
  });
});

describe("borrower access grants", () => {
  it("does not query when there are no restricted borrowers", async () => {
    await expect(fetchBorrowerAccessGrants([])).resolves.toEqual([]);
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it("loads grants through the service boundary", async () => {
    mockedSelect.mockResolvedValueOnce([{ borrower_id: "b-1", profile_id: "profile-1" }] as never);

    await expect(fetchBorrowerAccessGrants(["b-1"])).resolves.toEqual([
      { borrower_id: "b-1", profile_id: "profile-1" },
    ]);
    expect(mockedSelect).toHaveBeenCalledWith("borrower_access_grants", {
      select: "borrower_id,profile_id",
      borrower_id: "in.(b-1)",
    });
  });

  it("chunks large grant lookups to keep query URLs bounded", async () => {
    mockedSelect.mockResolvedValue([] as never);
    const borrowerIds = Array.from({ length: 101 }, (_, index) => `borrower-${index}`);

    await expect(fetchBorrowerAccessGrants(borrowerIds)).resolves.toEqual([]);

    expect(mockedSelect).toHaveBeenCalledTimes(2);
    expect(mockedSelect.mock.calls[0]?.[1]?.borrower_id).toBe(
      `in.(${borrowerIds.slice(0, 100).join(",")})`,
    );
    expect(mockedSelect.mock.calls[1]?.[1]?.borrower_id).toBe("in.(borrower-100)");
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

describe('encrypted directory preview', () => {
  it('sorts decrypted records across pages by name before pagination', async () => {
    vi.stubEnv('VITE_ENCRYPTED_BORROWERS_LOCAL', 'true');
    try {
      mockedInvoke.mockResolvedValueOnce({ ok: true, data: { data: { rows: [{ id: 'z', username: 'Zoe', borrower_id: '2' }], hasMore: true } } } as never)
        .mockResolvedValueOnce({ ok: true, data: { data: { rows: [{ id: 'a', username: 'Ada', borrower_id: '1' }], hasMore: false } } } as never);
      expect((await fetchSortedBorrowers()).map(row => row.username)).toEqual(['Ada', 'Zoe']);
      expect(mockedSelectPage).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it('loads bounded broker pages and fails closed on broker failure', async () => {
    vi.stubEnv('VITE_ENCRYPTED_BORROWERS_LOCAL', 'true');
    try {
      mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, data: { data: { rows: [{ id: 'b-1', username: 'Alice', borrower_id: '123' }], hasMore: false } } } as never);
      expect(await fetchBorrowerPage(0, 20)).toEqual({ rows: [{ id: 'b-1', username: 'Alice', borrower_id: '123' }], hasMore: false });
      expect(mockedInvoke).toHaveBeenCalledWith('crypto-broker', { method: 'POST', body: { action: 'list', page: 0, page_size: 20, device_id: 'device-1' } });
      mockedInvoke.mockResolvedValueOnce({ ok: false, status: 503, error: 'unavailable', data: null } as never);
      await expect(fetchBorrowerPage(0, 20)).rejects.toThrow();
      expect(mockedSelectPage).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
});

it('limits the encrypted directory buffer rather than accumulating an unbounded result', async () => {
  vi.stubEnv('VITE_ENCRYPTED_BORROWERS_LOCAL', 'true');
  try {
    const batch = Array.from({ length: 50 }, (_, i) => ({ id: String(i), username: 'User', borrower_id: String(i) }));
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, data: { data: { rows: batch, hasMore: true } } } as never);
    await expect(fetchBorrowers()).rejects.toThrow(/directory.*limit/i);
    expect(mockedInvoke).toHaveBeenCalledTimes(201);
  } finally { vi.unstubAllEnvs(); }
});

it('creates a named borrower through the encrypted broker without legacy plaintext writes', async () => {
  mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, data: { data: { id: 'b-1', username: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'ID123' } } } as never);
  const result = await createBorrower({ workspace_id: WORKSPACE_ID, first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'ID123', email: 'ada@example.test', access_mode: 'all', profile_ids: [] });
  expect(result.first_name).toBe('Ada');
  expect(mockedInvoke).toHaveBeenCalledWith('crypto-broker', { method: 'POST', body: { action: 'create', device_id: 'device-1', payload: { first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'ID123', email: 'ada@example.test', access_mode: 'all', profile_ids: [] } } });
});

it('uses the encrypted broker for archived pages and restoration without a plaintext fallback', async () => {
  vi.stubEnv('VITE_ENCRYPTED_BORROWERS_LOCAL', 'true');
  try {
    const row = { id: 'b-1', username: 'Ada Lovelace', borrower_id: 'ABC123' };
    mockedInvoke.mockResolvedValueOnce({ ok: true, data: { data: { rows: [row], hasMore: false } } } as never)
      .mockResolvedValueOnce({ ok: true, data: { data: row } } as never);
    expect(await fetchDeletedBorrowers()).toEqual([row]);
    expect(mockedInvoke).toHaveBeenNthCalledWith(1, 'crypto-broker', { method: 'POST', body: { action: 'list', archived: true, page: 0, page_size: 50, device_id: 'device-1' } });
    expect(await restoreBorrower('b-1')).toEqual(row);
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, 'crypto-broker', { method: 'POST', body: { action: 'restore', id: 'b-1', device_id: 'device-1' } });
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 503, error: 'unavailable' } as never);
    await expect(fetchDeletedBorrowers()).rejects.toThrow();
  } finally { vi.unstubAllEnvs(); }
});
