import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { fetchSuperDashboard, type SuperDashboard } from "./superAuditService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const dashboard: SuperDashboard = {
  total_workspaces: 10,
  active_workspaces: 8,
  suspended_workspaces: 2,
  workspace_admins_count: 12,
  recent_actions: [],
  workspace_metrics: [],
  alert_events: [],
  runtime_config: {},
  pending_approvals: [],
  jobs: [],
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("fetchSuperDashboard", () => {
  it("requests the dashboard via GET and returns the nested data", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: dashboard } });

    const result = await fetchSuperDashboard();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-dashboard", { method: "GET" });
    expect(result).toEqual(dashboard);
  });

  it("throws a mapped error when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });

    await expect(fetchSuperDashboard()).rejects.toThrow("boom");
  });

  it("falls back to the default message when the server returns no error text", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 500, error: "", data: null });

    await expect(fetchSuperDashboard()).rejects.toThrow("Unable to load super dashboard");
  });

  it("maps a 401 to an unauthorized error", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized", data: null });

    await expect(fetchSuperDashboard()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
