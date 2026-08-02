import { afterEach, describe, expect, it, vi } from "vitest";
import { getOrCreateDeviceSession, rotateDeviceSession } from "./deviceSession";

const DEVICE_ID_KEY = "itemtraxx-device-id";
const DEVICE_LABEL_KEY = "itemtraxx-device-label";

const stubUserAgent = (userAgent: string) => {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
};

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("getOrCreateDeviceSession", () => {
  it("creates and persists a device id and label on first use", () => {
    stubUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBeNull();

    const session = getOrCreateDeviceSession();

    expect(session.deviceId).toBeTruthy();
    expect(session.deviceLabel).toBe("Mac");
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBe(session.deviceId);
    expect(window.localStorage.getItem(DEVICE_LABEL_KEY)).toBe("Mac");
  });

  it("round-trips: returns the same id/label on a subsequent call without regenerating", () => {
    stubUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const first = getOrCreateDeviceSession();
    const second = getOrCreateDeviceSession();
    expect(second).toEqual(first);
  });

  it("only fills in whichever of id/label is missing, leaving the other untouched", () => {
    window.localStorage.setItem(DEVICE_ID_KEY, "existing-id");
    stubUserAgent("Mozilla/5.0 (Linux; Android 13)");

    const session = getOrCreateDeviceSession();

    expect(session.deviceId).toBe("existing-id");
    expect(session.deviceLabel).toBe("Android");
  });

  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "iPhone"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "iPad"],
    ["Mozilla/5.0 (Linux; Android 13; Pixel 7)", "Android"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Windows PC"],
    ["Mozilla/5.0 (X11; Linux x86_64)", "Linux"],
    ["SomeUnrecognizedBotAgent/1.0", "Unknown device"],
  ])("labels user agent %s as %s", (ua, expectedLabel) => {
    stubUserAgent(ua);
    const session = getOrCreateDeviceSession();
    expect(session.deviceLabel).toBe(expectedLabel);
  });

  it("falls back to 'Unknown device' when navigator.userAgent is empty", () => {
    stubUserAgent("");
    const session = getOrCreateDeviceSession();
    expect(session.deviceLabel).toBe("Unknown device");
  });

  it("uses crypto.getRandomValues as a fallback when randomUUID is unavailable", () => {
    stubUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });

    const session = getOrCreateDeviceSession();
    expect(session.deviceId).toMatch(/^itx-[0-9a-f]{32}$/);
  });

  it("throws when no secure random source is available at all", () => {
    stubUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    vi.stubGlobal("crypto", {});

    expect(() => getOrCreateDeviceSession()).toThrow(
      "Secure random device identifiers are unavailable."
    );
  });
});

describe("rotateDeviceSession", () => {
  it("always generates a new id and label, overwriting whatever was persisted", () => {
    stubUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const original = getOrCreateDeviceSession();

    const rotated = rotateDeviceSession();

    expect(rotated.deviceId).not.toBe(original.deviceId);
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBe(rotated.deviceId);
    expect(window.localStorage.getItem(DEVICE_LABEL_KEY)).toBe(rotated.deviceLabel);
  });
});
