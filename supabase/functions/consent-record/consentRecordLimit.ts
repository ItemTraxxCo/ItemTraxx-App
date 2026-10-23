export const MAX_ANONYMOUS_CONSENT_ROWS_PER_UTC_DAY = 5000;
export const ANONYMOUS_CONSENT_DAILY_LIMIT_SQLSTATE = "P0001";
export const ANONYMOUS_CONSENT_DAILY_LIMIT_MESSAGE =
  "ANONYMOUS_CONSENT_DAILY_LIMIT";
export const SECONDS_PER_UTC_DAY = 24 * 60 * 60;

type DatabaseError = {
  code?: string | null;
  message?: string | null;
} | null;

export const isAnonymousConsentDailyLimitError = (
  error: DatabaseError,
) =>
  error?.code === ANONYMOUS_CONSENT_DAILY_LIMIT_SQLSTATE &&
  error.message === ANONYMOUS_CONSENT_DAILY_LIMIT_MESSAGE;

export const secondsUntilNextUtcDay = (now: Date) => {
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((nextUtcMidnight - now.getTime()) / 1000));
};
