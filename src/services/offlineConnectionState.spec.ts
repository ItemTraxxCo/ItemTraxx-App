import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeOfflineWarning,
  clearOfflineConnectionState,
  getOfflineWarningThreshold,
  isServerUnreachableStatus,
  markItemTraxxServerConfirmed,
  markItemTraxxServerUnreachable,
  readOfflineConnectionState,
} from "./offlineConnectionState";

const STORAGE_KEY = "itemtraxx:offline-connection:v1";

describe("isServerUnreachableStatus", () => {
  it("only treats a fetch-level status 0 as unreachable", () => {
    expect(isServerUnreachableStatus(0)).toBe(true);
    expect(isServerUnreachableStatus(429)).toBe(false);
    expect(isServerUnreachableStatus(500)).toBe(false);
  });
});

// Node's own experimental global `localStorage` (gated behind --localstorage-file,
// see the "ExperimentalWarning: localStorage is not available" log) shadows jsdom's
// working implementation when vitest populates globals for the jsdom environment, so
// `window.localStorage` resolves to Node's stub (always undefined-returning) instead
// of a real Storage. Swap in a minimal in-memory Storage before every test.
const createMemoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
};

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: createMemoryStorage(),
  });
});

describe("readOfflineConnectionState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the empty default state when nothing is persisted", () => {
    expect(readOfflineConnectionState()).toEqual({
      last_confirmed_at: null,
      unreachable_since: null,
      acknowledged_hours: 0,
    });
  });

  it("returns the empty default state for malformed JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readOfflineConnectionState()).toEqual({
      last_confirmed_at: null,
      unreachable_since: null,
      acknowledged_hours: 0,
    });
  });

  it("sanitizes a partially-shaped persisted object", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ last_confirmed_at: 12345, unreachable_since: "2026-01-01T00:00:00.000Z", acknowledged_hours: 7 })
    );
    expect(readOfflineConnectionState()).toEqual({
      last_confirmed_at: null,
      unreachable_since: "2026-01-01T00:00:00.000Z",
      acknowledged_hours: 0,
    });
  });

  it("preserves a valid acknowledged_hours value of 3 or 8", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ acknowledged_hours: 8 }));
    expect(readOfflineConnectionState().acknowledged_hours).toBe(8);
  });
});

describe("markItemTraxxServerConfirmed", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("resets unreachable_since and acknowledged_hours and dispatches a change event", () => {
    const listener = vi.fn();
    window.addEventListener("itemtraxx:offline-connection-changed", listener);

    markItemTraxxServerUnreachable(new Date("2026-01-01T00:00:00.000Z"));
    markItemTraxxServerConfirmed(new Date("2026-01-02T00:00:00.000Z"));

    expect(readOfflineConnectionState()).toEqual({
      last_confirmed_at: "2026-01-02T00:00:00.000Z",
      unreachable_since: null,
      acknowledged_hours: 0,
    });
    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener("itemtraxx:offline-connection-changed", listener);
  });
});

describe("markItemTraxxServerUnreachable", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stamps last_confirmed_at and unreachable_since on first failure", () => {
    markItemTraxxServerUnreachable(new Date("2026-01-01T00:00:00.000Z"));
    expect(readOfflineConnectionState()).toEqual({
      last_confirmed_at: "2026-01-01T00:00:00.000Z",
      unreachable_since: "2026-01-01T00:00:00.000Z",
      acknowledged_hours: 0,
    });
  });

  it("does not move an already-recorded last_confirmed_at or unreachable_since forward on repeated failures", () => {
    markItemTraxxServerUnreachable(new Date("2026-01-01T00:00:00.000Z"));
    markItemTraxxServerUnreachable(new Date("2026-01-01T05:00:00.000Z"));
    expect(readOfflineConnectionState()).toEqual({
      last_confirmed_at: "2026-01-01T00:00:00.000Z",
      unreachable_since: "2026-01-01T00:00:00.000Z",
      acknowledged_hours: 0,
    });
  });
});

describe("acknowledgeOfflineWarning", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("raises acknowledged_hours and never lowers it again", () => {
    acknowledgeOfflineWarning(8);
    acknowledgeOfflineWarning(3);
    expect(readOfflineConnectionState().acknowledged_hours).toBe(8);
  });
});

describe("getOfflineWarningThreshold", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when the server has never gone unreachable", () => {
    expect(getOfflineWarningThreshold()).toBeNull();
  });

  it("returns null while under the 3-hour threshold", () => {
    markItemTraxxServerUnreachable(new Date("2026-01-01T00:00:00.000Z"));
    const now = Date.parse("2026-01-01T02:00:00.000Z");
    expect(getOfflineWarningThreshold(now)).toBeNull();
  });

  it("returns 3 once 3 hours have elapsed and it hasn't been acknowledged", () => {
    markItemTraxxServerUnreachable(new Date("2026-01-01T00:00:00.000Z"));
    const now = Date.parse("2026-01-01T03:30:00.000Z");
    expect(getOfflineWarningThreshold(now)).toBe(3);
  });

  it("returns 8 once 8 hours have elapsed even if 3 was already acknowledged", () => {
    markItemTraxxServerUnreachable(new Date("2026-01-01T00:00:00.000Z"));
    acknowledgeOfflineWarning(3);
    const now = Date.parse("2026-01-01T09:00:00.000Z");
    expect(getOfflineWarningThreshold(now)).toBe(8);
  });

  it("returns null once both thresholds have been acknowledged", () => {
    markItemTraxxServerUnreachable(new Date("2026-01-01T00:00:00.000Z"));
    acknowledgeOfflineWarning(8);
    const now = Date.parse("2026-01-01T09:00:00.000Z");
    expect(getOfflineWarningThreshold(now)).toBeNull();
  });
});

describe("clearOfflineConnectionState", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("removes the persisted state and dispatches a change event", () => {
    markItemTraxxServerUnreachable(new Date("2026-01-01T00:00:00.000Z"));
    const listener = vi.fn();
    window.addEventListener("itemtraxx:offline-connection-changed", listener);

    clearOfflineConnectionState();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readOfflineConnectionState()).toEqual({
      last_confirmed_at: null,
      unreachable_since: null,
      acknowledged_hours: 0,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("itemtraxx:offline-connection-changed", listener);
  });
});
