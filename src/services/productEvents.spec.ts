import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./analyticsService", () => ({
  trackAnalyticsEvent: vi.fn(),
}));
vi.mock("./posthogService", () => ({
  capturePostHogEvent: vi.fn(),
}));

import { trackAnalyticsEvent } from "./analyticsService";
import { capturePostHogEvent } from "./posthogService";
import { trackProductEvent } from "./productEvents";

const mockedAnalytics = vi.mocked(trackAnalyticsEvent);
const mockedPostHog = vi.mocked(capturePostHogEvent);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.clearAllMocks();
});

describe("trackProductEvent", () => {
  it("dispatches to analyticsService when an analytics delivery is provided", async () => {
    trackProductEvent({ analytics: { name: "item_checked_out", properties: { itemId: "1" } } });
    await flush();

    expect(mockedAnalytics).toHaveBeenCalledWith("item_checked_out", { itemId: "1" });
    expect(mockedPostHog).not.toHaveBeenCalled();
  });

  it("dispatches to posthogService when a posthog delivery is provided", async () => {
    trackProductEvent({ posthog: { name: "item_checked_out", properties: { itemId: "1" } } });
    await flush();

    expect(mockedPostHog).toHaveBeenCalledWith("item_checked_out", { itemId: "1" });
    expect(mockedAnalytics).not.toHaveBeenCalled();
  });

  it("dispatches to both when both deliveries are provided", async () => {
    trackProductEvent({
      analytics: { name: "evt", properties: { a: 1 } },
      posthog: { name: "evt", properties: { b: 2 } },
    });
    await flush();

    expect(mockedAnalytics).toHaveBeenCalledWith("evt", { a: 1 });
    expect(mockedPostHog).toHaveBeenCalledWith("evt", { b: 2 });
  });

  it("does nothing when no deliveries are provided", async () => {
    trackProductEvent({});
    await flush();

    expect(mockedAnalytics).not.toHaveBeenCalled();
    expect(mockedPostHog).not.toHaveBeenCalled();
  });

  it("swallows a rejection from the analytics dynamic import/track call", async () => {
    mockedAnalytics.mockRejectedValue(new Error("boom"));

    expect(() =>
      trackProductEvent({ analytics: { name: "evt" } })
    ).not.toThrow();
    await flush();
  });
});
