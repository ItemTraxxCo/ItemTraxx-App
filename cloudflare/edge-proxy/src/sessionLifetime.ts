export const SESSION_ROLLING_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
export const SESSION_ABSOLUTE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
export const SESSION_ABSOLUTE_MAX_AGE_MS = SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000;

type TimestampInput = Date | string | number | null | undefined;

const parseTimestampMs = (value: TimestampInput): number | null => {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
};

export const resolveAbsoluteSessionExpiresAt = (
  createdAt: TimestampInput,
  maxAgeMs = SESSION_ABSOLUTE_MAX_AGE_MS,
): Date | null => {
  const createdMs = parseTimestampMs(createdAt);
  if (createdMs === null) return null;
  return new Date(createdMs + maxAgeMs);
};

export const clampSessionExpiresAt = (
  expiresAt: TimestampInput,
  createdAt: TimestampInput,
  maxAgeMs = SESSION_ABSOLUTE_MAX_AGE_MS,
): Date | null => {
  const expiresMs = parseTimestampMs(expiresAt);
  if (expiresMs === null) return null;
  const absoluteMax = resolveAbsoluteSessionExpiresAt(createdAt, maxAgeMs);
  if (!absoluteMax) return new Date(expiresMs);
  return new Date(Math.min(expiresMs, absoluteMax.getTime()));
};

export const clampSessionRecordExpiresAt = <T extends Record<string, unknown>>(
  row: T,
  maxAgeMs = SESSION_ABSOLUTE_MAX_AGE_MS,
): T => {
  if (!("expiresAt" in row) || !("createdAt" in row)) return row;
  const rawExpiresAt = row.expiresAt as TimestampInput;
  const clamped = clampSessionExpiresAt(
    rawExpiresAt,
    row.createdAt as TimestampInput,
    maxAgeMs,
  );
  if (!clamped) return row;
  const currentMs = parseTimestampMs(rawExpiresAt);
  if (currentMs !== null && clamped.getTime() === currentMs) return row;
  return {
    ...row,
    expiresAt: typeof rawExpiresAt === "string" ? clamped.toISOString() : clamped,
  };
};

export const applySessionUpdateLifetimeCap = <T extends Record<string, unknown>>(
  sessionUpdate: T,
  currentSessionCreatedAt?: TimestampInput,
  maxAgeMs = SESSION_ABSOLUTE_MAX_AGE_MS,
): { data: T } | undefined => {
  if (!("expiresAt" in sessionUpdate) || !sessionUpdate.expiresAt) return undefined;
  const createdAt = (sessionUpdate.createdAt as TimestampInput) ?? currentSessionCreatedAt;
  const clamped = clampSessionExpiresAt(
    sessionUpdate.expiresAt as TimestampInput,
    createdAt,
    maxAgeMs,
  );
  if (!clamped) return undefined;
  return {
    data: {
      ...sessionUpdate,
      expiresAt: clamped,
    },
  };
};
