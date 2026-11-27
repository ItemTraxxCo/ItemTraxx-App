import { describe, expect, it } from "vitest";
import {
  EMPTY_SEEN_STATE,
  countUnseen,
  isSafeExternalLink,
  markAllSeen,
  parseSeenState,
  reconcileSeenState,
  seenStateStorageKey,
  seenStatesEqual,
  type NotificationSnapshot,
} from "./notificationSeenState";

const snap = (overrides: Partial<NotificationSnapshot> = {}): NotificationSnapshot => ({
  overdueCount: 0,
  flaggedCount: 0,
  updateIds: [],
  eventIds: [],
  ...overrides,
});

describe("countUnseen", () => {
  it("counts every visible row when nothing has been seen", () => {
    expect(
      countUnseen(
        snap({ overdueCount: 3, flaggedCount: 2, updateIds: ["u1"], eventIds: ["e1", "e2"] }),
        EMPTY_SEEN_STATE
      )
    ).toBe(5);
  });

  it("is zero right after marking everything seen", () => {
    const current = snap({ overdueCount: 3, flaggedCount: 1, updateIds: ["u1"], eventIds: ["e1"] });
    expect(countUnseen(current, markAllSeen(current))).toBe(0);
  });

  it("does not re-alert when counts go down", () => {
    const seen = markAllSeen(snap({ overdueCount: 3, flaggedCount: 2 }));
    expect(countUnseen(snap({ overdueCount: 2, flaggedCount: 1 }), seen)).toBe(0);
  });

  it("alerts once per row when a count grows", () => {
    const seen = markAllSeen(snap({ overdueCount: 1 }));
    expect(countUnseen(snap({ overdueCount: 4 }), seen)).toBe(1);
  });

  it("counts new status events in the badge", () => {
    const seen = markAllSeen(snap({ eventIds: ["e1"] }));
    expect(countUnseen(snap({ eventIds: ["e2", "e1"] }), seen)).toBe(1);
  });
});

describe("reconcileSeenState", () => {
  it("lowers count baselines so a later increase is detected", () => {
    let seen = markAllSeen(snap({ overdueCount: 3 }));
    seen = reconcileSeenState(snap({ overdueCount: 2 }), seen);
    expect(seen.overdue).toBe(2);
    expect(countUnseen(snap({ overdueCount: 3 }), seen)).toBe(1);
  });

  it("drops ids that are no longer returned but keeps current ones", () => {
    const seen = markAllSeen(snap({ updateIds: ["u1", "u2"], eventIds: ["e1"] }));
    const next = reconcileSeenState(snap({ updateIds: ["u2"], eventIds: [] }), seen);
    expect(next.updates).toEqual(["u2"]);
    expect(next.events).toEqual([]);
  });

  it("never raises a baseline", () => {
    const next = reconcileSeenState(snap({ overdueCount: 5 }), markAllSeen(snap({ overdueCount: 1 })));
    expect(next.overdue).toBe(1);
  });
});

describe("parseSeenState", () => {
  it("returns an empty state for missing or malformed input", () => {
    expect(parseSeenState(null)).toEqual(EMPTY_SEEN_STATE);
    expect(parseSeenState("not json")).toEqual(EMPTY_SEEN_STATE);
    expect(parseSeenState("null")).toEqual(EMPTY_SEEN_STATE);
    expect(parseSeenState('"overdue:1|flagged:0"')).toEqual(EMPTY_SEEN_STATE);
  });

  it("round-trips a stored state and sanitizes bad fields", () => {
    const stored = JSON.stringify({ overdue: 2, flagged: -1, updates: ["u1", 5], events: "x" });
    expect(parseSeenState(stored)).toEqual({ overdue: 2, flagged: 0, updates: ["u1"], events: [] });
  });
});

describe("helpers", () => {
  it("scopes the storage key per user and workspace", () => {
    expect(seenStateStorageKey("user-a", "ws-1")).not.toBe(seenStateStorageKey("user-b", "ws-1"));
    expect(seenStateStorageKey("user-a", "ws-1")).not.toBe(seenStateStorageKey("user-a", "ws-2"));
  });

  it("compares seen states structurally", () => {
    const a = markAllSeen(snap({ overdueCount: 1, updateIds: ["u1"] }));
    expect(seenStatesEqual(a, { ...a, updates: [...a.updates] })).toBe(true);
    expect(seenStatesEqual(a, { ...a, overdue: 2 })).toBe(false);
  });

  it("only allows https links", () => {
    expect(isSafeExternalLink("https://status.itemtraxx.com/")).toBe(true);
    expect(isSafeExternalLink("http://example.com")).toBe(false);
    expect(isSafeExternalLink("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalLink(null)).toBe(false);
  });
});
