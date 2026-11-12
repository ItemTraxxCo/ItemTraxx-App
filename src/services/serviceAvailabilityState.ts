const MAINTENANCE_CACHE_KEY = "itemtraxx-maintenance-state";
const AVAILABILITY_SIGNAL_MAX_AGE_MS = 10 * 60 * 1000;

type SystemStatusSignal = {
  ok: boolean;
  status: number;
  payload?: {
    status?: string;
    maintenance?: { enabled?: boolean } | null;
    kill_switch?: { enabled?: boolean } | null;
  } | null;
};

let latestSignal: { suppressHandledFailures: boolean; observedAt: number } | null = null;

const isCachedMaintenanceEnabled = () => {
  if (typeof window === "undefined") return false;
  try {
    const cached = JSON.parse(
      window.localStorage.getItem(MAINTENANCE_CACHE_KEY) || "null",
    ) as { enabled?: unknown } | null;
    return cached?.enabled === true;
  } catch {
    return false;
  }
};

export const observeSystemStatus = ({ ok, status, payload }: SystemStatusSignal) => {
  const statusName = typeof payload?.status === "string"
    ? payload.status.trim().toLowerCase()
    : "";
  const isExplicitDisruption = status >= 500 ||
    statusName === "degraded" ||
    statusName === "down" ||
    statusName === "maintenance" ||
    payload?.maintenance?.enabled === true ||
    payload?.kill_switch?.enabled === true;
  const isOperational = ok && status < 500 && statusName === "operational" &&
    payload?.maintenance?.enabled !== true && payload?.kill_switch?.enabled !== true;

  if (isExplicitDisruption || isOperational) {
    latestSignal = {
      suppressHandledFailures: isExplicitDisruption,
      observedAt: Date.now(),
    };
  }
};

export const observeSystemStatusUnavailable = () => {
  latestSignal = {
    suppressHandledFailures: true,
    observedAt: Date.now(),
  };
};

/**
 * Handled HTTP failures are expected while service status is degraded, down,
 * or intentionally unavailable. Real uncaught exceptions are not filtered.
 */
export const isExpectedServiceDisruption = () => {
  if (typeof window !== "undefined") {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/unavailable" || isCachedMaintenanceEnabled()) return true;
  }

  return latestSignal?.suppressHandledFailures === true &&
    Date.now() - latestSignal.observedAt < AVAILABILITY_SIGNAL_MAX_AGE_MS;
};
