import { effectScope, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeIntercom: vi.fn().mockResolvedValue(undefined),
  openIntercomMessenger: vi.fn().mockResolvedValue(true),
  shutdownIntercom: vi.fn(),
}));

vi.mock("../services/intercomService", () => ({
  initializeIntercom: mocks.initializeIntercom,
  openIntercomMessenger: mocks.openIntercomMessenger,
  shutdownIntercom: mocks.shutdownIntercom,
}));

import { useIntercom } from "./useIntercom";

type AuthState = Parameters<typeof useIntercom>[0];

const makeAuth = (overrides: Partial<AuthState> = {}) =>
  reactive<AuthState>({
    isInitialized: true,
    isAuthenticated: false,
    userId: null,
    email: null,
    ...overrides,
  });

const mount = (auth: AuthState) => {
  const scope = effectScope();
  const result = scope.run(() => useIntercom(auth))!;
  return { scope, ...result };
};

// Dynamic imports settle on a real macrotask, so wait on setImmediate (not
// faked) rather than microtasks alone.
const flush = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe("useIntercom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // jsdom has no requestIdleCallback, so the setTimeout fallback is used.
    delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
  });
  afterEach(() => vi.useRealTimers());

  it("boots anonymous visitors lazily, app-id only, after the page is idle", async () => {
    const { scope } = mount(makeAuth());
    await flush();
    expect(mocks.initializeIntercom).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1600);
    await flush();

    expect(mocks.initializeIntercom).toHaveBeenCalledTimes(1);
    expect(mocks.initializeIntercom).toHaveBeenCalledWith(null);
    scope.stop();
  });

  it("does not boot while auth is still loading", async () => {
    const { scope } = mount(makeAuth({ isInitialized: false }));
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(mocks.initializeIntercom).not.toHaveBeenCalled();
    scope.stop();
  });

  it("boots signed-in sessions immediately with their identity", async () => {
    const { scope } = mount(makeAuth({ isAuthenticated: true, userId: "u1", email: "a@b.co" }));
    await flush();

    expect(mocks.initializeIntercom).toHaveBeenCalledWith({ userId: "u1", email: "a@b.co" });
    scope.stop();
  });

  it("cancels the pending anonymous boot when the user turns out to be signed in", async () => {
    const auth = makeAuth();
    const { scope } = mount(auth);

    auth.isAuthenticated = true;
    auth.userId = "u1";
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(mocks.initializeIntercom).toHaveBeenCalledTimes(1);
    expect(mocks.initializeIntercom).toHaveBeenCalledWith({ userId: "u1", email: null });
    scope.stop();
  });

  it("opens the Messenger when a support control dispatches the open event", async () => {
    const { scope } = mount(makeAuth());
    await flush();

    window.dispatchEvent(new CustomEvent("itemtraxx:open-support"));
    await flush();

    expect(mocks.openIntercomMessenger).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("shuts the Messenger down and re-boots anonymously after sign-out", async () => {
    const auth = makeAuth({ isAuthenticated: true, userId: "u1" });
    const { scope } = mount(auth);
    await flush();
    mocks.shutdownIntercom.mockClear();
    mocks.initializeIntercom.mockClear();

    auth.isAuthenticated = false;
    auth.userId = null;
    await flush();
    expect(mocks.shutdownIntercom).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    expect(mocks.initializeIntercom).toHaveBeenCalledWith(null);
    scope.stop();
  });
});
