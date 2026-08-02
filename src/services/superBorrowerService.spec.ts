import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  createSuperBorrower,
  deleteSuperBorrower,
  listSuperBorrowers,
  type SuperBorrowerItem,
} from "./superBorrowerService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const borrower: SuperBorrowerItem = {
  id: "b-1",
  workspace_id: "ws-1",
  username: "jdoe",
  borrower_id: "1234AB",
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("listSuperBorrowers", () => {
  it("defaults to scope 'all' and an empty search", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [borrower] } });

    const result = await listSuperBorrowers();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-borrower-mutate", {
      method: "POST",
      body: { action: "list", payload: { workspace_id: "all", search: "" } },
    });
    expect(result).toEqual([borrower]);
  });

  it("scopes the request to a specific workspace and search term", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [] } });

    await listSuperBorrowers("ws-1", "jdoe");

    expect(invokeEdgeFunction).toHaveBeenCalledWith(
      "super-borrower-mutate",
      expect.objectContaining({ body: { action: "list", payload: { workspace_id: "ws-1", search: "jdoe" } } })
    );
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(listSuperBorrowers()).rejects.toThrow("boom");
  });
});

describe("createSuperBorrower", () => {
  it("sends the workspace-scoped create payload", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: borrower } });

    const result = await createSuperBorrower({
      workspace_id: "ws-1",
      username: "jdoe",
      borrower_id: "1234AB",
    });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-borrower-mutate", {
      method: "POST",
      body: {
        action: "create",
        payload: { workspace_id: "ws-1", username: "jdoe", borrower_id: "1234AB" },
      },
    });
    expect(result).toEqual(borrower);
  });

  it("throws when creation fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 409, error: "already exists", data: null });

    await expect(createSuperBorrower({ workspace_id: "ws-1" })).rejects.toThrow("already exists");
  });
});

describe("deleteSuperBorrower", () => {
  it("requires the super_password and confirm_phrase in the delete payload", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    const result = await deleteSuperBorrower({
      id: "b-1",
      super_password: "hunter2",
      confirm_phrase: "DELETE",
    });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-borrower-mutate", {
      method: "POST",
      body: {
        action: "delete",
        payload: { id: "b-1", super_password: "hunter2", confirm_phrase: "DELETE" },
      },
    });
    expect(result).toEqual({ success: true });
  });

  it("throws when the confirm phrase is rejected server-side", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 400, error: "confirm phrase mismatch", data: null });

    await expect(
      deleteSuperBorrower({ id: "b-1", super_password: "hunter2", confirm_phrase: "WRONG" })
    ).rejects.toThrow("confirm phrase mismatch");
  });
});
