import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Router } from "vue-router";
import {
  dispatchRecoverableAppError,
  installAppErrorRecovery,
  isRecoverableChunkLoadError,
  recoverFromChunkLoadError,
  resolveRecoveryRouteFromPath,
} from "./appErrorRecovery";
import { clearAuthState, getAuthState, setAuthStateFromBackend } from "../store/authState";
import { getSessionTerminationState } from "../store/sessionTermination";

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

// jsdom's window.location.assign is non-configurable, so vi.spyOn can't
// touch it directly. Swap the whole location object out for one that keeps
// origin (needed by resolveSameOriginRecoveryTarget) but replaces assign
// with a spy, then restore the original afterward.
const originalLocation = window.location;

const stubLocationAssign = () => {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { origin: originalLocation.origin, assign },
  });
  return assign;
};

const restoreLocation = () => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
};

describe("isRecoverableChunkLoadError", () => {
  it("matches known dynamic-import failure messages", () => {
    expect(isRecoverableChunkLoadError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isRecoverableChunkLoadError(new Error("error loading dynamically imported module: x"))).toBe(true);
    expect(isRecoverableChunkLoadError(new Error("Importing a module script failed"))).toBe(true);
    expect(isRecoverableChunkLoadError(new Error("Couldn't resolve component"))).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isRecoverableChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(isRecoverableChunkLoadError("some string error")).toBe(false);
    expect(isRecoverableChunkLoadError(undefined)).toBe(false);
  });
});

describe("resolveRecoveryRouteFromPath", () => {
  it("routes internal paths to internal-auth", () => {
    expect(resolveRecoveryRouteFromPath("/internal/dashboard")).toEqual({ name: "internal-auth" });
  });

  it("routes super-admin paths to super-auth with reason", () => {
    expect(resolveRecoveryRouteFromPath("/super-admin/tenants")).toEqual({
      name: "super-auth",
      query: { reason: "session-expired" },
    });
  });

  it("routes admin paths to workspace-admin-login with reason", () => {
    expect(resolveRecoveryRouteFromPath("/admin/items")).toEqual({
      name: "workspace-admin-login",
      query: { reason: "session-expired" },
    });
  });

  it("falls back to public-login for everything else", () => {
    expect(resolveRecoveryRouteFromPath("/checkout")).toEqual({
      name: "public-login",
      query: { reason: "session-expired" },
    });
  });
});

describe("recoverFromChunkLoadError", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    restoreLocation();
  });

  it("stores the reload target and navigates on first attempt", () => {
    const assignSpy = stubLocationAssign();
    const result = recoverFromChunkLoadError("/items/123");
    expect(result).toBe(true);
    expect(window.sessionStorage.getItem("itemtraxx:chunk-reload-path")).toBe("/items/123");
    expect(assignSpy).toHaveBeenCalledWith("/items/123");
  });

  it("refuses to loop when the same target was already retried", () => {
    window.sessionStorage.setItem("itemtraxx:chunk-reload-path", "/items/123");
    const assignSpy = stubLocationAssign();
    const result = recoverFromChunkLoadError("/items/123");
    expect(result).toBe(false);
    expect(window.sessionStorage.getItem("itemtraxx:chunk-reload-path")).toBeNull();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("rejects protocol-relative paths that would escape same-origin", () => {
    const assignSpy = stubLocationAssign();
    const result = recoverFromChunkLoadError("//evil.example.com/phish");
    expect(result).toBe(false);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("defaults to root for an empty path", () => {
    const assignSpy = stubLocationAssign();
    const result = recoverFromChunkLoadError("");
    expect(result).toBe(true);
    expect(assignSpy).toHaveBeenCalledWith("/");
  });
});

describe("dispatchRecoverableAppError", () => {
  it("dispatches the recoverable-app-error custom event with the given detail", async () => {
    const listener = vi.fn();
    window.addEventListener("itemtraxx:recoverable-app-error", listener as EventListener);
    dispatchRecoverableAppError({ code: "UNAUTHORIZED", message: "session expired" });
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({ code: "UNAUTHORIZED", message: "session expired" });
    window.removeEventListener("itemtraxx:recoverable-app-error", listener as EventListener);
  });
});

const buildRouterStub = (initialPath: string) => {
  let errorHandler: ((error: unknown, to: { fullPath: string }) => void) | null = null;
  let afterEachHandler: ((to: { fullPath: string }) => void) | null = null;
  const router = {
    currentRoute: { value: { path: initialPath, fullPath: initialPath } },
    onError: vi.fn((handler: (error: unknown, to: { fullPath: string }) => void) => {
      errorHandler = handler;
    }),
    afterEach: vi.fn((handler: (to: { fullPath: string }) => void) => {
      afterEachHandler = handler;
    }),
  };
  return {
    router: router as unknown as Router,
    triggerError: (error: unknown, to = { fullPath: initialPath }) => errorHandler?.(error, to),
    triggerAfterEach: (to = { fullPath: initialPath }) => afterEachHandler?.(to),
  };
};

// installAppErrorRecovery guards against double-installation with a
// module-level singleton flag (recoveryInstalled), so it can only be
// meaningfully called once per test run — exercise every behavior it wires
// up in a single sequential test rather than one install call per `it`.
describe("installAppErrorRecovery", () => {
  afterEach(() => {
    clearAuthState();
    window.sessionStorage.clear();
    restoreLocation();
  });

  it("wires up UNAUTHORIZED recovery, ignores other codes, recovers chunk-load errors, and clears the reload marker on navigation", async () => {
    const { router, triggerError, triggerAfterEach } = buildRouterStub("/admin/items");
    const assignSpy = stubLocationAssign();
    setAuthStateFromBackend({ isAuthenticated: true, userId: "user-1" });

    installAppErrorRecovery(router);

    // Unrelated error codes are ignored.
    dispatchRecoverableAppError({ code: "RATE_LIMITED", message: "slow down" });
    await flushMicrotasks();
    expect(getAuthState().isAuthenticated).toBe(true);

    // UNAUTHORIZED clears auth state and shows the session-termination modal
    // with a route derived from the current path.
    dispatchRecoverableAppError({ code: "UNAUTHORIZED", message: "expired" });
    await flushMicrotasks();
    expect(getAuthState().isAuthenticated).toBe(false);
    const termination = getSessionTerminationState();
    expect(termination.visible).toBe(true);
    expect(termination.recoveryRoute).toEqual({
      name: "workspace-admin-login",
      query: { reason: "session-expired" },
    });

    // router.onError recovers from a chunk-load failure by navigating.
    triggerError(new Error("Failed to fetch dynamically imported module"), { fullPath: "/items/42" });
    expect(assignSpy).toHaveBeenCalledWith("/items/42");

    // router.afterEach clears the pending reload marker once navigation lands.
    triggerAfterEach({ fullPath: "/items/42" });
    expect(window.sessionStorage.getItem("itemtraxx:chunk-reload-path")).toBeNull();
  });
});
