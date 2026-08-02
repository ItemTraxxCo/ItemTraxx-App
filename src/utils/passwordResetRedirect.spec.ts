import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPasswordResetRedirectUrl,
  routeRecoveryLinksToResetPassword,
} from "./passwordResetRedirect";

// jsdom's window.location properties are non-configurable individually, so the
// whole object is swapped out (same pattern used in appErrorRecovery.spec.ts
// and safeUrl.spec.ts) to control hostname/pathname/search/hash per test.
const originalLocation = window.location;

const stubLocation = (overrides: {
  hostname?: string;
  origin?: string;
  pathname?: string;
  search?: string;
  hash?: string;
}) => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      hostname: "app.itemtraxx.com",
      origin: "https://app.itemtraxx.com",
      pathname: "/",
      search: "",
      hash: "",
      ...overrides,
    },
  });
};

const restoreLocation = () => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
};

afterEach(() => {
  restoreLocation();
  vi.restoreAllMocks();
});

describe("getPasswordResetRedirectUrl", () => {
  it("returns the fixed production URL for the apex production host", () => {
    stubLocation({ hostname: "itemtraxx.com" });
    expect(getPasswordResetRedirectUrl()).toBe("https://www.itemtraxx.com/reset-password");
  });

  it("returns the fixed production URL for the www production host", () => {
    stubLocation({ hostname: "www.itemtraxx.com" });
    expect(getPasswordResetRedirectUrl()).toBe("https://www.itemtraxx.com/reset-password");
  });

  it("matches the production host case-insensitively", () => {
    stubLocation({ hostname: "ITEMTRAXX.COM" });
    expect(getPasswordResetRedirectUrl()).toBe("https://www.itemtraxx.com/reset-password");
  });

  it("builds a redirect URL from the current origin for a non-production host", () => {
    stubLocation({ hostname: "staging.itemtraxx.com", origin: "https://staging.itemtraxx.com" });
    expect(getPasswordResetRedirectUrl()).toBe("https://staging.itemtraxx.com/reset-password");
  });

  it("builds a redirect URL from the current origin for localhost", () => {
    stubLocation({ hostname: "localhost", origin: "http://localhost:5173" });
    expect(getPasswordResetRedirectUrl()).toBe("http://localhost:5173/reset-password");
  });

  it("returns the fixed production URL outside a browser context (SSR)", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error -- deliberately simulating an SSR/non-browser environment
    delete globalThis.window;
    try {
      expect(getPasswordResetRedirectUrl()).toBe("https://www.itemtraxx.com/reset-password");
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

describe("routeRecoveryLinksToResetPassword", () => {
  it("does nothing when already on the reset-password path", () => {
    stubLocation({ pathname: "/reset-password", search: "?type=recovery" });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    routeRecoveryLinksToResetPassword();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("does nothing when there is no recovery marker in query or hash", () => {
    stubLocation({ pathname: "/login", search: "?foo=bar", hash: "" });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    routeRecoveryLinksToResetPassword();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("redirects to /reset-password when the query string carries a recovery type", () => {
    stubLocation({ pathname: "/login", search: "?type=recovery&token=abc", hash: "" });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    routeRecoveryLinksToResetPassword();
    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      document.title,
      "/reset-password?type=recovery&token=abc"
    );
  });

  it("redirects to /reset-password when the hash fragment carries a recovery type", () => {
    stubLocation({ pathname: "/login", search: "", hash: "#type=recovery&access_token=xyz" });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    routeRecoveryLinksToResetPassword();
    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      document.title,
      "/reset-password#type=recovery&access_token=xyz"
    );
  });

  it("ignores an unrelated hash fragment that isn't URL-search-param shaped", () => {
    stubLocation({ pathname: "/login", search: "", hash: "#some-anchor" });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    routeRecoveryLinksToResetPassword();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("is a no-op outside a browser context", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error -- deliberately simulating an SSR/non-browser environment
    delete globalThis.window;
    expect(() => routeRecoveryLinksToResetPassword()).not.toThrow();
    globalThis.window = originalWindow;
  });
});
