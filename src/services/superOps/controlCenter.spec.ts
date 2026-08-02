import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  callSuperOps: vi.fn(),
}));

import { callSuperOps } from "./client";
import {
  approveRequest,
  forceWorkspaceReauth,
  getControlCenter,
  setRuntimeConfig,
  setWorkspacePolicy,
  upsertAlertRule,
} from "./controlCenter";
import type { SuperControlCenter } from "./types";

const mockedCall = vi.mocked(callSuperOps);

describe("controlCenter", () => {
  it("getControlCenter requests get_control_center with an empty payload", async () => {
    const center: SuperControlCenter = {
      runtime_config: {},
      alert_rules: [],
      approvals: [],
      jobs: [],
    };
    mockedCall.mockResolvedValueOnce(center);

    const result = await getControlCenter();

    expect(result).toBe(center);
    expect(mockedCall).toHaveBeenCalledWith({ action: "get_control_center", payload: {} });
  });

  it("setRuntimeConfig forwards the key/value payload", async () => {
    mockedCall.mockResolvedValueOnce({ key: "feature_x", value: { on: true } });

    const result = await setRuntimeConfig({ key: "feature_x", value: { on: true } });

    expect(result).toEqual({ key: "feature_x", value: { on: true } });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "set_runtime_config",
      payload: { key: "feature_x", value: { on: true } },
    });
  });

  it("upsertAlertRule forwards the alert rule payload", async () => {
    const rule = {
      id: "rule-1",
      name: "High error rate",
      metric_key: "error_rate",
      threshold: 5,
      is_enabled: true,
      created_at: "2026-01-01T00:00:00Z",
    };
    mockedCall.mockResolvedValueOnce(rule);

    const payload = {
      name: "High error rate",
      metric_key: "error_rate",
      threshold: 5,
      is_enabled: true,
    };
    const result = await upsertAlertRule(payload);

    expect(result).toBe(rule);
    expect(mockedCall).toHaveBeenCalledWith({ action: "upsert_alert_rule", payload });
  });

  it("forceWorkspaceReauth forwards the workspace_id payload", async () => {
    mockedCall.mockResolvedValueOnce({ success: true, job: null });

    const result = await forceWorkspaceReauth({ workspace_id: "ws-1" });

    expect(result).toEqual({ success: true, job: null });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "set_workspace_force_reauth",
      payload: { workspace_id: "ws-1" },
    });
  });

  it("setWorkspacePolicy forwards the full policy payload", async () => {
    const payload = {
      workspace_id: "ws-1",
      checkout_due_hours: 48,
      feature_flags: {
        enable_notifications: true,
        enable_bulk_item_import: false,
        enable_bulk_borrower_tools: false,
        enable_status_tracking: true,
        enable_barcode_generator: true,
      },
    };
    mockedCall.mockResolvedValueOnce({
      workspace_id: "ws-1",
      checkout_due_hours: 48,
      feature_flags: payload.feature_flags,
    });

    const result = await setWorkspacePolicy(payload);

    expect(result.checkout_due_hours).toBe(48);
    expect(mockedCall).toHaveBeenCalledWith({ action: "set_workspace_policy", payload });
  });

  it("approveRequest forwards the approval id", async () => {
    const approval = {
      id: "appr-1",
      action_type: "force_reauth",
      payload: {},
      requested_by: "user-1",
      approved_by: "user-2",
      status: "approved",
      created_at: "2026-01-01T00:00:00Z",
      decided_at: "2026-01-02T00:00:00Z",
    };
    mockedCall.mockResolvedValueOnce(approval);

    const result = await approveRequest({ id: "appr-1" });

    expect(result).toBe(approval);
    expect(mockedCall).toHaveBeenCalledWith({ action: "approve_request", payload: { id: "appr-1" } });
  });

  it("propagates rejection from callSuperOps", async () => {
    mockedCall.mockRejectedValueOnce(new Error("boom"));
    await expect(getControlCenter()).rejects.toThrow("boom");
  });
});
