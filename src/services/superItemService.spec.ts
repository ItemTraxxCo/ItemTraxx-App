import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  createSuperItem,
  deleteSuperItem,
  listSuperItem,
  updateSuperItem,
  type SuperItemRecord,
} from "./superItemService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const item: SuperItemRecord = {
  id: "item-1",
  workspace_id: "ws-1",
  name: "Widget",
  barcode: "ITEM-1",
  serial_number: null,
  status: "available",
  notes: null,
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("listSuperItem", () => {
  it("defaults to scope 'all' and an empty search", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [item] } });

    const result = await listSuperItem();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-item-mutate", {
      method: "POST",
      body: { action: "list", payload: { workspace_id: "all", search: "" } },
    });
    expect(result).toEqual([item]);
  });

  it("scopes the request to a specific workspace and search term", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [] } });

    await listSuperItem("ws-1", "widget");

    expect(invokeEdgeFunction).toHaveBeenCalledWith(
      "super-item-mutate",
      expect.objectContaining({ body: { action: "list", payload: { workspace_id: "ws-1", search: "widget" } } })
    );
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(listSuperItem()).rejects.toThrow("boom");
  });
});

describe("createSuperItem", () => {
  it("sends the workspace-scoped create payload", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: item } });

    const result = await createSuperItem({
      workspace_id: "ws-1",
      name: "Widget",
      barcode: "ITEM-1",
      status: "available",
    });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-item-mutate", {
      method: "POST",
      body: {
        action: "create",
        payload: { workspace_id: "ws-1", name: "Widget", barcode: "ITEM-1", status: "available" },
      },
    });
    expect(result).toEqual(item);
  });

  it("throws when creation fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 409, error: "duplicate barcode", data: null });

    await expect(
      createSuperItem({ workspace_id: "ws-1", name: "Widget", barcode: "ITEM-1", status: "available" })
    ).rejects.toThrow("duplicate barcode");
  });
});

describe("updateSuperItem", () => {
  it("sends the update payload including optional privileged fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: item } });

    await updateSuperItem({
      id: "item-1",
      name: "Widget v2",
      barcode: "ITEM-1",
      status: "damaged",
      super_password: "hunter2",
      confirm_phrase: "UPDATE",
    });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-item-mutate", {
      method: "POST",
      body: {
        action: "update",
        payload: {
          id: "item-1",
          name: "Widget v2",
          barcode: "ITEM-1",
          status: "damaged",
          super_password: "hunter2",
          confirm_phrase: "UPDATE",
        },
      },
    });
  });

  it("throws when update is rejected", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 400, error: "invalid barcode", data: null });

    await expect(
      updateSuperItem({ id: "item-1", name: "Widget", barcode: "bad", status: "available" })
    ).rejects.toThrow("invalid barcode");
  });
});

describe("deleteSuperItem", () => {
  it("requires the super_password and confirm_phrase in the delete payload", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true } } });

    const result = await deleteSuperItem({
      id: "item-1",
      super_password: "hunter2",
      confirm_phrase: "DELETE",
    });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-item-mutate", {
      method: "POST",
      body: {
        action: "delete",
        payload: { id: "item-1", super_password: "hunter2", confirm_phrase: "DELETE" },
      },
    });
    expect(result).toEqual({ success: true });
  });

  it("throws when the confirm phrase is rejected server-side", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 400, error: "confirm phrase mismatch", data: null });

    await expect(
      deleteSuperItem({ id: "item-1", super_password: "hunter2", confirm_phrase: "WRONG" })
    ).rejects.toThrow("confirm phrase mismatch");
  });
});
