import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAnalyticsEndpoint,
  normalizeAnalyticsPeriod,
} from "./vercel-analytics-agent.mjs";

test("analytics periods are restricted to the supported windows", () => {
  assert.equal(normalizeAnalyticsPeriod("7d"), "7d");
  assert.equal(normalizeAnalyticsPeriod(" 30d "), "30d");
  assert.throws(() => normalizeAnalyticsPeriod("7d&teamId=attacker"), /one of: 7d, 14d, 30d/);
});

test("analytics endpoint parameters are encoded", () => {
  assert.equal(
    buildAnalyticsEndpoint("/v1/web-analytics/vitals", "project&id", "7d", 20),
    "/v1/web-analytics/vitals?projectId=project%26id&period=7d&limit=20",
  );
});
