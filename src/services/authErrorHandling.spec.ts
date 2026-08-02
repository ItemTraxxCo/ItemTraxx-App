import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router } from "vue-router";
import { handleSuperAdminUnauthorized, isUnauthorizedError } from "./authErrorHandling";
import { AppError } from "./appErrors";
import { clearAuthState, getAuthState, setAuthStateFromBackend } from "../store/authState";

describe("handleSuperAdminUnauthorized", () => {
  afterEach(() => {
    clearAuthState();
  });

  it("clears auth state (marking it initialized) and redirects to super-auth with a session-expired reason", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: "user-1", role: "super_admin" });

    const replace = vi.fn().mockResolvedValue(undefined);
    const router = { replace } as unknown as Router;

    await handleSuperAdminUnauthorized(router);

    expect(getAuthState().isAuthenticated).toBe(false);
    expect(getAuthState().isInitialized).toBe(true);
    expect(replace).toHaveBeenCalledWith({
      name: "super-auth",
      query: { reason: "session-expired" },
    });
  });

  it("propagates a rejected router.replace instead of swallowing it", async () => {
    const replace = vi.fn().mockRejectedValue(new Error("navigation cancelled"));
    const router = { replace } as unknown as Router;

    await expect(handleSuperAdminUnauthorized(router)).rejects.toThrow("navigation cancelled");
  });
});

describe("isUnauthorizedError (re-exported from appErrors)", () => {
  it("recognizes an AppError with UNAUTHORIZED code", () => {
    expect(isUnauthorizedError(new AppError("UNAUTHORIZED", "expired"))).toBe(true);
  });

  it("recognizes a plain Error with an 'unauthorized' message", () => {
    expect(isUnauthorizedError(new Error("Unauthorized"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isUnauthorizedError(new Error("boom"))).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });
});
