import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cookieConsentService", () => ({
  allowsAnalytics: vi.fn(),
  allowsDiagnostics: vi.fn(),
  allowsSessionReplay: vi.fn(),
  readCookieConsent: vi.fn(),
}));
vi.mock("./appErrorRecovery", () => ({
  isRecoverableChunkLoadError: vi.fn(() => false),
  dispatchRecoverableAppError: vi.fn(),
}));
vi.mock("./sessionReplayHandoff", () => ({
  clearReplaySessionHandoff: vi.fn(),
}));

const posthogMock = {
  init: vi.fn((_token: string, options: { loaded?: () => void }) => {
    options.loaded?.();
  }),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  set_config: vi.fn(),
  captureException: vi.fn(),
  captureLog: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
};
vi.mock("posthog-js", () => ({ default: posthogMock }));

import { allowsAnalytics, allowsDiagnostics, allowsSessionReplay } from "./cookieConsentService";
import { clearReplaySessionHandoff } from "./sessionReplayHandoff";

const mockedAllows = vi.mocked(allowsAnalytics);
const mockedDiagnostics = vi.mocked(allowsDiagnostics);
const mockedSessionReplay = vi.mocked(allowsSessionReplay);
const mockedClearReplayHandoff = vi.mocked(clearReplaySessionHandoff);

const originalLocation = window.location;
const setHostname = (hostname: string) => {
  Object.defineProperty(window, "location", {
    value: { ...window.location, hostname },
    writable: true,
    configurable: true,
  });
};

const restoreLocation = () => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
};

// `initialized`/`posthog` are module-level singletons in posthogService, so each
// describe block that needs a distinct lifecycle state (never-initialized vs.
// successfully-initialized) loads its own fresh module instance via resetModules,
// per the house pattern for singleton-state services.
const loadFreshModule = async () => {
  vi.resetModules();
  return import("./posthogService");
};

const initializedModule = async () => {
  vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_123");
  mockedAllows.mockReturnValue(true);
  mockedDiagnostics.mockReturnValue(true);
  mockedSessionReplay.mockReturnValue(true);
  const mod = await loadFreshModule();
  await mod.initPostHog();
  return mod;
};

beforeEach(() => setHostname("app.itemtraxx.com"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  restoreLocation();
});

describe("initPostHog", () => {
  it("does not initialize when there is no PostHog token configured", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "");
    mockedAllows.mockReturnValue(true);
    const mod = await loadFreshModule();

    await mod.initPostHog();

    expect(posthogMock.init).not.toHaveBeenCalled();
  });

  it("does not initialize or record replay for essential-only consent", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_123");
    mockedAllows.mockReturnValue(false);
    mockedDiagnostics.mockReturnValue(false);
    mockedSessionReplay.mockReturnValue(false);
    const mod = await loadFreshModule();

    await mod.initPostHog();

    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.startSessionRecording).not.toHaveBeenCalled();
    expect(posthogMock.stopSessionRecording).not.toHaveBeenCalled();
    expect(mockedClearReplayHandoff).toHaveBeenCalled();
  });

  it("initializes diagnostics-only tracking without enabling analytics or replay", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_123");
    mockedAllows.mockReturnValue(false);
    mockedDiagnostics.mockReturnValue(true);
    mockedSessionReplay.mockReturnValue(false);
    const mod = await loadFreshModule();

    await mod.initPostHog();

    expect(posthogMock.init).toHaveBeenCalledWith(
      "tok_123",
      expect.objectContaining({
        capture_exceptions: true,
        capture_pageview: false,
        capture_pageleave: false,
        persistence: "memory",
        disable_persistence: true,
        disable_session_recording: true,
        cross_subdomain_cookie: true,
        cookieWinsOnConflict: true,
      }),
    );
    expect(posthogMock.init.mock.calls[0]?.[1]).not.toHaveProperty("bootstrap");
  });

  it("disables exception autocapture on localhost", async () => {
    setHostname("localhost");
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_123");
    mockedAllows.mockReturnValue(true);
    mockedDiagnostics.mockReturnValue(true);
    mockedSessionReplay.mockReturnValue(false);
    const mod = await loadFreshModule();

    await mod.initPostHog();

    expect(posthogMock.init).toHaveBeenCalledWith(
      "tok_123",
      expect.objectContaining({ capture_exceptions: false }),
    );
  });

  it("initializes posthog-js with the configured token once token + consent are both present", async () => {
    const mod = await initializedModule();
    void mod;

    expect(posthogMock.init).toHaveBeenCalledWith(
      "tok_123",
      expect.objectContaining({
        capture_exceptions: true,
        autocapture: false,
        capture_pageleave: true,
        cross_subdomain_cookie: true,
        cookieWinsOnConflict: true,
        logs: expect.objectContaining({ captureConsoleLogs: false }),
        disable_session_recording: false,
        session_recording: expect.objectContaining({
          maskAllInputs: true,
          maskTextSelector: "[data-session-replay-mask]",
          maskAllElementAttributes: false,
          maskAttributeFn: expect.any(Function),
          recordHeaders: false,
          recordBody: false,
          maskCapturedNetworkRequestFn: expect.any(Function),
        }),
      })
    );
    const sessionRecording = posthogMock.init.mock.calls[0]?.[1] as {
      session_recording?: {
        maskAttributeFn?: (name: string, value: string, element?: Element) => string;
        maskCapturedNetworkRequestFn?: (request: { name: string }) => { name?: string };
      };
    } | undefined;
    const markedImage = document.createElement("img");
    markedImage.setAttribute("data-session-replay-mask", "");
    const qrDataUrl = "data:image/png;base64,totp-secret";
    expect(sessionRecording?.session_recording?.maskAttributeFn?.("src", qrDataUrl, markedImage)).toBe("*".repeat(qrDataUrl.length));
    expect(sessionRecording?.session_recording?.maskAttributeFn?.("title", "Borrower name", markedImage)).toBe("*".repeat("Borrower name".length));
    const markedAnchor = document.createElement("a");
    markedAnchor.setAttribute("data-session-replay-mask", "");
    const signedAttachmentUrl = "https://project.supabase.co/storage/v1/object/sign/support-attachments/ticket-42/evidence.png?token=secret";
    expect(sessionRecording?.session_recording?.maskAttributeFn?.("href", signedAttachmentUrl, markedAnchor)).toBe("*".repeat(signedAttachmentUrl.length));
    const ordinaryImage = document.createElement("img");
    expect(sessionRecording?.session_recording?.maskAttributeFn?.("src", "/logo.svg", ordinaryImage)).toBe("/logo.svg");
    const maskedRequest = sessionRecording?.session_recording?.maskCapturedNetworkRequestFn?.({
      name: "https://www.itemtraxx.com/reset-password?token=secret",
    });
    expect(maskedRequest).toMatchObject({ name: "https://www.itemtraxx.com/reset-password" });
    const maskedSignedRequest = sessionRecording?.session_recording?.maskCapturedNetworkRequestFn?.({
      name: `${signedAttachmentUrl}&download=1`,
    });
    expect(maskedSignedRequest).toMatchObject({
      name: "https://project.supabase.co/storage/v1/object/sign/support-attachments/ticket-42/evidence.png",
    });
    const ordinaryRequest = sessionRecording?.session_recording?.maskCapturedNetworkRequestFn?.({
      name: "https://www.itemtraxx.com/login?next=/workspace",
    });
    expect(ordinaryRequest).toMatchObject({ name: "https://www.itemtraxx.com/login?next=/workspace" });
    const options = posthogMock.init.mock.calls[0]?.[1] as {
      logs?: { beforeSend?: (record: { body: string; attributes?: Record<string, unknown> }) => unknown };
    } | undefined;
    expect(options?.logs?.beforeSend?.({ body: "backend diagnostic token=secret" })).toMatchObject({
      body: "backend diagnostic token=[REDACTED]",
    });
    expect(options?.logs?.beforeSend?.({
      body: "raw console detail",
      attributes: { "log.source": "console.error" },
    })).toBeNull();
  });

  it("keeps every PostHog diagnostic sink disabled when diagnostics consent is declined", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_123");
    mockedAllows.mockReturnValue(true);
    mockedDiagnostics.mockReturnValue(false);
    mockedSessionReplay.mockReturnValue(false);
    const mod = await loadFreshModule();

    await mod.initPostHog();

    expect(posthogMock.init).toHaveBeenCalledWith(
      "tok_123",
      expect.objectContaining({
        capture_exceptions: false,
        logs: expect.objectContaining({ captureConsoleLogs: false }),
        disable_session_recording: true,
      }),
    );
  });

  it("is idempotent: a second call does not re-init", async () => {
    const mod = await initializedModule();

    await mod.initPostHog();

    expect(posthogMock.init).toHaveBeenCalledTimes(1);
  });

  it("swallows an error thrown during init and logs a warning instead of throwing", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_123");
    mockedAllows.mockReturnValue(true);
    posthogMock.init.mockImplementationOnce(() => {
      throw new Error("init blew up");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadFreshModule();

    await expect(mod.initPostHog()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("before initialization", () => {
  it("capturePostHogEvent, identifyPostHogUser, resetPostHog, capturePostHogException, and syncPostHogConsent are all no-ops", async () => {
    mockedAllows.mockReturnValue(true);
    const mod = await loadFreshModule();

    expect(() => mod.capturePostHogEvent("evt")).not.toThrow();
    expect(() => mod.identifyPostHogUser("user-1")).not.toThrow();
    expect(() => mod.resetPostHog()).not.toThrow();
    expect(() => mod.capturePostHogException(new Error("x"))).not.toThrow();
    expect(() => mod.syncPostHogConsent()).not.toThrow();

    expect(posthogMock.capture).not.toHaveBeenCalled();
    expect(posthogMock.identify).not.toHaveBeenCalled();
    expect(posthogMock.reset).not.toHaveBeenCalled();
    expect(posthogMock.captureException).not.toHaveBeenCalled();
    expect(posthogMock.opt_in_capturing).not.toHaveBeenCalled();
  });
});

describe("capturePostHogEvent", () => {
  it("forwards the event with scrubbed properties once initialized", async () => {
    const mod = await initializedModule();

    mod.capturePostHogEvent("item_checked_out", { item_id: "1", quantity: 2 });

    expect(posthogMock.capture).toHaveBeenCalledWith("item_checked_out", { item_id: "1", quantity: 2 });
  });

  it("drops properties whose key matches a sensitive pattern", async () => {
    const mod = await initializedModule();

    mod.capturePostHogEvent("evt", { borrower_name: "Jane", user_id: "u1", quantity: 3 });

    expect(posthogMock.capture).toHaveBeenCalledWith("evt", { quantity: 3 });
  });

  it("drops raw error fields while retaining a fixed error code", async () => {
    const mod = await initializedModule();

    mod.capturePostHogEvent("checkout_transaction_failed", {
      error_message: "barcode BC-123 for person@example.com",
      error_type: "backend token secret-diagnostic",
      error_code: "invalid_barcode",
      error_count: 1,
    });

    expect(posthogMock.capture).toHaveBeenCalledWith("checkout_transaction_failed", {
      error_code: "invalid_barcode",
      error_count: 1,
    });
  });

  it("drops properties whose string value looks like an email even if the key is benign", async () => {
    const mod = await initializedModule();

    mod.capturePostHogEvent("evt", { note: "contact test@example.com", count: 1 });

    expect(posthogMock.capture).toHaveBeenCalledWith("evt", { count: 1 });
  });

  it("does nothing when analytics consent is revoked after initialization", async () => {
    const mod = await initializedModule();
    mockedAllows.mockReturnValue(false);

    mod.capturePostHogEvent("evt");

    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it("swallows a thrown capture error", async () => {
    const mod = await initializedModule();
    posthogMock.capture.mockImplementationOnce(() => {
      throw new Error("capture failed");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => mod.capturePostHogEvent("evt")).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("capturePostHogLog", () => {
  it("captures only an explicit, scrubbed structured record", async () => {
    const mod = await initializedModule();

    mod.capturePostHogLog({
      body: "request completed for person@example.com token=secret",
      level: "error",
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
      attributes: {
        route: "/functions/admin-ops",
        status: 500,
        request_id: "request-1",
        error_code: "server_error",
        email: "person@example.com",
        detail: "not in the allowlist",
      },
    });

    expect(posthogMock.captureLog).toHaveBeenCalledWith({
      body: "request completed for [REDACTED_EMAIL] token=[REDACTED]",
      level: "error",
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
      attributes: {
        route: "/functions/admin-ops",
        status: 500,
        request_id: "request-1",
        error_code: "server_error",
      },
    });
  });

  it("does nothing after analytics consent is revoked", async () => {
    const mod = await initializedModule();
    mockedAllows.mockReturnValue(false);
    mockedDiagnostics.mockReturnValue(false);

    mod.capturePostHogLog({ body: "request completed", level: "info" });

    expect(posthogMock.captureLog).not.toHaveBeenCalled();
  });

  it("does not send application diagnostics logs from localhost", async () => {
    setHostname("localhost");
    const mod = await initializedModule();

    mod.capturePostHogLog({ body: "local request failure", level: "error" });

    expect(posthogMock.captureLog).not.toHaveBeenCalled();
  });
});

describe("identifyPostHogUser", () => {
  it("identifies with scrubbed properties for a non-email distinct id", async () => {
    const mod = await initializedModule();

    mod.identifyPostHogUser("user-1", { plan: "growth", email: "leaked@example.com" });

    expect(posthogMock.identify).toHaveBeenCalledWith("user-1", { plan: "growth" });
  });

  it("refuses (and does not call identify) when the distinct id itself looks like an email", async () => {
    const mod = await initializedModule();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => mod.identifyPostHogUser("person@example.com")).not.toThrow();

    expect(posthogMock.identify).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("resetPostHog", () => {
  it("calls posthog.reset() once initialized", async () => {
    const mod = await initializedModule();

    mod.resetPostHog();

    expect(posthogMock.reset).toHaveBeenCalledOnce();
    expect(mockedClearReplayHandoff).toHaveBeenCalled();
  });

  it("swallows a thrown reset error", async () => {
    const mod = await initializedModule();
    posthogMock.reset.mockImplementationOnce(() => {
      throw new Error("reset failed");
    });

    expect(() => mod.resetPostHog()).not.toThrow();
  });
});

describe("capturePostHogException", () => {
  it("captures the original error for source-map grouping while adding only a fixed code", async () => {
    const mod = await initializedModule();
    const error = new Error("barcode BC-123 email person@example.com token=secret backend diagnostic");
    error.stack = "sensitive stack with person@example.com";
    error.cause = { message: "sensitive cause" };

    mod.capturePostHogException(error);

    const [capturedError, properties] = posthogMock.captureException.mock.calls[0] ?? [];
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError).not.toBe(error);
    expect(capturedError).toMatchObject({
      name: "ItemTraxxClientError",
      message: "barcode BC-123 email [REDACTED_EMAIL] token=[REDACTED] backend diagnostic",
    });
    expect(capturedError).toHaveProperty("stack", "sensitive stack with [REDACTED_EMAIL]");
    expect(capturedError).not.toHaveProperty("cause");
    expect(properties).toEqual({ error_code: "invalid_barcode" });
  });

  it("does not capture diagnostics when diagnostics consent is revoked", async () => {
    const mod = await initializedModule();
    mockedDiagnostics.mockReturnValue(false);
    mockedSessionReplay.mockReturnValue(false);

    mod.capturePostHogException(new Error("diagnostic detail"));

    expect(posthogMock.captureException).not.toHaveBeenCalled();
  });

  it("does not send exception diagnostics from localhost", async () => {
    setHostname("localhost");
    const mod = await initializedModule();

    mod.capturePostHogException(new Error("local development failure"));

    expect(posthogMock.captureException).not.toHaveBeenCalled();
  });

  it("maps an unexpected error to an opaque fixed category", async () => {
    const mod = await initializedModule();

    mod.capturePostHogException({ message: "backend diagnostic with token secret" });

    const [capturedError, properties] = posthogMock.captureException.mock.calls[0] ?? [];
    expect(capturedError).toMatchObject({
      name: "ItemTraxxClientError",
      message: "unknown_error",
    });
    expect(capturedError).toHaveProperty("stack");
    expect(properties).toEqual({ error_code: "unknown_error" });
  });

  it("drops an expected, non-reporting AppError instead of opening an error tracking issue", async () => {
    const mod = await initializedModule();
    // Loaded after initializedModule's resetModules so the AppError class the guard
    // checks against is the same instance the service imported.
    const { notFoundError } = await import("./appErrors");

    mod.capturePostHogException(notFoundError("Borrower not found."));

    expect(posthogMock.captureException).not.toHaveBeenCalled();
  });

  it("captures non-NOT_FOUND AppErrors as a fixed diagnostic code", async () => {
    const mod = await initializedModule();
    const { AppError } = await import("./appErrors");
    const error = new AppError("NETWORK", "Network request failed", { reportToErrorTracking: false });

    mod.capturePostHogException(error);

    const [capturedError, properties] = posthogMock.captureException.mock.calls[0] ?? [];
    expect(capturedError).not.toBe(error);
    expect(capturedError).toMatchObject({
      name: "AppError",
      message: "Network request failed",
    });
    expect(capturedError).toHaveProperty("stack");
    expect(properties).toEqual({ error_code: "network" });
  });

  it("swallows a thrown captureException error", async () => {
    const mod = await initializedModule();
    posthogMock.captureException.mockImplementationOnce(() => {
      throw new Error("capture exception failed");
    });

    expect(() => mod.capturePostHogException(new Error("boom"))).not.toThrow();
  });
});

describe("captureHandledRequestFailure", () => {
  it("waits for the SDK loaded callback before capturing a handled 5xx", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_123");
    mockedAllows.mockReturnValue(true);
    mockedDiagnostics.mockReturnValue(true);
    mockedSessionReplay.mockReturnValue(true);
    let loaded: (() => void) | undefined;
    posthogMock.init.mockImplementationOnce((_token, options) => {
      loaded = options.loaded;
    });
    const mod = await loadFreshModule();
    await mod.initPostHog();

    const capturePromise = mod.captureHandledRequestFailure({
      area: "edge_function",
      name: "checkoutReturn",
      path: "/functions/checkoutReturn",
      method: "POST",
      status: 500,
      message: "Request failed.",
      requestId: "request-5xx",
    });
    await Promise.resolve();

    expect(posthogMock.captureException).not.toHaveBeenCalled();
    loaded?.();
    await capturePromise;

    expect(posthogMock.captureException).toHaveBeenCalledOnce();
  });

  it("does not promote handled network, timeout, auth, or rate-limit outcomes to error tracking", async () => {
    const mod = await initializedModule();
    const handledOutcomes = [
      {
        area: "edge_function",
        name: "admin-ops",
        path: "/functions/admin-ops",
        method: "POST",
        status: 0,
        message: "Network request failed before response.",
        errorCode: "network",
      },
      {
        area: "edge_function",
        name: "system-status",
        path: "/functions/system-status",
        method: "GET",
        status: 0,
        message: "System status request timed out.",
        errorCode: "timeout",
      },
      {
        area: "http_session",
        name: "/api/auth/get-session",
        path: "/api/auth/get-session",
        method: "GET",
        status: 0,
        message: "Authentication request failed before response.",
        errorCode: "network",
      },
      {
        area: "edge_function",
        name: "admin-ops",
        path: "/functions/admin-ops",
        method: "POST",
        status: 403,
        message: "Permission denied.",
      },
      {
        area: "authenticated_data",
        name: "/rest/v1/items",
        path: "/rest/v1/items",
        method: "GET",
        status: 429,
        message: "Rate limit exceeded.",
      },
    ] as const;

    for (const failure of handledOutcomes) {
      await mod.captureHandledRequestFailure(failure);
    }

    expect(posthogMock.captureException).not.toHaveBeenCalled();
  });

  it("does not send handled request failures from localhost", async () => {
    setHostname("localhost");
    const mod = await initializedModule();

    await mod.captureHandledRequestFailure({
      area: "edge_function",
      name: "checkoutReturn",
      path: "/functions/checkoutReturn",
      method: "POST",
      status: 500,
      message: "Local development failure.",
    });

    expect(posthogMock.captureException).not.toHaveBeenCalled();
  });
});

describe("before_send exception filter", () => {
  const getBeforeSend = () => {
    const options = posthogMock.init.mock.calls[0][1] as {
      before_send: (event: unknown) => unknown;
    };
    return options.before_send;
  };

  const opaqueScriptEvent = {
    event: "$exception",
    properties: {
      $exception_list: [
        {
          type: "Error",
          value: "Script error.",
          stacktrace: { frames: [] },
          mechanism: { synthetic: true, handled: false },
        },
      ],
    },
  };

  it("drops an opaque cross-origin \"Script error.\" exception", async () => {
    const mod = await initializedModule();
    void mod;

    expect(getBeforeSend()(opaqueScriptEvent)).toBeNull();
  });

  it("drops all exception events on localhost", async () => {
    setHostname("localhost");
    const mod = await initializedModule();
    void mod;

    expect(getBeforeSend()({ event: "$exception", properties: {} })).toBeNull();
  });

  it("keeps a \"Script error.\" event that carries a real stack", async () => {
    const mod = await initializedModule();
    void mod;

    const event = {
      event: "$exception",
      properties: {
        $exception_list: [
          {
            type: "Error",
            value: "Script error.",
            stacktrace: { frames: [{ filename: "app.js" }] },
            mechanism: { synthetic: true },
          },
        ],
      },
    };

    expect(getBeforeSend()(event)).toMatchObject({
      event: "$exception",
      properties: {
        $exception_list: [{ value: "Script error." }],
      },
    });
  });

  it("keeps a non-synthetic \"Script error.\" event", async () => {
    const mod = await initializedModule();
    void mod;

    const event = {
      event: "$exception",
      properties: {
        $exception_list: [
          {
            type: "Error",
            value: "Script error.",
            stacktrace: { frames: [] },
            mechanism: { synthetic: false },
          },
        ],
      },
    };

    expect(getBeforeSend()(event)).toMatchObject({
      event: "$exception",
      properties: {
        $exception_list: [{ value: "Script error." }],
      },
    });
  });

  it("keeps a regular exception event", async () => {
    const mod = await initializedModule();
    void mod;

    const event = {
      event: "$exception",
      properties: {
        $exception_list: [
          { type: "TypeError", value: "x is not a function", mechanism: { synthetic: false } },
        ],
      },
    };

    expect(getBeforeSend()(event)).toMatchObject({
      event: "$exception",
      properties: {
        $exception_list: [{ value: "x is not a function" }],
      },
    });
  });
});

describe("PostHog exception before_send", () => {
  it("scrubs exception values and context while retaining source-map frames", async () => {
    const mod = await initializedModule();
    void mod;
    const options = posthogMock.init.mock.calls[0]?.[1] as {
      before_send?: (event: unknown) => unknown;
    } | undefined;

    const result = options?.before_send?.({
      event: "$exception",
      properties: {
        token: "project-token",
        error_message: "barcode BC-123 email person@example.com",
        $exception_list: [
          {
            type: "Error",
            value: "backend diagnostic token=secret",
            stacktrace: {
              type: "raw",
              frames: [{
                platform: "web:javascript",
                context_line: "email person@example.com",
                vars: { token: "secret" },
              }],
            },
          },
        ],
        raw_context: "borrower name and backend details",
        route: "/functions/admin-ops",
        request_id: "request-1",
        request_status: 500,
      },
    }) as { event: string; properties: Record<string, unknown> } | null;

    expect(result).toEqual({
      event: "$exception",
      properties: {
        token: "project-token",
        $exception_list: [
          {
            type: "Error",
            value: "backend diagnostic token=[REDACTED]",
            stacktrace: { type: "raw", frames: [{ platform: "web:javascript" }] },
          },
        ],
        $exception_level: "error",
        error_code: "unknown_error",
        route: "/functions/admin-ops",
        request_id: "request-1",
        request_status: 500,
      },
    });
  });

  it("keeps handled request failures grouped by safe operation context", async () => {
    const mod = await initializedModule();
    void mod;
    const options = posthogMock.init.mock.calls[0]?.[1] as {
      before_send?: (event: unknown) => unknown;
    } | undefined;

    const result = options?.before_send?.({
      event: "$exception",
      properties: {
        $exception_list: [{
          type: "ItemTraxxHandledRequestFailure",
          value: "Handled request failure: network",
          stacktrace: {
            type: "raw",
            frames: [{ platform: "web:javascript", filename: "/assets/app.js" }],
          },
        }],
        error_code: "network",
        request_area: "edge_function",
        request_operation: "admin-ops",
        request_status: 0,
      },
    }) as { event: string; properties: Record<string, unknown> } | null;

    expect(result?.properties.$exception_list).toEqual([{
      type: "ItemTraxxHandledRequestFailure",
      value: "admin-ops:network",
      stacktrace: {
        type: "raw",
        frames: [{ platform: "web:javascript", filename: "/assets/app.js" }],
      },
      mechanism: { type: "generic", handled: true, synthetic: false },
    }]);
  });

  it("carries the SDK-managed distinct id and library keys through the rebuild", async () => {
    const mod = await initializedModule();
    void mod;
    const options = posthogMock.init.mock.calls[0]?.[1] as {
      before_send?: (event: unknown) => unknown;
    } | undefined;

    const result = options?.before_send?.({
      event: "$exception",
      properties: {
        distinct_id: "user-1",
        $lib: "web",
        $lib_version: "1.2.3",
        $session_id: "session-1",
        $device_id: "device-1",
        $exception_list: [{ type: "Error", value: "boom" }],
      },
    }) as { properties: Record<string, unknown> } | null;

    expect(result?.properties).toMatchObject({
      distinct_id: "user-1",
      $lib: "web",
      $lib_version: "1.2.3",
      $session_id: "session-1",
      $device_id: "device-1",
    });
  });

  it("scrubs recovery query and hash material from URL properties", async () => {
    const mod = await initializedModule();
    void mod;
    const options = posthogMock.init.mock.calls[0]?.[1] as {
      before_send?: (event: unknown) => unknown;
    } | undefined;

    const result = options?.before_send?.({
      event: "$pageview",
      properties: {
        $current_url:
          "https://www.itemtraxx.com/reset-password?type=recovery&access_token=secret#refresh_token=refresh-secret",
        $referrer: "/reset-password?code=one-time-code",
        safe_url: "https://www.itemtraxx.com/login?next=/reset-password",
      },
    }) as { properties: Record<string, unknown> } | null;

    expect(result?.properties).toEqual({
      $current_url: "https://www.itemtraxx.com/reset-password",
      $referrer: "/reset-password",
      safe_url: "https://www.itemtraxx.com/login?next=/reset-password",
    });
  });

  it("scrubs secret-looking URL parameters without dropping ordinary navigation state", async () => {
    const mod = await initializedModule();
    void mod;
    const options = posthogMock.init.mock.calls[0]?.[1] as {
      before_send?: (event: unknown) => unknown;
    } | undefined;

    const result = options?.before_send?.({
      event: "$pageview",
      properties: {
        $current_url:
          "https://www.itemtraxx.com/invite?workspace=demo&code=one-time-code#next=/workspace&token=secret",
      },
    }) as { properties: Record<string, unknown> } | null;

    expect(result?.properties).toEqual({
      $current_url: "https://www.itemtraxx.com/invite?workspace=demo#next=%2Fworkspace",
    });
  });
});

describe("syncPostHogConsent", () => {
  it("opts in when analytics consent is granted", async () => {
    const mod = await initializedModule();

    mod.syncPostHogConsent();

    expect(posthogMock.opt_in_capturing).toHaveBeenCalledOnce();
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled();
    expect(posthogMock.set_config).toHaveBeenCalledWith(expect.objectContaining({ capture_exceptions: true }));
    expect(posthogMock.startSessionRecording).toHaveBeenCalledOnce();
    expect(posthogMock.stopSessionRecording).not.toHaveBeenCalled();
  });

  it("keeps diagnostics enabled while analytics consent is not granted, but stops replay", async () => {
    const mod = await initializedModule();
    mockedAllows.mockReturnValue(false);
    mockedSessionReplay.mockReturnValue(false);

    mod.syncPostHogConsent();

    expect(posthogMock.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled();
    expect(posthogMock.set_config).toHaveBeenCalledWith(expect.objectContaining({
      capture_exceptions: true,
      capture_pageview: false,
      capture_pageleave: false,
      disable_persistence: true,
      disable_session_recording: true,
    }));
    expect(posthogMock.startSessionRecording).not.toHaveBeenCalled();
    expect(posthogMock.stopSessionRecording).toHaveBeenCalledOnce();
    expect(mockedClearReplayHandoff).toHaveBeenCalled();
  });

  it("opts out of every PostHog sink when both optional consents are declined", async () => {
    const mod = await initializedModule();
    mockedAllows.mockReturnValue(false);
    mockedDiagnostics.mockReturnValue(false);

    mod.syncPostHogConsent();

    expect(posthogMock.opt_out_capturing).toHaveBeenCalledOnce();
    expect(posthogMock.set_config).toHaveBeenCalledWith(expect.objectContaining({
      capture_exceptions: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_persistence: true,
    }));
    expect(posthogMock.stopSessionRecording).toHaveBeenCalledOnce();
    expect(mockedClearReplayHandoff).toHaveBeenCalled();
  });

  it("disables PostHog exception autocapture when diagnostics consent is revoked", async () => {
    const mod = await initializedModule();
    mockedDiagnostics.mockReturnValue(false);
    mockedSessionReplay.mockReturnValue(false);

    mod.syncPostHogConsent();

    expect(posthogMock.set_config).toHaveBeenCalledWith(expect.objectContaining({ capture_exceptions: false }));
  });

  it("stops session replay when diagnostics consent is revoked but analytics stays granted", async () => {
    const mod = await initializedModule();
    mockedDiagnostics.mockReturnValue(false);
    mockedSessionReplay.mockReturnValue(false);

    mod.syncPostHogConsent();

    expect(posthogMock.opt_in_capturing).toHaveBeenCalledOnce();
    expect(posthogMock.stopSessionRecording).toHaveBeenCalledOnce();
    expect(posthogMock.startSessionRecording).not.toHaveBeenCalled();
  });
});
