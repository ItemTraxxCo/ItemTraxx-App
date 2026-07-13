import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer as createTcpServer } from "node:net";
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
const BROWSER_CLEANUP_STEP_TIMEOUT_MS = 2_000;
const BROWSER_CLEANUP_TIMEOUT_MS = 5_000;
const PREVIEW_CLEANUP_TIMEOUT_MS = 12_000;

class LandingCheckError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "LandingCheckError";
    this.code = code;
  }
}

export const assertPortAvailable = ({ host, port }) => new Promise((resolveAvailable, rejectAvailable) => {
  const server = createTcpServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      rejectAvailable(new LandingCheckError(
        "PREVIEW_PORT_OCCUPIED",
        `Preview port ${port} is already in use on ${host}`,
        { cause: error },
      ));
      return;
    }
    rejectAvailable(error);
  });
  server.listen({ host, port, exclusive: true }, () => {
    server.close((error) => error ? rejectAvailable(error) : resolveAvailable());
  });
});

export const classifyLandingRequests = (urls) => ({
  directSupabase: urls.filter((url) => /https:\/\/[^/]+\.supabase\.(?:co|in)\//i.test(url)),
  systemStatus: urls.filter((url) => /\/functions(?:\/v1)?\/system-status(?:[?#]|$)/i.test(url)),
  forbiddenSdk: urls.filter((url) => /(?:jspdf|html2canvas|jsbarcode|posthog|sentry|supabase)[^/]*\.js(?:[?#]|$)/i.test(url)),
});

export const sanitizeReportUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    const redactedSearch = new URLSearchParams();
    for (const [key] of url.searchParams) redactedSearch.append(key, "[REDACTED]");
    url.search = redactedSearch.toString();
    url.hash = url.hash ? "%5BREDACTED%5D" : "";
    return url.href;
  } catch {
    return "[invalid-url]";
  }
};

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

const sanitizeClassification = (classification) => ({
  direct_supabase: classification.directSupabase.map(sanitizeReportUrl),
  system_status: classification.systemStatus.map(sanitizeReportUrl),
  forbidden_sdk: classification.forbiddenSdk.map(sanitizeReportUrl),
});

const sanitizeViolations = (violations) => violations.map((violation) => {
  if (!violation.urls) return violation;
  return { ...violation, urls: violation.urls.map(sanitizeReportUrl) };
});

export const createLandingNetworkReport = ({ timestamp, pageUrl, requestUrls, initialLoad }) => {
  const result = evaluateLandingNetwork({ requestUrls, initialLoad });
  return {
    timestamp,
    page_url: sanitizeReportUrl(pageUrl),
    request_count: requestUrls.length,
    unique_urls: [...new Set(requestUrls.map(sanitizeReportUrl))].sort(),
    classification: sanitizeClassification(result.classification),
    system_status_count: result.systemStatusCount,
    initial_load: {
      ...initialLoad,
      thresholds: {
        max_minified_bytes: MAX_INITIAL_MINIFIED_BYTES,
        max_gzip_bytes: MAX_INITIAL_GZIP_BYTES,
      },
      pass: !shouldFailInitialLoad(initialLoad),
    },
    violations: sanitizeViolations(result.violations),
    pass: result.pass,
  };
};

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const waitForPreview = async (child) => {
  const deadline = Date.now() + PREVIEW_START_TIMEOUT_MS;
  let lastHttpStatus;
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });

  while (Date.now() < deadline) {
    if (spawnError) {
      throw new LandingCheckError(
        "PREVIEW_SPAWN_FAILED",
        "Vite preview process could not be started",
        { cause: spawnError },
      );
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new LandingCheckError(
        "PREVIEW_EXITED",
        `Vite preview exited before startup (code ${child.exitCode}, signal ${child.signalCode})`,
      );
    }

    try {
      const response = await fetch(PREVIEW_URL, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastHttpStatus = response.status;
    } catch {}
    await delay(250);
  }

  throw new LandingCheckError(
    "PREVIEW_START_TIMEOUT",
    `Vite preview did not become ready within ${PREVIEW_START_TIMEOUT_MS}ms (last HTTP status: ${lastHttpStatus ?? "unavailable"})`,
  );
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

const safeErrorName = (error) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]*Error$/.test(name) || name === "Error" ? name : "Error";
};

export const toSafeFailureDiagnostic = (error) => {
  if (error instanceof LandingCheckError) {
    return { code: error.code, message: error.message };
  }
  return { code: "UNEXPECTED_FAILURE", error: safeErrorName(error) };
};

const runWithSafeFailure = async (code, message, action) => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof LandingCheckError) throw error;
    throw new LandingCheckError(code, message, { cause: error });
  }
};

const settleCleanupStep = (action, timeoutMs, successStatus) => new Promise((resolveStep) => {
  let settled = false;
  const finish = (diagnostic) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolveStep(diagnostic);
  };
  const timeout = setTimeout(() => finish({ status: "timeout" }), Math.max(0, timeoutMs));
  Promise.resolve()
    .then(action)
    .then(
      () => finish({ status: successStatus }),
      (error) => finish({ status: "failed", error: safeErrorName(error) }),
    );
});

export const cleanupLandingResources = async ({
  page,
  context,
  browser,
  preview,
  terminatePreviewFn = terminatePreview,
  stepTimeoutMs = BROWSER_CLEANUP_STEP_TIMEOUT_MS,
  browserTimeoutMs = BROWSER_CLEANUP_TIMEOUT_MS,
  previewTimeoutMs = PREVIEW_CLEANUP_TIMEOUT_MS,
}) => {
  const diagnostics = [];
  const browserDeadline = Date.now() + browserTimeoutMs;

  try {
    for (const [step, resource] of [["page", page], ["context", context], ["browser", browser]]) {
      if (!resource) continue;
      const remainingMs = Math.max(0, browserDeadline - Date.now());
      const result = await settleCleanupStep(
        () => resource.close(),
        Math.min(stepTimeoutMs, remainingMs),
        "closed",
      );
      diagnostics.push({ step, ...result });
    }
  } finally {
    const result = await settleCleanupStep(
      () => terminatePreviewFn(preview),
      previewTimeoutMs,
      "terminated",
    );
    diagnostics.push({ step: "preview", ...result });
  }

  return diagnostics;
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
  const initialLoad = await runWithSafeFailure(
    "STATIC_ANALYSIS_FAILED",
    "Static initial-load analysis could not read the production build",
    () => measureInitialLoad(),
  );
  const requestUrls = [];
  await assertPortAvailable({ host: "127.0.0.1", port: 4174 });
  const preview = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4174",
    "--strictPort",
  ], {
    stdio: "ignore",
  });
  let browser;
  let context;
  let page;
  let primaryError;
  let cleanupDiagnostics = [];

  try {
    await waitForPreview(preview);
    browser = await runWithSafeFailure(
      "BROWSER_LAUNCH_FAILED",
      "Fresh Chromium could not be launched",
      () => chromium.launch(),
    );
    context = await runWithSafeFailure(
      "BROWSER_CONTEXT_FAILED",
      "Fresh Chromium context could not be created",
      () => browser.newContext(),
    );
    page = await runWithSafeFailure(
      "BROWSER_PAGE_FAILED",
      "Fresh Chromium page could not be created",
      () => context.newPage(),
    );
    page.on("request", (request) => requestUrls.push(request.url()));
    await runWithSafeFailure(
      "NAVIGATION_FAILED",
      `Landing navigation did not reach DOM content within ${NAVIGATION_TIMEOUT_MS}ms`,
      () => page.goto(PREVIEW_URL, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      }),
    );
    await page.waitForTimeout(2_000);

    const report = createLandingNetworkReport({
      timestamp: new Date().toISOString(),
      pageUrl: page.url(),
      requestUrls,
      initialLoad,
    });

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
  } catch (error) {
    primaryError = error;
  } finally {
    cleanupDiagnostics = await cleanupLandingResources({ page, context, browser, preview });
  }

  const cleanupFailures = cleanupDiagnostics.filter(({ status }) => status === "failed" || status === "timeout");
  if (cleanupFailures.length > 0) {
    console.error("[perf] Landing check cleanup failures", cleanupFailures);
    process.exitCode = 1;
  }
  if (primaryError) throw primaryError;
  if (cleanupFailures.length > 0) {
    throw new Error("Landing check cleanup did not complete successfully");
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("[perf] Fresh production landing network check failed", toSafeFailureDiagnostic(error));
    process.exitCode = 1;
  });
}
