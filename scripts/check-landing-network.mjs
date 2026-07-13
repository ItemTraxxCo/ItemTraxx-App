import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

import {
  MAX_INITIAL_GZIP_BYTES,
  MAX_INITIAL_MINIFIED_BYTES,
  measureInitialLoad,
  shouldFailInitialLoad,
} from "./check-initial-load-budget.mjs";

const PREVIEW_URL = "http://127.0.0.1:4174/";
const PREVIEW_START_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;

export const classifyLandingRequests = (urls) => ({
  directSupabase: urls.filter((url) => /https:\/\/[^/]+\.supabase\.(?:co|in)\//i.test(url)),
  systemStatus: urls.filter((url) => /\/functions(?:\/v1)?\/system-status(?:[?#]|$)/i.test(url)),
  forbiddenSdk: urls.filter((url) => /(?:jspdf|html2canvas|jsbarcode|posthog|sentry|supabase)[^/]*\.js(?:[?#]|$)/i.test(url)),
});

export const evaluateLandingNetwork = ({ requestUrls, initialLoad }) => {
  const classification = classifyLandingRequests(requestUrls);
  const violations = [];

  if (classification.directSupabase.length > 0) {
    violations.push({ type: "direct-supabase", urls: classification.directSupabase });
  }
  if (classification.systemStatus.length > 1) {
    violations.push({
      type: "system-status-count",
      count: classification.systemStatus.length,
      urls: classification.systemStatus,
    });
  }
  if (classification.forbiddenSdk.length > 0) {
    violations.push({ type: "forbidden-sdk", urls: classification.forbiddenSdk });
  }
  if (shouldFailInitialLoad(initialLoad)) {
    violations.push({ type: "initial-load", result: initialLoad });
  }

  return {
    classification,
    systemStatusCount: classification.systemStatus.length,
    violations,
    pass: violations.length === 0,
  };
};

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const waitForPreview = async (child) => {
  const deadline = Date.now() + PREVIEW_START_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Vite preview exited before startup (code ${child.exitCode}, signal ${child.signalCode})`);
    }

    try {
      const response = await fetch(PREVIEW_URL, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = new Error(`Vite preview returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`Vite preview did not become ready within ${PREVIEW_START_TIMEOUT_MS}ms: ${lastError?.message ?? "unknown error"}`);
};

const waitForChildExit = (child, timeoutMs) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise((resolveExit) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
};

const terminatePreview = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  if (await waitForChildExit(child, PROCESS_EXIT_TIMEOUT_MS)) return;

  child.kill("SIGKILL");
  if (!await waitForChildExit(child, PROCESS_EXIT_TIMEOUT_MS)) {
    throw new Error(`Vite preview process ${child.pid} did not exit after SIGKILL`);
  }
};

const printViolations = (violations) => {
  for (const violation of violations) {
    if (violation.type === "system-status-count") {
      console.error(`[perf] system-status request count ${violation.count} exceeds 1`, violation.urls);
    } else if (violation.urls) {
      console.error(`[perf] ${violation.type} request violation`, violation.urls);
    } else {
      console.error("[perf] static initial-load violation", violation.result);
    }
  }
};

const run = async () => {
  const initialLoad = measureInitialLoad();
  const requestUrls = [];
  const preview = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4174",
    "--strictPort",
  ], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  let browser;
  let context;
  let page;

  try {
    await waitForPreview(preview);
    browser = await chromium.launch();
    context = await browser.newContext();
    page = await context.newPage();
    page.on("request", (request) => requestUrls.push(request.url()));
    await page.goto(PREVIEW_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForTimeout(2_000);

    const result = evaluateLandingNetwork({ requestUrls, initialLoad });
    const report = {
      timestamp: new Date().toISOString(),
      page_url: page.url(),
      request_count: requestUrls.length,
      unique_urls: [...new Set(requestUrls)].sort(),
      classification: {
        direct_supabase: result.classification.directSupabase,
        system_status: result.classification.systemStatus,
        forbidden_sdk: result.classification.forbiddenSdk,
      },
      system_status_count: result.systemStatusCount,
      initial_load: {
        ...initialLoad,
        thresholds: {
          max_minified_bytes: MAX_INITIAL_MINIFIED_BYTES,
          max_gzip_bytes: MAX_INITIAL_GZIP_BYTES,
        },
        pass: !shouldFailInitialLoad(initialLoad),
      },
      violations: result.violations,
      pass: result.pass,
    };

    mkdirSync(resolve("artifacts"), { recursive: true });
    writeFileSync(
      resolve("artifacts/landing-network.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );

    console.log("[perf] Fresh production landing network", {
      requestCount: report.request_count,
      uniqueCount: report.unique_urls.length,
      systemStatusCount: report.system_status_count,
      initialMinifiedBytes: report.initial_load.minifiedBytes,
      initialGzipBytes: report.initial_load.gzipBytes,
      pass: report.pass,
    });
    if (!report.pass) {
      printViolations(report.violations);
      process.exitCode = 1;
    }
  } finally {
    await Promise.allSettled([
      page?.close(),
      context?.close(),
      browser?.close(),
    ].filter(Boolean));
    await terminatePreview(preview);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("[perf] Fresh production landing network check failed", error);
    process.exitCode = 1;
  });
}
