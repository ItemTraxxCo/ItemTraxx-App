import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSlackMessage,
  buildAnalyticsEndpoint,
  normalizeAnalyticsPeriod,
} from "./vercel-analytics-agent.mjs";

test("analytics periods are restricted to the supported windows", () => {
  assert.equal(normalizeAnalyticsPeriod("7d"), "7d");
  assert.equal(normalizeAnalyticsPeriod(" 30d "), "30d");
  assert.throws(() => normalizeAnalyticsPeriod("7d&teamId=attacker"), /one of: 7d, 14d, 30d/);
});

test("analytics paths are delivered in Slack plain text", () => {
  const payload = buildSlackMessage({
    vitals: {},
    traffic: null,
    topPages: { data: [{ path: "<!channel> `*owned*`", views: 1 }] },
    geoData: null,
    deviceData: null,
    regressions: [],
    suggestions: [],
    period: "7d",
  });
  const topPages = payload.blocks.find((block) =>
    block.type === "section" && block.text?.text?.startsWith("📄 Top Pages")
  );
  assert.equal(topPages?.text.type, "plain_text");
  assert.match(topPages.text.text, /<!channel> `\*owned\*`/);
});

test("analytics endpoint parameters are encoded", () => {
  assert.equal(
    buildAnalyticsEndpoint("/v1/web-analytics/vitals", "project&id", "7d", 20),
    "/v1/web-analytics/vitals?projectId=project%26id&period=7d&limit=20",
  );
});
