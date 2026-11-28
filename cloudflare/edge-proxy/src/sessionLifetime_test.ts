import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applySessionUpdateLifetimeCap,
  clampSessionExpiresAt,
  clampSessionRecordExpiresAt,
  resolveAbsoluteSessionExpiresAt,
  SESSION_ABSOLUTE_MAX_AGE_MS,
  SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  SESSION_ROLLING_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./sessionLifetime.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

Deno.test("session lifetime constants preserve 7d rolling expiry and 90d hard cap", () => {
  assertEquals(SESSION_ROLLING_EXPIRES_IN_SECONDS, 7 * 86_400);
  assertEquals(SESSION_UPDATE_AGE_SECONDS, 86_400);
  assertEquals(SESSION_ABSOLUTE_MAX_AGE_SECONDS, 90 * 86_400);
  assertEquals(SESSION_ABSOLUTE_MAX_AGE_MS, 90 * DAY_MS);
});

Deno.test("clampSessionExpiresAt keeps rolling expiry within the 90-day hard cap", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const day10Expiry = new Date(createdAt.getTime() + 10 * DAY_MS);
  const clamped = clampSessionExpiresAt(day10Expiry, createdAt);
  assertEquals(clamped?.toISOString(), day10Expiry.toISOString());
});

Deno.test("clampSessionExpiresAt caps rolling refresh at createdAt + 90 days", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const expectedHardCap = resolveAbsoluteSessionExpiresAt(createdAt);
  const day93Expiry = new Date(createdAt.getTime() + 93 * DAY_MS);
  const clamped = clampSessionExpiresAt(day93Expiry, createdAt);
  assertEquals(clamped?.toISOString(), expectedHardCap?.toISOString());
  assertEquals(clamped?.getTime(), createdAt.getTime() + 90 * DAY_MS);
});

Deno.test("clampSessionExpiresAt handles missing or invalid timestamps safely", () => {
  const validExpiry = new Date("2026-03-01T00:00:00.000Z");
  assertEquals(clampSessionExpiresAt(null, validExpiry), null);
  assertEquals(clampSessionExpiresAt("not-a-date", validExpiry), null);
  assertEquals(clampSessionExpiresAt(validExpiry, undefined)?.toISOString(), validExpiry.toISOString());
  assertEquals(resolveAbsoluteSessionExpiresAt("invalid"), null);
});

Deno.test("clampSessionRecordExpiresAt clamps ISO string and Date session rows beyond 90 days", () => {
  const createdMs = Date.parse("2026-01-01T00:00:00.000Z");
  const hardCapIso = new Date(createdMs + 90 * DAY_MS).toISOString();

  const stringRow = {
    id: "sess-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: new Date(createdMs + 95 * DAY_MS).toISOString(),
  };
  const clampedStringRow = clampSessionRecordExpiresAt(stringRow);
  assertEquals(clampedStringRow.expiresAt, hardCapIso);

  const dateRow = {
    id: "sess-2",
    createdAt: new Date(createdMs),
    expiresAt: new Date(createdMs + 95 * DAY_MS),
  };
  const clampedDateRow = clampSessionRecordExpiresAt(dateRow);
  assertEquals((clampedDateRow.expiresAt as Date).toISOString(), hardCapIso);

  const withinCapRow = {
    id: "sess-3",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: new Date(createdMs + 7 * DAY_MS).toISOString(),
  };
  assertEquals(clampSessionRecordExpiresAt(withinCapRow), withinCapRow);

  const nonSessionRow = { id: "user-1", email: "a@example.com" };
  assertEquals(clampSessionRecordExpiresAt(nonSessionRow), nonSessionRow);
});

Deno.test("applySessionUpdateLifetimeCap clamps refresh updates and ignores non-expiry updates", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const orgOnlyUpdate = { activeOrganizationId: "org-1" };
  assertEquals(applySessionUpdateLifetimeCap(orgOnlyUpdate, createdAt), undefined);

  const refreshBeyondCap = {
    expiresAt: new Date(createdAt.getTime() + 94 * DAY_MS),
    updatedAt: new Date(createdAt.getTime() + 87 * DAY_MS),
  };
  const capped = applySessionUpdateLifetimeCap(refreshBeyondCap, createdAt);
  assertEquals(
    (capped?.data.expiresAt as Date).toISOString(),
    new Date(createdAt.getTime() + 90 * DAY_MS).toISOString(),
  );
  assertEquals(capped?.data.updatedAt, refreshBeyondCap.updatedAt);

  const invalidUpdate = { expiresAt: "invalid-date" };
  assertEquals(applySessionUpdateLifetimeCap(invalidUpdate, createdAt), undefined);
});
