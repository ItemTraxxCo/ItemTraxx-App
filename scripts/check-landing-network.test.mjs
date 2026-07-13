import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyLandingRequests,
  evaluateLandingNetwork,
} from "./check-landing-network.mjs";

const passingInitialLoad = {
  assets: ["index.js"],
  minifiedBytes: 10_000,
  gzipBytes: 4_000,
  forbiddenModules: [],
  moduleMapPresent: true,
};

test("classifies direct Supabase, system-status, and forbidden SDK requests", () => {
  const urls = [
    "https://edge.itemtraxx.com/functions/system-status",
    "https://project.supabase.co/functions/v1/system-status",
    "https://project.supabase.in/rest/v1/items",
    "http://127.0.0.1:4174/functions/system-status?request_id=one",
    "http://127.0.0.1:4174/functions/v1/system-status#fresh",
    "http://127.0.0.1:4174/assets/jspdf-a1.js",
    "http://127.0.0.1:4174/assets/html2canvas.js?hash=one",
    "http://127.0.0.1:4174/assets/jsbarcode.abc.js",
    "http://127.0.0.1:4174/assets/posthog-runtime.js",
    "http://127.0.0.1:4174/assets/sentry.js#chunk",
    "http://127.0.0.1:4174/assets/supabase-client.js",
    "http://127.0.0.1:4174/assets/landing.js",
    "http://127.0.0.1:4174/assets/sentry.css",
  ];

  assert.deepEqual(classifyLandingRequests(urls), {
    directSupabase: [
      "https://project.supabase.co/functions/v1/system-status",
      "https://project.supabase.in/rest/v1/items",
    ],
    systemStatus: [
      "https://edge.itemtraxx.com/functions/system-status",
      "https://project.supabase.co/functions/v1/system-status",
      "http://127.0.0.1:4174/functions/system-status?request_id=one",
      "http://127.0.0.1:4174/functions/v1/system-status#fresh",
    ],
    forbiddenSdk: [
      "http://127.0.0.1:4174/assets/jspdf-a1.js",
      "http://127.0.0.1:4174/assets/html2canvas.js?hash=one",
      "http://127.0.0.1:4174/assets/jsbarcode.abc.js",
      "http://127.0.0.1:4174/assets/posthog-runtime.js",
      "http://127.0.0.1:4174/assets/sentry.js#chunk",
      "http://127.0.0.1:4174/assets/supabase-client.js",
    ],
  });
});

test("allows one proxied system-status request and benign assets", () => {
  const result = evaluateLandingNetwork({
    requestUrls: [
      "http://127.0.0.1:4174/",
      "http://127.0.0.1:4174/assets/index-a1.js",
      "https://edge.itemtraxx.com/functions/system-status",
    ],
    initialLoad: passingInitialLoad,
  });

  assert.equal(result.pass, true);
  assert.equal(result.systemStatusCount, 1);
  assert.deepEqual(result.violations, []);
});

test("rejects duplicate identical system-status requests using raw multiplicity", () => {
  const statusUrl = "http://127.0.0.1:4174/functions/system-status";
  const result = evaluateLandingNetwork({
    requestUrls: [statusUrl, statusUrl],
    initialLoad: passingInitialLoad,
  });

  assert.equal(result.systemStatusCount, 2);
  assert.equal(result.pass, false);
  assert.deepEqual(result.classification.systemStatus, [statusUrl, statusUrl]);
  assert.deepEqual(result.violations, [
    { type: "system-status-count", count: 2, urls: [statusUrl, statusUrl] },
  ]);
});

test("rejects direct Supabase, forbidden SDK, and failing static initial load", () => {
  const directUrl = "https://project.supabase.co/rest/v1/items";
  const sdkUrl = "http://127.0.0.1:4174/assets/posthog.js";
  const initialLoad = {
    ...passingInitialLoad,
    minifiedBytes: 250_001,
  };
  const result = evaluateLandingNetwork({
    requestUrls: [directUrl, sdkUrl],
    initialLoad,
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.violations, [
    { type: "direct-supabase", urls: [directUrl] },
    { type: "forbidden-sdk", urls: [sdkUrl] },
    { type: "initial-load", result: initialLoad },
  ]);
});
