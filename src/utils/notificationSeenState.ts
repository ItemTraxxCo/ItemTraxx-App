/**
 * Read/unread bookkeeping for the workspace-admin notification bell.
 *
 * Each row the bell can show is tracked on its own: product updates and status
 * events by id, overdue/flagged by the count that was last seen. A row is
 * unread only when it is genuinely new (an unseen id, or a count that grew
 * past what the admin already saw), so a count going down never re-alerts.
 */

export type NotificationSnapshot = {
  overdueCount: number;
  flaggedCount: number;
  updateIds: string[];
  eventIds: string[];
};

export type NotificationSeenState = {
  overdue: number;
  flagged: number;
  updates: string[];
  events: string[];
};

export const EMPTY_SEEN_STATE: NotificationSeenState = {
  overdue: 0,
  flagged: 0,
  updates: [],
  events: [],
};

const STORAGE_PREFIX = "itemtraxx:workspace-notifications:seen:v2";
export const LEGACY_DISMISSED_KEY = "itemtraxx:tenant-notifications:dismissed-signature:v1";

export const seenStateStorageKey = (userId: string | null, workspaceId: string | null) =>
  `${STORAGE_PREFIX}:${userId ?? "anonymous"}:${workspaceId ?? "none"}`;

const toCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const toIds = (value: unknown) =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

export const parseSeenState = (raw: string | null): NotificationSeenState => {
  if (!raw) return { ...EMPTY_SEEN_STATE };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_SEEN_STATE };
    return {
      overdue: toCount(parsed.overdue),
      flagged: toCount(parsed.flagged),
      updates: toIds(parsed.updates),
      events: toIds(parsed.events),
    };
  } catch {
    return { ...EMPTY_SEEN_STATE };
  }
};

/** Number of rows in the snapshot the admin has not seen yet. */
export const countUnseen = (snapshot: NotificationSnapshot, seen: NotificationSeenState) => {
  const seenUpdates = new Set(seen.updates);
  const seenEvents = new Set(seen.events);
  return (
    (snapshot.overdueCount > seen.overdue ? 1 : 0) +
    (snapshot.flaggedCount > seen.flagged ? 1 : 0) +
    snapshot.updateIds.filter((id) => !seenUpdates.has(id)).length +
    snapshot.eventIds.filter((id) => !seenEvents.has(id)).length
  );
};

/** Everything currently visible becomes seen. */
export const markAllSeen = (snapshot: NotificationSnapshot): NotificationSeenState => ({
  overdue: snapshot.overdueCount,
  flagged: snapshot.flaggedCount,
  updates: [...snapshot.updateIds],
  events: [...snapshot.eventIds],
});

/**
 * Lower count baselines when counts drop (so a later increase is detected as
 * new) and forget ids that are no longer returned, keeping storage bounded.
 * Ids still present keep their seen status.
 */
export const reconcileSeenState = (
  snapshot: NotificationSnapshot,
  seen: NotificationSeenState,
): NotificationSeenState => {
  const currentUpdates = new Set(snapshot.updateIds);
  const currentEvents = new Set(snapshot.eventIds);
  return {
    overdue: Math.min(seen.overdue, snapshot.overdueCount),
    flagged: Math.min(seen.flagged, snapshot.flaggedCount),
    updates: seen.updates.filter((id) => currentUpdates.has(id)),
    events: seen.events.filter((id) => currentEvents.has(id)),
  };
};

export const seenStatesEqual = (a: NotificationSeenState, b: NotificationSeenState) =>
  a.overdue === b.overdue &&
  a.flagged === b.flagged &&
  a.updates.join("\n") === b.updates.join("\n") &&
  a.events.join("\n") === b.events.join("\n");

export const isSafeExternalLink = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^https:\/\/\S+$/i.test(value.trim());
