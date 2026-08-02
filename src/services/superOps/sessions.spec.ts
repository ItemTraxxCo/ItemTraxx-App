import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  callSuperOps: vi.fn(),
}));
vi.mock("../../utils/deviceSession", () => ({
  getOrCreateDeviceSession: vi.fn(),
}));

import { callSuperOps } from "./client";
import { getOrCreateDeviceSession } from "../../utils/deviceSession";
import {
  listSuperAdminPasskeys,
  listSuperAdminSessions,
  revokeAllSuperAdminSessions,
  revokeSuperAdminSession,
  touchSuperAdminSession,
} from "./sessions";
import type { SuperAdminSessionItem } from "./types";

const mockedCall = vi.mocked(callSuperOps);
const mockedDeviceSession = vi.mocked(getOrCreateDeviceSession);

const DEVICE = { deviceId: "device-1", deviceLabel: "Mac" };

beforeEach(() => {
  mockedDeviceSession.mockReturnValue(DEVICE);
});

describe("touchSuperAdminSession", () => {
  it("sends the device info with default null login method/location when called with no options", async () => {
    mockedCall.mockResolvedValueOnce({ ok: true });

    const result = await touchSuperAdminSession();

    expect(result).toEqual({ ok: true });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "touch_session",
      payload: {
        device_id: "device-1",
        device_label: "Mac",
        login_method: null,
        login_location: null,
      },
    });
  });

  it("forwards a provided login method and location", async () => {
    mockedCall.mockResolvedValueOnce({ ok: true });

    await touchSuperAdminSession({ loginMethod: "passkey", loginLocation: "super_auth" });

    expect(mockedCall).toHaveBeenCalledWith({
      action: "touch_session",
      payload: {
        device_id: "device-1",
        device_label: "Mac",
        login_method: "passkey",
        login_location: "super_auth",
      },
    });
  });
});

describe("listSuperAdminSessions", () => {
  it("returns the sessions array from the response", async () => {
    const sessions: SuperAdminSessionItem[] = [
      {
        id: "sess-1",
        device_id: "device-1",
        device_label: "Mac",
        user_agent: "test-agent",
        login_method: "password",
        login_location: "super_auth",
        general_location: "US",
        created_at: "2026-01-01T00:00:00Z",
        last_seen_at: "2026-01-02T00:00:00Z",
        is_current: true,
      },
    ];
    mockedCall.mockResolvedValueOnce({ sessions });

    const result = await listSuperAdminSessions();

    expect(result).toBe(sessions);
    expect(mockedCall).toHaveBeenCalledWith({
      action: "list_sessions",
      payload: { device_id: "device-1", device_label: "Mac" },
    });
  });

  it("defaults to an empty array when the response has no sessions field", async () => {
    mockedCall.mockResolvedValueOnce({});

    const result = await listSuperAdminSessions();

    expect(result).toEqual([]);
  });
});

describe("listSuperAdminPasskeys", () => {
  it("returns the passkeys array and does not send device info", async () => {
    const passkeys = [{ id: "pk-1", created_at: "2026-01-01T00:00:00Z", last_used_at: null }];
    mockedCall.mockResolvedValueOnce({ passkeys });

    const result = await listSuperAdminPasskeys();

    expect(result).toBe(passkeys);
    expect(mockedCall).toHaveBeenCalledWith({ action: "list_passkeys", payload: {} });
  });

  it("defaults to an empty array when the response has no passkeys field", async () => {
    mockedCall.mockResolvedValueOnce({});

    const result = await listSuperAdminPasskeys();

    expect(result).toEqual([]);
  });
});

describe("revokeSuperAdminSession", () => {
  it("forwards the session id along with device info", async () => {
    mockedCall.mockResolvedValueOnce({ revoked: true });

    const result = await revokeSuperAdminSession("sess-1");

    expect(result).toEqual({ revoked: true });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "revoke_session",
      payload: { session_id: "sess-1", device_id: "device-1", device_label: "Mac" },
    });
  });
});

describe("revokeAllSuperAdminSessions", () => {
  it("defaults sign_out_current to false when not provided", async () => {
    mockedCall.mockResolvedValueOnce({ revoked: 3 });

    const result = await revokeAllSuperAdminSessions();

    expect(result).toEqual({ revoked: 3 });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "revoke_all_sessions",
      payload: { sign_out_current: false, device_id: "device-1", device_label: "Mac" },
    });
  });

  it("forwards sign_out_current when explicitly set", async () => {
    mockedCall.mockResolvedValueOnce({ revoked: 1 });

    await revokeAllSuperAdminSessions(true);

    expect(mockedCall).toHaveBeenCalledWith({
      action: "revoke_all_sessions",
      payload: { sign_out_current: true, device_id: "device-1", device_label: "Mac" },
    });
  });

  it("propagates a rejection from callSuperOps", async () => {
    mockedCall.mockRejectedValueOnce(new Error("revoke failed"));
    await expect(revokeAllSuperAdminSessions()).rejects.toThrow("revoke failed");
  });
});
