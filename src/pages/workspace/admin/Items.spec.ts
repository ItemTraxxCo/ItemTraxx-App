import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthState, setAuthStateFromBackend, setWorkspaceContext } from "../../../store/authState";

const mocks = vi.hoisted(() => ({
  fetchItem: vi.fn(),
  fetchDeletedItem: vi.fn(),
  fetchItemAccessGrants: vi.fn(),
  fetchItemAccessGrantProfiles: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  logAdminAction: vi.fn(),
  listTenantAccounts: vi.fn(),
  exportRowsToCsv: vi.fn(),
  exportRowsToPdf: vi.fn(),
  capturePostHogEvent: vi.fn(),
}));

vi.mock("../../../services/itemService", () => ({
  fetchItem: mocks.fetchItem,
  fetchDeletedItem: mocks.fetchDeletedItem,
  fetchItemAccessGrants: mocks.fetchItemAccessGrants,
  fetchItemAccessGrantProfiles: mocks.fetchItemAccessGrantProfiles,
  createItem: mocks.createItem,
  updateItem: mocks.updateItem,
  deleteItem: mocks.deleteItem,
  restoreItem: mocks.restoreItem,
}));
vi.mock("../../../services/auditLogService", () => ({ logAdminAction: mocks.logAdminAction }));
vi.mock("../../../services/workspaceAdminManageService", () => ({ listTenantAccounts: mocks.listTenantAccounts }));
vi.mock("../../../services/exportService", () => ({
  exportRowsToCsv: mocks.exportRowsToCsv,
  exportRowsToPdf: mocks.exportRowsToPdf,
}));
vi.mock("../../../services/posthogService", () => ({ capturePostHogEvent: mocks.capturePostHogEvent }));

import Items from "./Items.vue";

describe("workspace item management table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthState();
    setAuthStateFromBackend({
      isAuthenticated: true,
      userId: "individual-1",
      role: "individual_account",
    });
    setWorkspaceContext("workspace-1");
    mocks.fetchItem.mockResolvedValue([
      {
        id: "item-1",
        workspace_id: "workspace-1",
        name: "Sony a7iii",
        barcode: "67",
        serial_number: "SN-1",
        status: "available",
        notes: "Dennis's personal camera.",
        access_mode: "all",
      },
    ]);
    mocks.fetchDeletedItem.mockResolvedValue([]);
  });

  it("keeps notes under Notes for individual accounts", async () => {
    const wrapper = mount(Items, {
      global: {
        stubs: {
          CameraBarcodeScannerModal: true,
          RouterLink: { template: "<a><slot /></a>" },
          SkeletonLoader: true,
          TenantAccessPicker: true,
        },
      },
    });
    await flushPromises();

    const rowCells = wrapper.find("table.table tbody tr").findAll("td").map((cell) => cell.text().trim());
    expect(rowCells).toEqual([
      "Sony a7iii",
      "67",
      "SN-1",
      "available",
      "Dennis's personal camera.",
      "Details",
    ]);
    expect(rowCells).not.toContain("All");
    wrapper.unmount();
  });
});
