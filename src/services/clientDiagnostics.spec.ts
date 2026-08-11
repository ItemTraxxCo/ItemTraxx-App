import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./cookieConsentService", () => ({
  allowsDiagnostics: vi.fn(),
  readCookieConsent: vi.fn(),
}));

import { allowsDiagnostics } from "./cookieConsentService";
import { getClientDiagnosticsSnapshot, installClientDiagnostics } from "./clientDiagnostics";

const mockedAllows = vi.mocked(allowsDiagnostics);

// installClientDiagnostics is idempotent (module-level `installed` flag), so the
// global fetch must be stubbed *before* the single install() call in this file —
// once installed, the wrapper has already captured whichever fetch was global at
// that moment as its "original", and later vi.stubGlobal calls won't reach it.
const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
  mockedAllows.mockReturnValue(true);
  installClientDiagnostics();
});

describe("console capture", () => {
  it("records console.log/info/warn/error calls when diagnostics consent is granted", () => {
    mockedAllows.mockReturnValue(true);
    const before = getClientDiagnosticsSnapshot().console.length;

    console.info("hello", "world");

    const after = getClientDiagnosticsSnapshot().console;
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ level: "info", message: "hello world" });
  });

  it("redacts bearer tokens and emails from captured console messages", () => {
    mockedAllows.mockReturnValue(true);

    console.error(`Authorization: Bearer secret.jwt.token for user test@example.com`);

    const entries = getClientDiagnosticsSnapshot().console;
    const last = entries[entries.length - 1]!;
    expect(last.message).not.toContain("test@example.com");
    expect(last.message).toContain("[REDACTED_EMAIL]");
    expect(last.message).toContain("Bearer [REDACTED]");
  });

  it("does not record console entries when diagnostics consent is not granted", () => {
    mockedAllows.mockReturnValue(false);
    const before = getClientDiagnosticsSnapshot().console.length;

    console.warn("should not be captured");

    expect(getClientDiagnosticsSnapshot().console.length).toBe(before);
  });
});

describe("network capture", () => {
  it("records a successful fetch call with method/url/status/duration", async () => {
    mockedAllows.mockReturnValue(true);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "req-abc" },
    });

    await fetch("https://api.example.com/items?token=secret", { method: "GET" });

    const entries = getClientDiagnosticsSnapshot().network;
    const last = entries[entries.length - 1]!;
    expect(last.method).toBe("GET");
    expect(last.status).toBe(200);
    expect(last.ok).toBe(true);
    expect(last.request_id).toBe("req-abc");
    // Absolute http(s) URLs are fully replaced by the redaction pass (the whole
    // origin+path match is swapped for the literal placeholder), not partially masked.
    expect(last.url).toBe("[REDACTED_URL]");
  });

  it("records a failed fetch (network error) and rethrows the original error", async () => {
    mockedAllows.mockReturnValue(true);
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(fetch("https://api.example.com/items")).rejects.toThrow("network down");

    const entries = getClientDiagnosticsSnapshot().network;
    const last = entries[entries.length - 1]!;
    expect(last.ok).toBe(false);
    expect(last.status).toBeNull();
    expect(last.error).toBe("network down");
  });

  it("skips client-error-report requests to avoid capturing the diagnostics upload itself", async () => {
    mockedAllows.mockReturnValue(true);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } });
    const before = getClientDiagnosticsSnapshot().network.length;

    await fetch("https://api.example.com/functions/v1/client-error-report");

    expect(getClientDiagnosticsSnapshot().network.length).toBe(before);
  });

  it("does not record network entries when diagnostics consent is not granted", async () => {
    mockedAllows.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } });
    const before = getClientDiagnosticsSnapshot().network.length;

    await fetch("https://api.example.com/other");

    expect(getClientDiagnosticsSnapshot().network.length).toBe(before);
  });
});

describe("getClientDiagnosticsSnapshot", () => {
  it("returns fresh array copies so callers cannot mutate internal state", () => {
    const first = getClientDiagnosticsSnapshot();
    first.console.push({ level: "log", message: "injected", timestamp: "t" });

    const second = getClientDiagnosticsSnapshot();
    expect(second.console).not.toBe(first.console);
    expect(second.console.some((entry) => entry.message === "injected")).toBe(false);
  });
});
