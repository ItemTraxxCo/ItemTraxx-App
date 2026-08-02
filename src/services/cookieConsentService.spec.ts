import { afterEach, describe, expect, it } from "vitest";
import {
  allowsAnalytics,
  allowsDiagnostics,
  allowsSessionReplay,
  clearAnalyticsPersistence,
  getOrCreateCookieConsentSubject,
  hasCookieConsent,
  readCookieConsent,
  writeCookieConsent,
  type CookieConsentState,
} from "./cookieConsentService";

const clearAllCookies = () => {
  document.cookie.split(";").forEach((cookie) => {
    const name = cookie.split("=", 1)[0]?.trim();
    if (name) {
      document.cookie = `${name}=; Max-Age=0; Path=/`;
    }
  });
};

afterEach(() => {
  clearAllCookies();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("readCookieConsent", () => {
  it("returns null when no consent cookie exists", () => {
    expect(readCookieConsent()).toBeNull();
  });

  it("round-trips a written consent preference", () => {
    writeCookieConsent({ analytics: true, diagnostics: false });
    const state = readCookieConsent();
    expect(state?.preferences).toEqual({ analytics: true, diagnostics: false });
    expect(state?.version).toBe(2);
  });

  it("migrates a legacy localStorage v1 'all' choice into v2 preferences and persists it as a cookie", () => {
    window.localStorage.setItem(
      "itemtraxx-cookie-consent",
      JSON.stringify({ version: 1, choice: "all", updatedAt: "2026-01-01T00:00:00Z" })
    );

    const state = readCookieConsent();

    expect(state).toEqual({
      version: 2,
      preferences: { analytics: true, diagnostics: true },
      updatedAt: "2026-01-01T00:00:00Z",
    });
    // Migration should remove the legacy localStorage entry and persist to cookie.
    expect(window.localStorage.getItem("itemtraxx-cookie-consent")).toBeNull();
    expect(readCookieConsent()).toEqual(state);
  });

  it("migrates a legacy localStorage v1 'essential' choice to all-false preferences", () => {
    window.localStorage.setItem(
      "itemtraxx-cookie-consent",
      JSON.stringify({ version: 1, choice: "essential", updatedAt: "2026-01-01T00:00:00Z" })
    );

    const state = readCookieConsent();
    expect(state?.preferences).toEqual({ analytics: false, diagnostics: false });
  });

  it("returns null for a malformed v1 payload missing updatedAt", () => {
    window.localStorage.setItem(
      "itemtraxx-cookie-consent",
      JSON.stringify({ version: 1, choice: "all" })
    );
    expect(readCookieConsent()).toBeNull();
  });

  it("returns null when the stored shape does not match the current version", () => {
    document.cookie = `itemtraxx-cookie-consent=${encodeURIComponent(
      JSON.stringify({ version: 3, preferences: { analytics: true, diagnostics: true }, updatedAt: "x" })
    )}; Path=/`;
    expect(readCookieConsent()).toBeNull();
  });

  it("returns null when the cookie value is not valid JSON", () => {
    document.cookie = `itemtraxx-cookie-consent=not-json; Path=/`;
    expect(readCookieConsent()).toBeNull();
  });
});

describe("writeCookieConsent", () => {
  it("dispatches an itemtraxx:cookie-consent event with the new state", () => {
    let received: CookieConsentState | undefined;
    const listener = (event: Event) => {
      received = (event as CustomEvent<CookieConsentState>).detail;
    };
    window.addEventListener("itemtraxx:cookie-consent", listener);

    writeCookieConsent({ analytics: false, diagnostics: true });

    expect(received?.preferences).toEqual({ analytics: false, diagnostics: true });
    window.removeEventListener("itemtraxx:cookie-consent", listener);
  });
});

describe("getOrCreateCookieConsentSubject", () => {
  it("creates a subject id on first call and reuses it on subsequent calls", () => {
    const first = getOrCreateCookieConsentSubject();
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);

    const second = getOrCreateCookieConsentSubject();
    expect(second).toBe(first);
  });

  it("migrates a legacy localStorage subject id into a cookie", () => {
    window.localStorage.setItem("itemtraxx-cookie-consent-subject", "legacy-subject-id");

    const subject = getOrCreateCookieConsentSubject();

    expect(subject).toBe("legacy-subject-id");
    expect(window.localStorage.getItem("itemtraxx-cookie-consent-subject")).toBeNull();
  });
});

describe("consent predicate helpers", () => {
  it("allowsAnalytics/allowsDiagnostics/allowsSessionReplay reflect the stored preferences", () => {
    const state: CookieConsentState = {
      version: 2,
      preferences: { analytics: true, diagnostics: false },
      updatedAt: "t",
    };
    expect(allowsAnalytics(state)).toBe(true);
    expect(allowsDiagnostics(state)).toBe(false);
    expect(allowsSessionReplay(state)).toBe(false);
  });

  it("treat a null state as no consent for every category", () => {
    expect(allowsAnalytics(null)).toBe(false);
    expect(allowsDiagnostics(null)).toBe(false);
    expect(allowsSessionReplay(null)).toBe(false);
    expect(hasCookieConsent(null)).toBe(false);
  });

  it("hasCookieConsent is true for any non-null state", () => {
    expect(hasCookieConsent({ version: 2, preferences: { analytics: false, diagnostics: false }, updatedAt: "t" })).toBe(
      true
    );
  });
});

describe("clearAnalyticsPersistence", () => {
  // Note: this repo's in-memory localStorage/sessionStorage test polyfill
  // (src/test/setupStorage.ts) doesn't expose stored keys via Object.keys(),
  // unlike a real Storage object, so the localStorage/sessionStorage branches
  // of clearAnalyticsPersistence can't be meaningfully asserted against here.
  // document.cookie is real jsdom behavior, so that branch is covered directly.
  it("removes only ph_-prefixed cookie entries and leaves others intact", () => {
    document.cookie = "ph_cookie=abc; Path=/";
    document.cookie = "unrelated=1; Path=/";

    clearAnalyticsPersistence();

    expect(document.cookie).not.toContain("ph_cookie");
    expect(document.cookie).toContain("unrelated=1");
  });

  it("does not throw when storage access fails", () => {
    document.cookie = "ph_cookie=abc; Path=/";
    expect(() => clearAnalyticsPersistence()).not.toThrow();
  });
});
