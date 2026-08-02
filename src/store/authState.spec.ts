import { afterEach, describe, expect, it } from "vitest";
import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  getPersistedAdminVerification,
  markAdminVerified,
  setAuthStateFromBackend,
  setSecondaryAuth,
  setWorkspaceContext,
} from "./authState";

afterEach(() => {
  clearAuthState();
  clearAdminVerification();
  window.sessionStorage.clear();
});

describe("setAuthStateFromBackend", () => {
  it("derives role-based booleans from the role field", () => {
    setAuthStateFromBackend({ role: "workspace_admin", userId: "u1" });
    const state = getAuthState();
    expect(state.isAdmin).toBe(true);
    expect(state.isWorkspaceAdmin).toBe(true);
    expect(state.isSuperAdmin).toBe(false);
  });

  it("marks isSuperAdmin for a super_admin role and clears the others", () => {
    setAuthStateFromBackend({ role: "super_admin" });
    const state = getAuthState();
    expect(state.isSuperAdmin).toBe(true);
    expect(state.isAdmin).toBe(false);
    expect(state.isWorkspaceAdmin).toBe(false);
  });

  it("merges partial updates without clobbering unrelated fields", () => {
    setAuthStateFromBackend({ userId: "u1", email: "a@b.com" });
    setAuthStateFromBackend({ isAuthenticated: true });
    const state = getAuthState();
    expect(state.userId).toBe("u1");
    expect(state.email).toBe("a@b.com");
    expect(state.isAuthenticated).toBe(true);
  });
});

describe("setWorkspaceContext / setSecondaryAuth", () => {
  it("sets the workspace context id", () => {
    setWorkspaceContext("ws-1");
    expect(getAuthState().workspaceContextId).toBe("ws-1");
    setWorkspaceContext(null);
    expect(getAuthState().workspaceContextId).toBeNull();
  });

  it("stamps superVerifiedAt when secondary auth is enabled, clears it when disabled", () => {
    setSecondaryAuth(true);
    expect(getAuthState().hasSecondaryAuth).toBe(true);
    expect(getAuthState().superVerifiedAt).not.toBeNull();

    setSecondaryAuth(false);
    expect(getAuthState().hasSecondaryAuth).toBe(false);
    expect(getAuthState().superVerifiedAt).toBeNull();
  });
});

describe("admin verification persistence", () => {
  it("returns null when no userId is provided", () => {
    expect(getPersistedAdminVerification(null)).toBeNull();
  });

  it("returns null when nothing has been persisted yet", () => {
    expect(getPersistedAdminVerification("u1")).toBeNull();
  });

  it("persists and retrieves verification scoped to the current userId", () => {
    setAuthStateFromBackend({ userId: "u1" });
    markAdminVerified();

    expect(getAuthState().adminVerifiedAt).not.toBeNull();
    const persisted = getPersistedAdminVerification("u1");
    expect(persisted).toBe(getAuthState().adminVerifiedAt);
  });

  it("does not return persisted verification for a different userId", () => {
    setAuthStateFromBackend({ userId: "u1" });
    markAdminVerified();

    expect(getPersistedAdminVerification("someone-else")).toBeNull();
  });

  it("clearAdminVerification wipes both in-memory and persisted state", () => {
    setAuthStateFromBackend({ userId: "u1" });
    markAdminVerified();

    clearAdminVerification();

    expect(getAuthState().adminVerifiedAt).toBeNull();
    expect(getPersistedAdminVerification("u1")).toBeNull();
  });

  it("ignores malformed persisted verification data", () => {
    window.sessionStorage.setItem("itemtraxx:admin-verification", "{not json");
    expect(getPersistedAdminVerification("u1")).toBeNull();
  });

  it("ignores persisted verification data missing required fields", () => {
    window.sessionStorage.setItem("itemtraxx:admin-verification", JSON.stringify({ userId: "u1" }));
    expect(getPersistedAdminVerification("u1")).toBeNull();
  });
});

describe("clearAuthState", () => {
  it("resets to defaults, optionally marking initialized", () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: "u1", role: "workspace_admin" });

    clearAuthState(true);

    const state = getAuthState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.userId).toBeNull();
    expect(state.isInitialized).toBe(true);
  });

  it("leaves isInitialized false when not explicitly marked", () => {
    clearAuthState();
    expect(getAuthState().isInitialized).toBe(false);
  });
});
