import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHttpSession,
  exchangeHttpSession,
  fetchHttpSessionSummary,
  isSessionNetworkError,
  SessionNetworkError,
} from "./httpSessionService";

// captureHandledRequestFailure pulls in Sentry/cookie-consent machinery that's
// irrelevant to this service's own logic, so it's mocked at the module boundary
// per house style ("vi.mock() for heavier external deps").
vi.mock("./sentry", () => ({
  captureHandledRequestFailure: vi.fn(),
}));

import { captureHandledRequestFailure } from "./sentry";

const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  headers: { get: (key: string) => init.headers?.[key] ?? null },
  json: async () => body,
});

describe("httpSessionService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe("fetchHttpSessionSummary", () => {
    it("issues a GET request to /auth/session/me and returns the parsed summary", async () => {
      // .env ships a real VITE_EDGE_PROXY_URL for local dev; force the no-proxy
      // branch explicitly so this test isn't coupled to that ambient value.
      vi.stubEnv("VITE_EDGE_PROXY_URL", "");
      const summary = { authenticated: true, user: { id: "u1", email: "a@b.com", last_sign_in_at: null }, profile: null };
      vi.mocked(fetch).mockResolvedValue(jsonResponse(summary) as unknown as Response);

      const result = await fetchHttpSessionSummary();

      expect(result).toEqual(summary);
      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("/auth/session/me");
      expect(init).toMatchObject({ method: "GET", credentials: "include" });
      // GET requests should not carry the mutation marker header.
      expect((init as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
      expect((init as RequestInit).headers).not.toHaveProperty("x-itx-session-request");
    });

    it("routes through the configured edge proxy origin when VITE_EDGE_PROXY_URL is set", async () => {
      vi.stubEnv("VITE_EDGE_PROXY_URL", "https://proxy.example.com/some/path");
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ authenticated: false, user: null, profile: null }) as unknown as Response);

      await fetchHttpSessionSummary();

      const [url] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("https://proxy.example.com/auth/session/me");
    });

    it("falls back to a trimmed literal origin when VITE_EDGE_PROXY_URL fails URL parsing", async () => {
      vi.stubEnv("VITE_EDGE_PROXY_URL", "not a valid url///");
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ authenticated: false, user: null, profile: null }) as unknown as Response);

      await fetchHttpSessionSummary();

      const [url] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("not a valid url/auth/session/me");
    });
  });

  describe("exchangeHttpSession", () => {
    it("issues a POST with the token payload and the mutation marker header", async () => {
      vi.stubEnv("VITE_EDGE_PROXY_URL", "");
      const summary = { authenticated: true, user: { id: "u1", email: null, last_sign_in_at: null }, profile: null };
      vi.mocked(fetch).mockResolvedValue(jsonResponse(summary) as unknown as Response);

      const result = await exchangeHttpSession({ access_token: "at", refresh_token: "rt" });

      expect(result).toEqual(summary);
      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("/auth/session/exchange");
      expect((init as RequestInit).method).toBe("POST");
      expect((init as RequestInit).body).toBe(JSON.stringify({ access_token: "at", refresh_token: "rt" }));
      expect((init as RequestInit).headers).toMatchObject({ "x-itx-session-request": "1" });
    });
  });

  describe("clearHttpSession", () => {
    it("issues a POST to /auth/session/logout", async () => {
      vi.stubEnv("VITE_EDGE_PROXY_URL", "");
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }) as unknown as Response);

      const result = await clearHttpSession();

      expect(result).toEqual({ ok: true });
      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("/auth/session/logout");
      expect((init as RequestInit).method).toBe("POST");
    });
  });

  describe("error handling", () => {
    it("throws a descriptive error and reports a handled failure when the response is not ok", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({}, { ok: false, status: 401, headers: { "x-request-id": "req-123" } }) as unknown as Response
      );

      await expect(fetchHttpSessionSummary()).rejects.toThrow("Session request failed (401).");

      expect(captureHandledRequestFailure).toHaveBeenCalledWith({
        area: "http_session",
        name: "me",
        path: "/auth/session/me",
        method: "GET",
        status: 401,
        message: "Session request failed (401).",
        requestId: "req-123",
      });
    });

    it("omits requestId when the response has no x-request-id header", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }) as unknown as Response);

      await expect(clearHttpSession()).rejects.toThrow("Session request failed (500).");

      expect(captureHandledRequestFailure).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: undefined, status: 500, name: "logout", method: "POST" })
      );
    });

    // A `TypeError: Failed to fetch` reaching the bootstrap logger as a generic
    // error is what made an unreachable edge proxy look like an application bug.
    it("wraps a transport-level fetch rejection in SessionNetworkError", async () => {
      const cause = new TypeError("Failed to fetch");
      vi.mocked(fetch).mockRejectedValue(cause);

      const error = await fetchHttpSessionSummary().catch((thrown: unknown) => thrown);

      expect(isSessionNetworkError(error)).toBe(true);
      expect(error).toBeInstanceOf(SessionNetworkError);
      expect((error as SessionNetworkError).action).toBe("me");
      expect((error as SessionNetworkError).cause).toBe(cause);
      expect((error as SessionNetworkError).message).toContain("Unable to reach");
    });

    it("does not report a transport failure to Sentry, since no request reached the server", async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(fetchHttpSessionSummary()).rejects.toBeInstanceOf(SessionNetworkError);

      expect(captureHandledRequestFailure).not.toHaveBeenCalled();
    });

    it("treats a refused response as a server answer rather than a transport failure", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }) as unknown as Response);

      const error = await fetchHttpSessionSummary().catch((thrown: unknown) => thrown);

      expect(isSessionNetworkError(error)).toBe(false);
    });
  });
});
