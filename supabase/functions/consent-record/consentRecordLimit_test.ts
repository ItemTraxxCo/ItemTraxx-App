import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  ANONYMOUS_CONSENT_DAILY_LIMIT_MESSAGE,
  ANONYMOUS_CONSENT_DAILY_LIMIT_SQLSTATE,
  isAnonymousConsentDailyLimitError,
  SECONDS_PER_UTC_DAY,
  secondsUntilNextUtcDay,
} from "./consentRecordLimit.ts";

Deno.test("matches only the anonymous consent daily limit error", () => {
  assert(isAnonymousConsentDailyLimitError({
    code: ANONYMOUS_CONSENT_DAILY_LIMIT_SQLSTATE,
    message: ANONYMOUS_CONSENT_DAILY_LIMIT_MESSAGE,
  }));
  assert(
    !isAnonymousConsentDailyLimitError({
      code: ANONYMOUS_CONSENT_DAILY_LIMIT_SQLSTATE,
      message: "A different domain limit was reached",
    }),
  );
  assert(
    !isAnonymousConsentDailyLimitError({
      code: "23505",
      message: ANONYMOUS_CONSENT_DAILY_LIMIT_MESSAGE,
    }),
  );
  assert(!isAnonymousConsentDailyLimitError(null));
});

Deno.test("returns retry delay to the next UTC day", () => {
  assertEquals(
    secondsUntilNextUtcDay(new Date("2026-10-04T23:59:30.500Z")),
    30,
  );
  assertEquals(
    secondsUntilNextUtcDay(new Date("2026-12-31T23:59:59.200Z")),
    1,
  );
  assertEquals(
    secondsUntilNextUtcDay(new Date("2026-10-04T00:00:00.000Z")),
    SECONDS_PER_UTC_DAY,
  );
});
