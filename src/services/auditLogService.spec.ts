import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./authenticatedDataClient", () => ({
  authenticatedInsert: vi.fn(),
}));

import { authenticatedInsert } from "./authenticatedDataClient";
import { logAdminAction } from "./auditLogService";
import { clearAuthState, setAuthStateFromBackend, setWorkspaceContext } from "../store/authState";

const mockedInsert = vi.mocked(authenticatedInsert);

afterEach(() => {
  clearAuthState();
  mockedInsert.mockReset();
});

describe("logAdminAction", () => {
  it("throws without calling authenticatedInsert when there is no workspace context", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: "user-1" });

    await expect(logAdminAction({ action_type: "item.create" })).rejects.toThrow(
      /audit context/i
    );
    expect(mockedInsert).not.toHaveBeenCalled();
  });

  it("throws without calling authenticatedInsert when there is no user id", async () => {
    setAuthStateFromBackend({ isAuthenticated: true });
    setWorkspaceContext("workspace-1");

    await expect(logAdminAction({ action_type: "item.create" })).rejects.toThrow(
      /audit context/i
    );
    expect(mockedInsert).not.toHaveBeenCalled();
  });

  it("inserts an admin_audit_logs row scoped to the current workspace and actor", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: "user-1" });
    setWorkspaceContext("workspace-1");
    mockedInsert.mockResolvedValue(undefined as never);

    await logAdminAction({
      action_type: "item.create",
      entity_type: "item",
      entity_id: "item-9",
      metadata: { barcode: "123" },
    });

    expect(mockedInsert).toHaveBeenCalledWith("admin_audit_logs", {
      workspace_id: "workspace-1",
      actor_id: "user-1",
      action_type: "item.create",
      entity_type: "item",
      entity_id: "item-9",
      metadata: { barcode: "123" },
    });
  });

  it("defaults optional fields to null when not provided", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: "user-1" });
    setWorkspaceContext("workspace-1");
    mockedInsert.mockResolvedValue(undefined as never);

    await logAdminAction({ action_type: "item.delete" });

    expect(mockedInsert).toHaveBeenCalledWith("admin_audit_logs", {
      workspace_id: "workspace-1",
      actor_id: "user-1",
      action_type: "item.delete",
      entity_type: null,
      entity_id: null,
      metadata: null,
    });
  });

  it("propagates a failure from authenticatedInsert", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: "user-1" });
    setWorkspaceContext("workspace-1");
    mockedInsert.mockRejectedValue(new Error("insert failed"));

    await expect(logAdminAction({ action_type: "item.create" })).rejects.toThrow("insert failed");
  });
});
