export type OfflineConnectionState = {
  last_confirmed_at: string | null;
  unreachable_since: string | null;
  acknowledged_hours: 0 | 3 | 8;
};

const STORAGE_KEY = "itemtraxx:offline-connection:v1";

const emptyState = (): OfflineConnectionState => ({
  last_confirmed_at: null,
  unreachable_since: null,
  acknowledged_hours: 0,
});

export const readOfflineConnectionState = (): OfflineConnectionState => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<OfflineConnectionState> | null;
    if (!parsed) return emptyState();
    return {
      last_confirmed_at: typeof parsed.last_confirmed_at === "string" ? parsed.last_confirmed_at : null,
      unreachable_since: typeof parsed.unreachable_since === "string" ? parsed.unreachable_since : null,
      acknowledged_hours: parsed.acknowledged_hours === 3 || parsed.acknowledged_hours === 8 ? parsed.acknowledged_hours : 0,
    };
  } catch {
    return emptyState();
  }
};

const write = (state: OfflineConnectionState) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("itemtraxx:offline-connection-changed"));
};

export const markItemTraxxServerConfirmed = (at = new Date()) => {
  write({ last_confirmed_at: at.toISOString(), unreachable_since: null, acknowledged_hours: 0 });
};

export const markItemTraxxServerUnreachable = (at = new Date()) => {
  const current = readOfflineConnectionState();
  write({
    ...current,
    last_confirmed_at: current.last_confirmed_at ?? at.toISOString(),
    unreachable_since: current.unreachable_since ?? at.toISOString(),
  });
};

export const acknowledgeOfflineWarning = (hours: 3 | 8) => {
  const current = readOfflineConnectionState();
  write({ ...current, acknowledged_hours: Math.max(current.acknowledged_hours, hours) as 3 | 8 });
};

export const getOfflineWarningThreshold = (now = Date.now()): 3 | 8 | null => {
  const current = readOfflineConnectionState();
  if (!current.unreachable_since || !current.last_confirmed_at) return null;
  const elapsedHours = (now - Date.parse(current.last_confirmed_at)) / 3_600_000;
  if (elapsedHours >= 8 && current.acknowledged_hours < 8) return 8;
  if (elapsedHours >= 3 && current.acknowledged_hours < 3) return 3;
  return null;
};

export const clearOfflineConnectionState = () => {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("itemtraxx:offline-connection-changed"));
};

