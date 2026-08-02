import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { listSuperLogs, type SuperLogEntry } from "./superLogsService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const logEntry: SuperLogEntry = {
  id: "log-1",
  workspace_id: "ws-1",
  item_id: "item-1",
  checked_out_by: "b-1",
  action_type: "checkout",
  action_time: "2026-01-01T00:00:00Z",
  performed_by: "admin-1",
  item: { id: "item-1", name: "Widget", barcode: "ITEM-1" },
  borrower: { id: "b-1", username: "jdoe", borrower_id: "1234AB" },
  workspace: { id: "ws-1", name: "Acme" },
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("listSuperLogs", () => {
  it("wraps the given filters in a payload envelope", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { data: [logEntry], page: 2, page_size: 25, count: 51 },
    });

    const result = await listSuperLogs({ workspace_id: "ws-1", action_type: "checkout", page: 2, page_size: 25 });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-logs-query", {
      method: "POST",
      body: { payload: { workspace_id: "ws-1", action_type: "checkout", page: 2, page_size: 25 } },
    });
    expect(result).toEqual({ rows: [logEntry], page: 2, pageSize: 25, count: 51 });
  });

  it("falls back to defaults when the server omits pagination fields", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: {} });

    const result = await listSuperLogs({});

    expect(result).toEqual({ rows: [], page: 1, pageSize: 50, count: 0 });
  });

  it("uses the requested page_size as a fallback when the server does not echo one back", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [] } });

    const result = await listSuperLogs({ page_size: 10 });

    expect(result.pageSize).toBe(10);
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(listSuperLogs({})).rejects.toThrow("boom");
  });

  it("falls back to the default message when the server returns no error text", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "", data: null });

    await expect(listSuperLogs({})).rejects.toThrow("Unable to load logs.");
  });
});
