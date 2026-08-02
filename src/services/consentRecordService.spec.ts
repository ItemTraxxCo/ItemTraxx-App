import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("./cookieConsentService", () => ({
  getOrCreateCookieConsentSubject: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getOrCreateCookieConsentSubject } from "./cookieConsentService";
import { recordCookieConsent } from "./consentRecordService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const mockedSubject = vi.mocked(getOrCreateCookieConsentSubject);

afterEach(() => {
  vi.clearAllMocks();
});

describe("recordCookieConsent", () => {
  it("posts the subject id, preferences, and consented-at timestamp", async () => {
    mockedSubject.mockReturnValue("subject-1");
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { recorded: true } },
    });

    await recordCookieConsent({ analytics: true, diagnostics: false }, "2026-08-01T00:00:00Z");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("consent-record", {
      method: "POST",
      body: {
        subject_id: "subject-1",
        consent_version: 2,
        analytics: true,
        diagnostics: false,
        consented_at: "2026-08-01T00:00:00Z",
      },
    });
  });

  it("throws when the request is not ok", async () => {
    mockedSubject.mockReturnValue("subject-1");
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "boom", data: null });

    await expect(
      recordCookieConsent({ analytics: true, diagnostics: true }, "2026-08-01T00:00:00Z")
    ).rejects.toThrow(/unable to confirm cookie consent/i);
  });

  it("throws when the request is ok but the backend did not confirm recording", async () => {
    mockedSubject.mockReturnValue("subject-1");
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { data: { recorded: false } },
    });

    await expect(
      recordCookieConsent({ analytics: false, diagnostics: false }, "2026-08-01T00:00:00Z")
    ).rejects.toThrow(/unable to confirm cookie consent/i);
  });

  it("throws when the response has no data payload at all", async () => {
    mockedSubject.mockReturnValue("subject-1");
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: null });

    await expect(
      recordCookieConsent({ analytics: false, diagnostics: false }, "2026-08-01T00:00:00Z")
    ).rejects.toThrow(/unable to confirm cookie consent/i);
  });
});
