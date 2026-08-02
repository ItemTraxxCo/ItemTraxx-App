import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "./asyncUtils";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves with the promise's value when it settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("done"), 1000);
    expect(result).toBe("done");
  });

  it("rejects with a TimeoutError once the timeout elapses first", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const pending = withTimeout(never, 5000);

    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("uses a custom timeout message when provided", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const pending = withTimeout(never, 1000, "Custom timeout message");

    const assertion = expect(pending).rejects.toThrow("Custom timeout message");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("propagates a rejection from the wrapped promise", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });

  it("clears the timeout after the wrapped promise settles (no dangling timer)", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.resolve("fast"), 1000);
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("TimeoutError", () => {
  it("defaults to a friendly message and sets the error name", () => {
    const error = new TimeoutError();
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toMatch(/timed out/i);
  });
});
