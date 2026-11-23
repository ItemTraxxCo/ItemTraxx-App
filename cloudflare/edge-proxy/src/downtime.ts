import {
  isLocalUnavailableBypassHost,
  isNamedUnavailableBypassHost,
} from "../../../src/utils/unavailableBypass.ts";
import { buildJson } from "./responses.ts";

export const DEFAULT_MAINTENANCE_MESSAGE =
  "Maintenance is currently in progress. Please see the status page for more information.";
export const DEFAULT_KILLSWITCH_MESSAGE =
  "Unfortunately ItemTraxx is currently unavailable. We apologize for any inconvenience and are working to restore access as soon as possible. Please see the status page for more information.";
export const STATUS_PAGE_URL = "https://status.itemtraxx.com";

export type DowntimeMode = "killswitch" | "maintenance";

export type DowntimeState = {
  mode: DowntimeMode;
  message: string;
};

export const resolveDowntimeState = (env: Env): DowntimeState | null => {
  if ((env.ITX_KILLSWITCH_ENABLED ?? "").trim().toLowerCase() === "true") {
    return {
      mode: "killswitch",
      message: env.ITX_KILLSWITCH_MESSAGE?.trim() || DEFAULT_KILLSWITCH_MESSAGE,
    };
  }

  if ((env.ITX_MAINTENANCE_ENABLED ?? "").trim().toLowerCase() === "true") {
    return {
      mode: "maintenance",
      message: env.ITX_MAINTENANCE_MESSAGE?.trim() ||
        DEFAULT_MAINTENANCE_MESSAGE,
    };
  }

  return null;
};

export const isSystemStatusRequest = (pathname: string) =>
  /^\/functions\/(?:v1\/)?system-status\/?$/i.test(pathname);

export const isUnavailableBypassRequest = (request: Request, env: Env) => {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    if (isNamedUnavailableBypassHost(hostname)) return true;
    const trustLocalOrigins =
      (env.TRUST_LOCAL_ORIGINS ?? "").trim().toLowerCase() === "true";
    return trustLocalOrigins && isLocalUnavailableBypassHost(hostname);
  } catch {
    return false;
  }
};

export const buildDowntimeResponse = (
  state: DowntimeState,
  headers: Record<string, string>,
  requestId: string,
) => {
  const responseHeaders = new Headers({
    "cache-control": "no-store",
    vary: "Origin",
  });

  return buildJson(503, {
    status: "unavailable",
    mode: state.mode,
    message: state.message,
    statusPageUrl: STATUS_PAGE_URL,
  }, headers, requestId, responseHeaders);
};

export const buildSystemStatusResponse = (
  state: DowntimeState,
  headers: Record<string, string>,
  requestId: string,
) => {
  const responseHeaders = new Headers({
    "cache-control": "no-store",
  });

  const body = state.mode === "killswitch"
    ? {
      status: "major_outage",
      availability: "unavailable",
      mode: state.mode,
      statusPageUrl: STATUS_PAGE_URL,
      checks: { edge: "unavailable" },
      kill_switch: { enabled: true, message: state.message },
      maintenance: { enabled: false, message: "" },
      incident_summary: state.message,
      checked_at: new Date().toISOString(),
    }
    : {
      status: "maintenance",
      availability: "unavailable",
      mode: state.mode,
      statusPageUrl: STATUS_PAGE_URL,
      checks: { edge: "maintenance" },
      kill_switch: { enabled: false, message: DEFAULT_KILLSWITCH_MESSAGE },
      maintenance: {
        enabled: true,
        message: state.message,
        updated_at: new Date().toISOString(),
      },
      incident_summary: state.message,
      checked_at: new Date().toISOString(),
    };

  return buildJson(200, body, headers, requestId, responseHeaders);
};
