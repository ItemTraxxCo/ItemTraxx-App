import { getOrCreateDeviceSession } from "../../utils/deviceSession";
import { callSuperOps } from "./client";
import type { SuperAdminSessionItem } from "./types";

export type { SuperAdminSessionItem } from "./types";

export type SuperAdminPasskeyItem = {
  id: string;
  created_at: string;
  last_used_at: string | null;
};

export const touchSuperAdminSession = async (options: {
  loginMethod?: "password" | "passkey" | null;
  loginLocation?: "super_auth" | "super_settings" | null;
} = {}) => {
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  return callSuperOps<{ ok: boolean }>({
    action: "touch_session",
    payload: {
      device_id: deviceId,
      device_label: deviceLabel,
      login_method: options.loginMethod ?? null,
      login_location: options.loginLocation ?? null,
    },
  });
};

export const listSuperAdminSessions = async () => {
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  const response = await callSuperOps<{ sessions: SuperAdminSessionItem[] }>({
    action: "list_sessions",
    payload: {
      device_id: deviceId,
      device_label: deviceLabel,
    },
  });
  return response.sessions ?? [];
};

export const listSuperAdminPasskeys = async () => {
  const response = await callSuperOps<{ passkeys: SuperAdminPasskeyItem[] }>({
    action: "list_passkeys",
    payload: {},
  });
  return response.passkeys ?? [];
};

export const revokeSuperAdminSession = (sessionId: string) => {
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  return callSuperOps<{ revoked: boolean }>({
    action: "revoke_session",
    payload: {
      session_id: sessionId,
      device_id: deviceId,
      device_label: deviceLabel,
    },
  });
};

export const revokeAllSuperAdminSessions = (signOutCurrent = false) => {
  const { deviceId, deviceLabel } = getOrCreateDeviceSession();
  return callSuperOps<{ revoked: number }>({
    action: "revoke_all_sessions",
    payload: {
      sign_out_current: signOutCurrent,
      device_id: deviceId,
      device_label: deviceLabel,
    },
  });
};
