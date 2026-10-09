import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./cookieConsentService", () => ({
  allowsAnalytics: vi.fn(),
  readCookieConsent: vi.fn(),
}));
vi.mock("@vercel/analytics", () => ({
  track: vi.fn(),
}));

import { allowsAnalytics } from "./cookieConsentService";
import { track } from "@vercel/analytics";
import { sanitizeVercelAnalyticsEvent, trackAnalyticsEvent } from "./analyticsService";

const mockedAllows = vi.mocked(allowsAnalytics);
const mockedTrack = vi.mocked(track);

afterEach(() => {
  vi.clearAllMocks();
});

describe("trackAnalyticsEvent", () => {
  it("does not load or call @vercel/analytics when analytics consent is not granted", async () => {
    mockedAllows.mockReturnValue(false);

    await trackAnalyticsEvent("item_checked_out", { itemId: "1" });

    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it("forwards the event name and properties to @vercel/analytics when consent is granted", async () => {
    mockedAllows.mockReturnValue(true);

    await trackAnalyticsEvent("item_checked_out", { itemId: "1", quantity: 2 });

    expect(mockedTrack).toHaveBeenCalledWith("item_checked_out", { itemId: "1", quantity: 2 });
  });

  it("works with no properties provided", async () => {
    mockedAllows.mockReturnValue(true);

    await trackAnalyticsEvent("page_view");

    expect(mockedTrack).toHaveBeenCalledWith("page_view", undefined);
  });
});

describe("sanitizeVercelAnalyticsEvent", () => {
  it("removes SSO proof values while preserving ordinary navigation state", () => {
    expect(sanitizeVercelAnalyticsEvent({
      type: "pageview",
      url: "https://www.itemtraxx.com/admin?tab=users&itx_sso_proof=signed-proof",
    })).toEqual({
      type: "pageview",
      url: "https://www.itemtraxx.com/admin?tab=users",
    });
  });
});
