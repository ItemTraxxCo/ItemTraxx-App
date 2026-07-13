import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  assertPortAvailable,
  classifyLandingRequests,
  cleanupLandingResources,
  createLandingNetworkReport,
  evaluateLandingNetwork,
  sanitizeReportUrl,
  toSafeFailureDiagnostic,
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

test("rejects an occupied preview port before orchestration", async (t) => {
  const server = createServer((_request, response) => response.end("occupied"));
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  }));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  let portError;
  try {
    await assertPortAvailable({ host: "127.0.0.1", port: address.port });
  } catch (error) {
    portError = error;
  }

  assert.match(portError.message, new RegExp(`Preview port ${address.port} is already in use`));
  assert.deepEqual(toSafeFailureDiagnostic(portError), {
    code: "PREVIEW_PORT_OCCUPIED",
    message: `Preview port ${address.port} is already in use on 127.0.0.1`,
  });
});

test("unknown failures do not expose their messages", () => {
  const diagnostic = toSafeFailureDiagnostic(
    new Error("https://user:password@example.com/?token=failure-secret"),
  );

  assert.deepEqual(diagnostic, { code: "UNEXPECTED_FAILURE", error: "Error" });
  assert.doesNotMatch(JSON.stringify(diagnostic), /password|failure-secret|example\.com/);
});

test("sanitizes URL credentials, query values, fragments, and invalid input", () => {
  const sanitized = sanitizeReportUrl(
    "https://username:password@example.com/path?token=secret-token&api_key=secret-key&email=user%40example.com#fragment-secret",
  );

  assert.equal(
    sanitized,
    "https://example.com/path?token=%5BREDACTED%5D&api_key=%5BREDACTED%5D&email=%5BREDACTED%5D#%5BREDACTED%5D",
  );
  assert.equal(sanitizeReportUrl("not a URL with secret-token"), "[invalid-url]");
});

test("creates a report with sanitized URLs while preserving raw request multiplicity", () => {
  const statusUrl = "http://user:password@127.0.0.1:4174/functions/system-status?token=secret-token&email=user%40example.com#fragment-secret";
  const sdkUrl = "http://127.0.0.1:4174/assets/posthog.js?api_key=secret-key";
  const report = createLandingNetworkReport({
    timestamp: "2026-07-13T00:00:00.000Z",
    pageUrl: "http://user:password@127.0.0.1:4174/?token=secret-token#fragment-secret",
    requestUrls: [statusUrl, statusUrl, sdkUrl, "invalid secret-token URL"],
    initialLoad: passingInitialLoad,
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.request_count, 4);
  assert.equal(report.system_status_count, 2);
  assert.equal(report.classification.system_status.length, 2);
  assert.equal(report.violations[0].urls.length, 2);
  assert.match(serialized, /token=%5BREDACTED%5D/);
  assert.match(serialized, /api_key=%5BREDACTED%5D/);
  assert.match(serialized, /email=%5BREDACTED%5D/);
  assert.match(serialized, /#%5BREDACTED%5D/);
  assert.match(serialized, /\[invalid-url\]/);
  for (const secret of ["user", "password", "secret-token", "secret-key", "user@example.com", "fragment-secret"]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
});

test("bounds ordered browser cleanup and always invokes preview termination", async () => {
  const calls = [];
  const page = { close: () => new Promise(() => {}) };
  const context = { close: async () => {
    calls.push("context");
    throw new Error("https://user:password@example.com/?token=cleanup-secret");
  } };
  const browser = { close: async () => calls.push("browser") };
  const startedAt = Date.now();

  const diagnostics = await cleanupLandingResources({
    page,
    context,
    browser,
    preview: {},
    terminatePreviewFn: async () => calls.push("preview"),
    stepTimeoutMs: 20,
    browserTimeoutMs: 60,
    previewTimeoutMs: 20,
  });

  assert.ok(Date.now() - startedAt < 250);
  assert.deepEqual(calls, ["context", "browser", "preview"]);
  assert.deepEqual(diagnostics, [
    { step: "page", status: "timeout" },
    { step: "context", status: "failed", error: "Error" },
    { step: "browser", status: "closed" },
    { step: "preview", status: "terminated" },
  ]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /cleanup-secret|password|example\.com/);
});
