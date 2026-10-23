import { describe, expect, it } from "vitest";
import {
  maskSessionReplayAttribute,
  sanitizeReplayPerformanceEvent,
  scrubSensitiveReplayUrlValue,
} from "./sessionReplayPrivacy";

describe("session replay URL privacy", () => {
  it("masks href values on marked elements", () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("data-session-replay-mask", "");
    const signedUrl = "https://project.supabase.co/storage/v1/object/sign/support/file.png?token=secret";

    expect(maskSessionReplayAttribute("href", signedUrl, anchor)).toBe("*".repeat(signedUrl.length));
  });

  it("scrubs signed storage query and hash material while preserving the object path", () => {
    const signedUrl = "https://project.supabase.co/storage/v1/object/sign/support/file.png?X-Amz-Signature=secret&download=1#fragment";

    expect(scrubSensitiveReplayUrlValue(signedUrl)).toBe(
      "https://project.supabase.co/storage/v1/object/sign/support/file.png",
    );
  });

  it("keeps ordinary URL query strings unchanged", () => {
    const ordinaryUrl = "https://www.itemtraxx.com/workspace?tab=items";

    expect(scrubSensitiveReplayUrlValue(ordinaryUrl)).toBe(ordinaryUrl);
  });

  it("removes SSO proof and credential parameters from URL metadata", () => {
    expect(scrubSensitiveReplayUrlValue(
      "https://www.itemtraxx.com/admin?tab=users&itx_sso_proof=signed-proof#access_token=secret",
    )).toBe("https://www.itemtraxx.com/admin?tab=users");
  });

  it("scrubs signed URLs from replay performance-span descriptions", () => {
    const event = {
      type: 5,
      timestamp: 1,
      data: {
        tag: "performanceSpan",
        payload: {
          op: "resource.img",
          description: "https://project.supabase.co/storage/v1/object/sign/support/file.png?token=secret",
          startTimestamp: 1,
          endTimestamp: 2,
        },
      },
    };

    expect(sanitizeReplayPerformanceEvent(event)).toMatchObject({
      data: {
        payload: {
          description: "https://project.supabase.co/storage/v1/object/sign/support/file.png",
        },
      },
    });
  });

  it("leaves non-URL replay custom events unchanged", () => {
    const event = { type: 5, timestamp: 1, data: { tag: "breadcrumb", payload: { message: "ok" } } };

    expect(sanitizeReplayPerformanceEvent(event)).toBe(event);
  });
});
