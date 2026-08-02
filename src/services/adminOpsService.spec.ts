import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("../utils/deviceSession", () => ({
  getOrCreateDeviceSession: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import {
  bulkImportItem,
  fetchStatusTracking,
  fetchWorkspaceNotifications,
  fetchWorkspaceSettings,
  listAccountSessions,
  revokeAccountSession,
  revokeAllAccountSessions,
  revokeCurrentAccountSession,
  touchAccountSession,
  updateWorkspaceSettings,
  validateAccountSession,
} from "./adminOpsService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const mockedDeviceSession = vi.mocked(getOrCreateDeviceSession);

const okResponse = <T,>(data: T) => ({ ok: true, status: 200, error: "", data: { data } });

// withCachedAdminOp and its request/inflight caches are module-level state keyed
// (in part) by device id. Giving each test a fresh device id sidesteps cross-test
// cache pollution without needing vi.resetModules() per test.
let deviceCounter = 0;
beforeEach(() => {
  mockedInvoke.mockReset();
  deviceCounter += 1;
  mockedDeviceSession.mockReturnValue({ deviceId: `device-${deviceCounter}`, deviceLabel: "Mac" });
});

describe("fetchWorkspaceNotifications", () => {
  // fetchWorkspaceNotifications caches under a fixed "get_notifications" key (unlike
  // touchAccountSession/validateAccountSession, it is not device-scoped), so its cache
  // persists across tests in this file. A Date.now spy that only ever moves forward
  // (never reset between tests) lets each test reliably bust the 15s TTL left over
  // from the previous test before exercising its own scenario.
  let fakeNow = Date.now();
  const dateNowSpy = vi.spyOn(Date, "now");

  beforeEach(() => {
    dateNowSpy.mockImplementation(() => fakeNow);
  });

  afterAll(() => {
    dateNowSpy.mockRestore();
  });

  it("requests the get_notifications action with device context", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ overdue_count: 1 }) as never);

    const result = await fetchWorkspaceNotifications();

    expect(mockedInvoke).toHaveBeenCalledWith("admin-ops", {
      method: "POST",
      body: {
        action: "get_notifications",
        payload: { device_id: `device-${deviceCounter}`, device_label: "Mac" },
      },
    });
    expect(result).toEqual({ overdue_count: 1 });
  });

  it("dedupes concurrent calls into a single in-flight network request", async () => {
    fakeNow += 20_000;
    mockedInvoke.mockResolvedValue(okResponse({ overdue_count: 2 }) as never);

    const [first, second] = await Promise.all([
      fetchWorkspaceNotifications(),
      fetchWorkspaceNotifications(),
    ]);

    expect(first).toEqual(second);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("serves a cached value on a later call within the TTL", async () => {
    fakeNow += 20_000;
    mockedInvoke.mockResolvedValue(okResponse({ overdue_count: 3 }) as never);

    const first = await fetchWorkspaceNotifications();
    const second = await fetchWorkspaceNotifications();

    expect(second).toEqual(first);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("throws a mapped error when the request fails", async () => {
    fakeNow += 20_000;
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "boom", data: null } as never);
    await expect(fetchWorkspaceNotifications()).rejects.toThrow("boom");
  });
});

describe("fetchWorkspaceSettings / updateWorkspaceSettings", () => {
  it("fetches workspace settings uncached", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ checkout_due_hours: 24 }) as never);
    const result = await fetchWorkspaceSettings();
    expect(mockedInvoke).toHaveBeenCalledWith(
      "admin-ops",
      expect.objectContaining({ body: expect.objectContaining({ action: "get_workspace_settings" }) })
    );
    expect(result).toEqual({ checkout_due_hours: 24 });
  });

  it("sends updated settings and returns the server response", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ checkout_due_hours: 48 }) as never);
    const result = await updateWorkspaceSettings({ checkout_due_hours: 48 });

    expect(mockedInvoke).toHaveBeenCalledWith("admin-ops", {
      method: "POST",
      body: {
        action: "update_workspace_settings",
        payload: { checkout_due_hours: 48, device_id: `device-${deviceCounter}`, device_label: "Mac" },
      },
    });
    expect(result).toEqual({ checkout_due_hours: 48 });
  });

  it("throws a mapped error when updating settings fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 422, error: "Invalid hours.", data: null } as never);
    await expect(updateWorkspaceSettings({ checkout_due_hours: -1 })).rejects.toThrow("Invalid hours.");
  });
});

describe("fetchStatusTracking", () => {
  it("returns flagged items and history", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ flagged_items: [], history: [] }) as never);
    const result = await fetchStatusTracking();
    expect(result).toEqual({ flagged_items: [], history: [] });
  });
});

describe("bulkImportItem", () => {
  it("sends the rows and returns the import summary", async () => {
    const rows = [{ name: "Drill", barcode: "BC-1" }];
    mockedInvoke.mockResolvedValue(
      okResponse({ inserted: 1, skipped: 0, inserted_items: [], skipped_rows: [] }) as never
    );

    const result = await bulkImportItem(rows);

    expect(mockedInvoke).toHaveBeenCalledWith("admin-ops", {
      method: "POST",
      body: {
        action: "bulk_import_items",
        payload: { rows, device_id: `device-${deviceCounter}`, device_label: "Mac" },
      },
    });
    expect(result).toEqual({ inserted: 1, skipped: 0, inserted_items: [], skipped_rows: [] });
  });

  it("throws a mapped error when the import fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(bulkImportItem([])).rejects.toThrow(/request failed/i);
  });
});

describe("touchAccountSession", () => {
  it("sends the provided login method/location and caches by those options", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ ok: true }) as never);

    const result = await touchAccountSession({ loginMethod: "password", loginLocation: "regular_login" });

    expect(mockedInvoke).toHaveBeenCalledWith("admin-ops", {
      method: "POST",
      body: {
        action: "touch_session",
        payload: {
          login_method: "password",
          login_location: "regular_login",
          device_id: `device-${deviceCounter}`,
          device_label: "Mac",
        },
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("caches repeated calls with identical options within the TTL", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ ok: true }) as never);
    await touchAccountSession({ loginMethod: "magic_link" });
    await touchAccountSession({ loginMethod: "magic_link" });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("issues a separate request when called with no options (defaults)", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ ok: true }) as never);
    await touchAccountSession();
    expect(mockedInvoke).toHaveBeenCalledWith(
      "admin-ops",
      expect.objectContaining({
        body: expect.objectContaining({ payload: expect.objectContaining({ login_method: undefined, login_location: undefined }) }),
      })
    );
  });
});

describe("validateAccountSession", () => {
  it("returns validity from the server", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ valid: true }) as never);
    expect(await validateAccountSession()).toEqual({ valid: true });
  });

  it("throws a mapped error when validation fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized", data: null } as never);
    await expect(validateAccountSession()).rejects.toThrow();
  });
});

describe("session management actions", () => {
  it("lists account sessions", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ sessions: [] }) as never);
    expect(await listAccountSessions()).toEqual({ sessions: [] });
  });

  it("revokes a specific session by id", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ revoked: true }) as never);
    const result = await revokeAccountSession("session-1");

    expect(mockedInvoke).toHaveBeenCalledWith(
      "admin-ops",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "revoke_session",
          payload: expect.objectContaining({ session_id: "session-1" }),
        }),
      })
    );
    expect(result).toEqual({ revoked: true });
  });

  it("revokes all sessions, defaulting sign_out_current to false", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ revoked: 3 }) as never);
    const result = await revokeAllAccountSessions();

    expect(mockedInvoke).toHaveBeenCalledWith(
      "admin-ops",
      expect.objectContaining({
        body: expect.objectContaining({
          payload: expect.objectContaining({ sign_out_current: false }),
        }),
      })
    );
    expect(result).toEqual({ revoked: 3 });
  });

  it("revokes all sessions including the current one when requested", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ revoked: 4 }) as never);
    await revokeAllAccountSessions(true);

    expect(mockedInvoke).toHaveBeenCalledWith(
      "admin-ops",
      expect.objectContaining({
        body: expect.objectContaining({
          payload: expect.objectContaining({ sign_out_current: true }),
        }),
      })
    );
  });

  it("revokes the current session", async () => {
    mockedInvoke.mockResolvedValue(okResponse({ revoked: true }) as never);
    expect(await revokeCurrentAccountSession()).toEqual({ revoked: true });
  });

  it("throws a mapped error when revocation fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null } as never);
    await expect(revokeAccountSession("session-1")).rejects.toThrow(/request failed/i);
  });
});
