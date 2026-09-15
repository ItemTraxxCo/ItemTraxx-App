import type { App } from "vue";
import type { Router } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/cookieConsentService", () => ({
  allowsAnalytics: vi.fn(() => true),
  allowsDiagnostics: vi.fn(() => false),
  readCookieConsent: vi.fn(() => null),
  subscribeCookieConsent: vi.fn(() => vi.fn()),
}));

const posthogLifecycle = vi.hoisted(() => ({
  initPostHog: vi.fn(async () => undefined),
  syncPostHogConsent: vi.fn(),
}));

vi.mock("../services/posthogService", () => posthogLifecycle);
vi.mock("../services/globalErrorHandling", () => ({
  installGlobalErrorHandling: vi.fn(),
}));

import { createClientMonitoring } from "./clientMonitoring";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("createClientMonitoring", () => {
  it("reconciles consent after PostHog initialization", async () => {
    vi.stubEnv("VITE_POSTHOG_PROJECT_TOKEN", "tok_test");
    const order: string[] = [];
    posthogLifecycle.initPostHog.mockImplementationOnce(async () => {
      order.push("init-start");
      await Promise.resolve();
      order.push("init-end");
    });
    posthogLifecycle.syncPostHogConsent.mockImplementationOnce(() => {
      order.push("sync");
    });

    const monitoring = createClientMonitoring({} as Router);
    monitoring.initializeAfterMount({ config: {} } as App);

    await vi.waitFor(() => expect(posthogLifecycle.syncPostHogConsent).toHaveBeenCalledOnce());

    expect(order).toEqual(["init-start", "init-end", "sync"]);
  });
});
