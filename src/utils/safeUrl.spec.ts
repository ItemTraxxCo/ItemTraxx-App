import { afterEach, describe, expect, it } from "vitest";
import { safeExternalUrl, safeSameOriginPath } from "./safeUrl";

// jsdom's window.location.assign etc. are non-configurable, but the whole
// property can be swapped out wholesale (same pattern as appErrorRecovery.spec.ts)
// to exercise cross-origin vs same-origin branches deterministically.
const originalLocation = window.location;

const stubOrigin = (origin: string) => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { origin },
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
});

describe("safeExternalUrl", () => {
  it("returns an empty string for null, undefined, empty, or whitespace-only input", () => {
    expect(safeExternalUrl(null)).toBe("");
    expect(safeExternalUrl(undefined)).toBe("");
    expect(safeExternalUrl("")).toBe("");
    expect(safeExternalUrl("   ")).toBe("");
  });

  it("blocks javascript: URIs", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBe("");
  });

  it("blocks data: URIs", () => {
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("blocks other non-http(s) schemes such as file: and vbscript:", () => {
    expect(safeExternalUrl("file:///etc/passwd")).toBe("");
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBe("");
  });

  it("returns an empty string for unparseable input", () => {
    // A bare "//" with no host is not a valid absolute URL and has no
    // current-origin base path to resolve against once combined with an
    // origin base; feed it something the WHATWG URL parser rejects outright.
    expect(safeExternalUrl("http://")).toBe("");
  });

  it("collapses a same-origin absolute URL down to a relative path", () => {
    stubOrigin("https://app.itemtraxx.com");
    expect(safeExternalUrl("https://app.itemtraxx.com/items/42?x=1#top")).toBe("/items/42?x=1#top");
  });

  it("resolves a relative path against the current origin and strips it back down", () => {
    stubOrigin("https://app.itemtraxx.com");
    expect(safeExternalUrl("/items/42")).toBe("/items/42");
  });

  it("returns the full absolute URL for a different, allowed-protocol origin", () => {
    stubOrigin("https://app.itemtraxx.com");
    expect(safeExternalUrl("https://partner.example.com/redeem")).toBe("https://partner.example.com/redeem");
  });

  it("treats protocol-relative URLs as pointing at their embedded host, not the current origin", () => {
    stubOrigin("https://app.itemtraxx.com");
    expect(safeExternalUrl("//evil.example.com/phish")).toBe("https://evil.example.com/phish");
  });

  it("allows plain http as well as https", () => {
    stubOrigin("https://app.itemtraxx.com");
    expect(safeExternalUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("falls back to the http://localhost base outside a browser context (SSR)", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error -- deliberately simulating an SSR/non-browser environment
    delete globalThis.window;
    try {
      expect(safeExternalUrl("https://partner.example.com/redeem")).toBe("https://partner.example.com/redeem");
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

describe("safeSameOriginPath", () => {
  it("returns an empty string for null, undefined, empty, or whitespace-only input", () => {
    expect(safeSameOriginPath(null)).toBe("");
    expect(safeSameOriginPath(undefined)).toBe("");
    expect(safeSameOriginPath("")).toBe("");
    expect(safeSameOriginPath("   ")).toBe("");
  });

  it("rejects anything that does not start with a slash", () => {
    expect(safeSameOriginPath("https://evil.example.com/phish")).toBe("");
    expect(safeSameOriginPath("evil.example.com")).toBe("");
    expect(safeSameOriginPath("javascript:alert(1)")).toBe("");
  });

  it("rejects protocol-relative paths that resolve to a different origin", () => {
    stubOrigin("https://app.itemtraxx.com");
    // "//evil.example.com" starts with "/" but the WHATWG URL parser treats
    // the second slash as the start of an authority section pointing off-origin.
    expect(safeSameOriginPath("//evil.example.com/phish")).toBe("");
  });

  it("accepts a plain same-origin path and preserves query/hash", () => {
    stubOrigin("https://app.itemtraxx.com");
    expect(safeSameOriginPath("/items/42?x=1#top")).toBe("/items/42?x=1#top");
  });

  it("accepts a bare root path", () => {
    stubOrigin("https://app.itemtraxx.com");
    expect(safeSameOriginPath("/")).toBe("/");
  });

  it("returns an empty string instead of throwing when the URL constructor rejects the input", () => {
    // An unparseable base origin makes `new URL(path, origin)` throw regardless
    // of how well-formed the path itself is, exercising the catch branch.
    stubOrigin("not-a-valid-origin");
    expect(safeSameOriginPath("/foo")).toBe("");
  });
});
