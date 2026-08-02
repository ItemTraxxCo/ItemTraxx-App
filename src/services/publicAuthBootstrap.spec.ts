import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/authState", () => ({
  clearAuthState: vi.fn(),
}));

vi.mock("./httpSessionService", () => ({
  fetchHttpSessionSummary: vi.fn(),
}));

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
import { fetchHttpSessionSummary } from "./httpSessionService";
import { applyHttpSessionSummary, initAuthListener } from "./authService";

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
    const summary = {
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: null,
    };
    vi.mocked(fetchHttpSessionSummary).mockResolvedValueOnce(summary);

    await refreshPublicAuthFromSession();

    expect(clearAuthState).not.toHaveBeenCalled();
    expect(applyHttpSessionSummary).toHaveBeenCalledWith(summary);
    expect(initAuthListener).toHaveBeenCalledTimes(1);
  });
});
