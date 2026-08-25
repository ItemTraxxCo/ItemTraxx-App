import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/authState", () => ({
  clearAuthState: vi.fn(),
}));

vi.mock("./httpSessionService", async () => {
  const actual = await vi.importActual<typeof import("./httpSessionService")>("./httpSessionService");
  return {
    fetchHttpSessionSummary: vi.fn(),
    isSessionNetworkError: actual.isSessionNetworkError,
    SessionNetworkError: actual.SessionNetworkError,
  };
});

vi.mock("./authService", () => ({
  applyHttpSessionSummary: vi.fn(),
  initAuthListener: vi.fn(),
}));

import {
  hasLegacyAuthFragment,
  refreshPublicAuthFromSession,
  scrubLegacyAuthFragment,
} from "./publicAuthBootstrap";
import { clearAuthState } from "../store/authState";
import { fetchHttpSessionSummary, SessionNetworkError } from "./httpSessionService";
import { applyHttpSessionSummary, initAuthListener } from "./authService";

const authenticatedSummary = {
  authenticated: true,
  user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
  profile: null,
};

describe("hasLegacyAuthFragment", () => {
  it("detects each known legacy key in a given hash", () => {
    expect(hasLegacyAuthFragment("#itx_at=abc")).toBe(true);
    expect(hasLegacyAuthFragment("#itx_rt=abc")).toBe(true);
    expect(hasLegacyAuthFragment("#itx_hc=abc")).toBe(true);
    expect(hasLegacyAuthFragment("#itx_th=abc")).toBe(true);
  });

  it("returns false when no legacy keys are present", () => {
    expect(hasLegacyAuthFragment("#other=1")).toBe(false);
    expect(hasLegacyAuthFragment("")).toBe(false);
  });

  it("defaults to reading window.location.hash", () => {
    window.location.hash = "#itx_at=xyz";
    expect(hasLegacyAuthFragment()).toBe(true);
    window.location.hash = "";
  });
});

describe("scrubLegacyAuthFragment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("does nothing when there is no legacy fragment", () => {
    window.location.hash = "#other=1";
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    scrubLegacyAuthFragment();

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("strips legacy keys but keeps unrelated hash params", () => {
    window.location.hash = "#itx_at=abc&itx_rt=def&keep=1";
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    scrubLegacyAuthFragment();

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    const [, , url] = replaceStateSpy.mock.calls[0];
    expect(url).toContain("keep=1");
    expect(url).not.toContain("itx_at");
    expect(url).not.toContain("itx_rt");
  });

  it("omits the hash entirely when nothing remains after stripping", () => {
    window.location.hash = "#itx_at=abc";
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    scrubLegacyAuthFragment();

    const [, , url] = replaceStateSpy.mock.calls[0];
    expect(String(url).includes("#")).toBe(false);
  });
});

describe("refreshPublicAuthFromSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears auth state when the session summary is not authenticated", async () => {
    vi.mocked(fetchHttpSessionSummary).mockResolvedValueOnce({
      authenticated: false,
      user: null,
      profile: null,
    });

    await refreshPublicAuthFromSession();

    expect(clearAuthState).toHaveBeenCalledWith(true);
    expect(applyHttpSessionSummary).not.toHaveBeenCalled();
    expect(initAuthListener).not.toHaveBeenCalled();
  });

  it("clears auth state when authenticated is true but the user is missing", async () => {
    vi.mocked(fetchHttpSessionSummary).mockResolvedValueOnce({
      authenticated: true,
      user: null,
      profile: null,
    });

    await refreshPublicAuthFromSession();

    expect(clearAuthState).toHaveBeenCalledWith(true);
    expect(applyHttpSessionSummary).not.toHaveBeenCalled();
  });

  it("applies the session and starts the auth listener when authenticated with a user", async () => {
    vi.mocked(fetchHttpSessionSummary).mockResolvedValueOnce(authenticatedSummary);

    await refreshPublicAuthFromSession();

    expect(clearAuthState).not.toHaveBeenCalled();
    expect(applyHttpSessionSummary).toHaveBeenCalledWith(authenticatedSummary);
    expect(initAuthListener).toHaveBeenCalledTimes(1);
  });

  describe("transient transport failures", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // The retry delay only advances under fake timers, so drive the clock before
    // handing the promise back. The rejection is asserted by each caller; this
    // no-op handler just keeps it from surfacing as an unhandled rejection while
    // the timers run.
    const runWithTimers = (promise: Promise<unknown>) => {
      promise.catch(() => undefined);
      return vi.runAllTimersAsync().then(() => promise);
    };

    // The failure mode this guards: one blip on the session probe used to leave
    // an already signed-in admin looking anonymous on /admin/login, forcing them
    // to re-enter credentials they did not actually need.
    it("retries once and recognises the existing session when the first probe cannot reach the server", async () => {
      vi.mocked(fetchHttpSessionSummary)
        .mockRejectedValueOnce(new SessionNetworkError("me", new TypeError("Failed to fetch")))
        .mockResolvedValueOnce(authenticatedSummary);

      await runWithTimers(refreshPublicAuthFromSession());

      expect(fetchHttpSessionSummary).toHaveBeenCalledTimes(2);
      expect(applyHttpSessionSummary).toHaveBeenCalledWith(authenticatedSummary);
      expect(clearAuthState).not.toHaveBeenCalled();
    });

    it("gives up after a single retry when the server stays unreachable", async () => {
      vi.mocked(fetchHttpSessionSummary).mockRejectedValue(new SessionNetworkError("me"));

      await expect(runWithTimers(refreshPublicAuthFromSession())).rejects.toBeInstanceOf(
        SessionNetworkError,
      );

      expect(fetchHttpSessionSummary).toHaveBeenCalledTimes(2);
      expect(applyHttpSessionSummary).not.toHaveBeenCalled();
    });

    it("does not retry when the server answered and refused", async () => {
      vi.mocked(fetchHttpSessionSummary).mockRejectedValue(new Error("Session request failed (401)."));

      await expect(runWithTimers(refreshPublicAuthFromSession())).rejects.toThrow(
        "Session request failed (401).",
      );

      expect(fetchHttpSessionSummary).toHaveBeenCalledTimes(1);
    });
  });
});
