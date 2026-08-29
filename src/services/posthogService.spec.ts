import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./cookieConsentService", () => ({
  allowsAnalytics: vi.fn(),
  readCookieConsent: vi.fn(),
}));
vi.mock("./appErrorRecovery", () => ({
  isRecoverableChunkLoadError: vi.fn(() => false),
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
  captureException: vi.fn(),
};
vi.mock("posthog-js", () => ({ default: posthogMock }));

import { allowsAnalytics } from "./cookieConsentService";

const mockedAllows = vi.mocked(allowsAnalytics);

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
  const mod = await loadFreshModule();
  await mod.initPostHog();
  return mod;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("initPostHog", () => {
  it("does not initialize when there is no PostHog token configured", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "");
    mockedAllows.mockReturnValue(true);
    const mod = await loadFreshModule();

    await mod.initPostHog();

    expect(posthogMock.init).not.toHaveBeenCalled();
  });

  it("does not initialize when analytics consent has not been granted", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_123");
    mockedAllows.mockReturnValue(false);
    const mod = await loadFreshModule();

    await mod.initPostHog();

    expect(posthogMock.init).not.toHaveBeenCalled();
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
        logs: expect.objectContaining({ captureConsoleLogs: false }),
        disable_session_recording: true,
      })
    );
    const options = posthogMock.init.mock.calls[0]?.[1] as {
      logs?: { beforeSend?: (record: { body: string }) => unknown };
    } | undefined;
    expect(options?.logs?.beforeSend?.({ body: "backend diagnostic token=secret" })).toBeNull();
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
  it("captures only a fixed code without the original message, stack, cause, or context", async () => {
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
      message: "invalid_barcode",
      stack: undefined,
    });
    expect(capturedError).not.toHaveProperty("cause");
    expect(properties).toEqual({ error_code: "invalid_barcode" });
  });

  it("maps an unexpected error to an opaque fixed category", async () => {
    const mod = await initializedModule();

    mod.capturePostHogException({ message: "backend diagnostic with token secret" });

    const [capturedError, properties] = posthogMock.captureException.mock.calls[0] ?? [];
    expect(capturedError).toMatchObject({
      name: "ItemTraxxClientError",
      message: "unknown_error",
      stack: undefined,
    });
    expect(properties).toEqual({ error_code: "unknown_error" });
  });

  it("swallows a thrown captureException error", async () => {
    const mod = await initializedModule();
    posthogMock.captureException.mockImplementationOnce(() => {
      throw new Error("capture exception failed");
    });

    expect(() => mod.capturePostHogException(new Error("boom"))).not.toThrow();
  });
});

describe("PostHog exception before_send", () => {
  it("removes exception values, stack frames, context, and arbitrary properties", async () => {
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
              frames: [{ context_line: "email person@example.com", vars: { token: "secret" } }],
            },
          },
        ],
        raw_context: "borrower name and backend details",
      },
    }) as { event: string; properties: Record<string, unknown> } | null;

    expect(result).toEqual({
      event: "$exception",
      properties: {
        token: "project-token",
        $exception_list: [
          {
            type: "ItemTraxxClientError",
            value: "unknown_error",
            mechanism: { type: "generic", handled: true, synthetic: true },
          },
        ],
        $exception_level: "error",
        error_code: "unknown_error",
      },
    });
  });
});

describe("syncPostHogConsent", () => {
  it("opts in when analytics consent is granted", async () => {
    const mod = await initializedModule();

    mod.syncPostHogConsent();

    expect(posthogMock.opt_in_capturing).toHaveBeenCalledOnce();
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("opts out when analytics consent is not granted", async () => {
    const mod = await initializedModule();
    mockedAllows.mockReturnValue(false);

    mod.syncPostHogConsent();

    expect(posthogMock.opt_out_capturing).toHaveBeenCalledOnce();
  });
});
