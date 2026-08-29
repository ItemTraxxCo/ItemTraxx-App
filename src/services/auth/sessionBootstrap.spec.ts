import { beforeEach, describe, expect, it, vi } from "vitest";

// withTimeout just races the real promise against a setTimeout; racing real
// promises against a live window.setTimeout(15000) works fine under vitest's
// default (non-fake) timers, but a plain passthrough keeps these tests fast
// and focused on sessionBootstrap's own branching rather than asyncUtils'.
vi.mock("../asyncUtils", () => ({
  withTimeout: (promise: Promise<unknown>) => promise,
}));

vi.mock("../../store/authState", () => ({
  clearAdminVerification: vi.fn(),
  clearAuthState: vi.fn(),
  getAuthState: vi.fn(),
  getPersistedAdminVerification: vi.fn(),
  setAuthStateFromBackend: vi.fn(),
}));

vi.mock("../../store/sessionTermination", () => ({
  clearSessionTermination: vi.fn(),
}));

vi.mock("../workspaceService", () => ({
  lookupWorkspaceById: vi.fn(),
}));

vi.mock("../supabaseAuthSession", () => ({
  signOutLocalSupabaseSession: vi.fn(),
}));

vi.mock("../authenticatedDataClient", () => ({
  authenticatedRpc: vi.fn(),
  authenticatedSelect: vi.fn(),
}));

vi.mock("../httpSessionService", () => ({
  fetchHttpSessionSummary: vi.fn(),
}));

vi.mock("../offlineCheckoutQueue", () => ({
  quarantineOfflineCheckoutQueueForCurrentSession: vi.fn(),
}));

import {
  applyHttpSessionSummary,
  fetchCurrentRoleAndWorkspace,
  fetchProfile,
  fetchWorkspaceContext,
  initAuthListener,
  refreshAuthFromSession,
  resolveWorkspaceSlug,
} from "./sessionBootstrap";
import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  getPersistedAdminVerification,
  setAuthStateFromBackend,
} from "../../store/authState";
import { clearSessionTermination } from "../../store/sessionTermination";
import { lookupWorkspaceById } from "../workspaceService";
import { signOutLocalSupabaseSession } from "../supabaseAuthSession";
import { authenticatedRpc, authenticatedSelect } from "../authenticatedDataClient";
import { fetchHttpSessionSummary } from "../httpSessionService";
import { quarantineOfflineCheckoutQueueForCurrentSession } from "../offlineCheckoutQueue";

describe("fetchCurrentRoleAndWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a known role and workspace id in parallel", async () => {
    vi.mocked(authenticatedRpc).mockImplementation(async (fn: string) => {
      if (fn === "current_user_role") return "workspace_admin";
      if (fn === "current_workspace_id") return "ws-1";
      return null;
    });

    const result = await fetchCurrentRoleAndWorkspace();
    expect(result).toEqual({ role: "workspace_admin", workspaceId: "ws-1" });
  });

  it("normalizes an unrecognized role and a non-string workspace id to null", async () => {
    vi.mocked(authenticatedRpc).mockImplementation(async (fn: string) => {
      if (fn === "current_user_role") return "bogus_role";
      if (fn === "current_workspace_id") return 12345 as unknown as string;
      return null;
    });

    const result = await fetchCurrentRoleAndWorkspace();
    expect(result).toEqual({ role: null, workspaceId: null });
  });
});

describe("fetchProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the first profile row when the lookup succeeds", async () => {
    const row = { id: "u1", role: "workspace_admin", workspace_id: "ws-1", auth_email: "a@b.com", is_active: true };
    vi.mocked(authenticatedSelect).mockResolvedValueOnce([row]);

    const result = await fetchProfile("u1");
    expect(result).toEqual(row);
  });

  it("returns null when the lookup succeeds with no rows", async () => {
    vi.mocked(authenticatedSelect).mockResolvedValueOnce([]);
    const result = await fetchProfile("u1");
    expect(result).toBeNull();
  });

  it("falls back to the role/workspace RPC lookup when the select throws", async () => {
    vi.mocked(authenticatedSelect).mockRejectedValueOnce(new Error("select failed"));
    vi.mocked(authenticatedRpc).mockImplementation(async (fn: string) => {
      if (fn === "current_user_role") return "tenant_account";
      if (fn === "current_workspace_id") return "ws-9";
      return null;
    });

    const result = await fetchProfile("u1");
    expect(result).toEqual({ id: "u1", role: "tenant_account", workspace_id: "ws-9", auth_email: null });
  });

  it("returns null when both the select and the RPC fallback yield nothing usable", async () => {
    vi.mocked(authenticatedSelect).mockRejectedValueOnce(new Error("select failed"));
    vi.mocked(authenticatedRpc).mockResolvedValue(null);

    const result = await fetchProfile("u1");
    expect(result).toBeNull();
  });
});

describe("fetchWorkspaceContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the first workspace row", async () => {
    const row = { id: "ws-1", status: "active" as const, slug: "acme" };
    vi.mocked(authenticatedSelect).mockResolvedValueOnce([row]);
    expect(await fetchWorkspaceContext("ws-1")).toEqual(row);
  });

  it("returns null when there are no rows", async () => {
    vi.mocked(authenticatedSelect).mockResolvedValueOnce([]);
    expect(await fetchWorkspaceContext("ws-1")).toBeNull();
  });

  it("returns null when the lookup throws", async () => {
    vi.mocked(authenticatedSelect).mockRejectedValueOnce(new Error("boom"));
    expect(await fetchWorkspaceContext("ws-1")).toBeNull();
  });
});

describe("resolveWorkspaceSlug", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null without a lookup when workspaceId is null", async () => {
    expect(await resolveWorkspaceSlug(null)).toBeNull();
    expect(lookupWorkspaceById).not.toHaveBeenCalled();
  });

  it("returns a trimmed slug when the workspace is found", async () => {
    vi.mocked(lookupWorkspaceById).mockResolvedValueOnce({ id: "ws-1", name: "Acme", slug: "  acme  " });
    expect(await resolveWorkspaceSlug("ws-1")).toBe("acme");
  });

  it("returns null when the workspace lookup finds nothing", async () => {
    vi.mocked(lookupWorkspaceById).mockResolvedValueOnce(null);
    expect(await resolveWorkspaceSlug("ws-1")).toBeNull();
  });

  it("returns null when the slug resolves to an empty string", async () => {
    vi.mocked(lookupWorkspaceById).mockResolvedValueOnce({ id: "ws-1", name: "Acme", slug: "   " });
    expect(await resolveWorkspaceSlug("ws-1")).toBeNull();
  });
});

describe("applyHttpSessionSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(quarantineOfflineCheckoutQueueForCurrentSession).mockResolvedValue(0);
    vi.mocked(getAuthState).mockReturnValue({
      userId: null,
      role: null,
      sessionWorkspaceId: null,
      hasSecondaryAuth: false,
      superVerifiedAt: null,
      adminVerifiedAt: null,
    } as never);
  });

  it("clears auth state when the summary is not authenticated", async () => {
    await applyHttpSessionSummary({ authenticated: false, user: null, profile: null });
    expect(clearAuthState).toHaveBeenCalledWith(true);
    expect(setAuthStateFromBackend).not.toHaveBeenCalled();
  });

  it("clears auth state when authenticated is true but the user is missing", async () => {
    await applyHttpSessionSummary({ authenticated: true, user: null, profile: null });
    expect(clearAuthState).toHaveBeenCalledWith(true);
  });

  it("signs out and terminates the session when the admin's workspace is suspended", async () => {
    vi.mocked(authenticatedSelect).mockResolvedValueOnce([{ id: "ws-1", status: "suspended", slug: "acme" }]);

    await applyHttpSessionSummary({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: { role: "workspace_admin", workspace_id: "ws-1", auth_email: "a@b.com", is_active: true },
    });

    expect(signOutLocalSupabaseSession).toHaveBeenCalledTimes(1);
    expect(clearAdminVerification).toHaveBeenCalledTimes(1);
    expect(clearAuthState).toHaveBeenCalledWith(true);
    expect(setAuthStateFromBackend).not.toHaveBeenCalled();
  });

  it("does not check workspace status for a super_admin profile", async () => {
    await applyHttpSessionSummary({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: { role: "super_admin", workspace_id: "ws-1", auth_email: "a@b.com", is_active: true },
    });

    expect(authenticatedSelect).not.toHaveBeenCalled();
    expect(setAuthStateFromBackend).toHaveBeenCalled();
  });

  it("applies backend auth state for an active workspace admin and clears session termination", async () => {
    vi.mocked(authenticatedSelect).mockResolvedValueOnce([{ id: "ws-1", status: "active", slug: "acme" }]);
    vi.mocked(getPersistedAdminVerification).mockReturnValueOnce("2026-07-01T00:00:00Z");

    await applyHttpSessionSummary({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: "2026-08-01T00:00:00Z" },
      profile: { role: "workspace_admin", workspace_id: "ws-1", auth_email: "a@b.com", is_active: true },
      password_authenticated_at: "2026-07-15T00:00:00Z",
    });

    expect(setAuthStateFromBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        isInitialized: true,
        isAuthenticated: true,
        userId: "u1",
        role: "workspace_admin",
        sessionWorkspaceId: "ws-1",
        workspaceContextId: "ws-1",
        hasSecondaryAuth: false,
        superVerifiedAt: null,
        adminVerifiedAt: "2026-07-01T00:00:00Z",
      })
    );
    expect(clearSessionTermination).toHaveBeenCalledTimes(1);
  });

  it("quarantines legacy offline entries when the session identity changes", async () => {
    vi.mocked(getAuthState).mockReturnValue({
      isAuthenticated: true,
      userId: "previous-user",
      workspaceContextId: "ws-1",
      sessionWorkspaceId: "ws-1",
      role: "tenant_account",
    } as never);

    await applyHttpSessionSummary({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: { role: "tenant_account", workspace_id: "ws-1", auth_email: "a@b.com", is_active: true },
    });

    expect(quarantineOfflineCheckoutQueueForCurrentSession).toHaveBeenCalledTimes(1);
  });

  it("falls back to persisted admin verification's summary timestamp when nothing is stored locally", async () => {
    vi.mocked(authenticatedSelect).mockResolvedValueOnce([{ id: "ws-1", status: "active", slug: "acme" }]);
    vi.mocked(getPersistedAdminVerification).mockReturnValueOnce(null);

    await applyHttpSessionSummary({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: { role: "workspace_admin", workspace_id: "ws-1", auth_email: "a@b.com", is_active: true },
      password_authenticated_at: "2026-07-15T00:00:00Z",
    });

    expect(setAuthStateFromBackend).toHaveBeenCalledWith(
      expect.objectContaining({ adminVerifiedAt: "2026-07-15T00:00:00Z" })
    );
  });

  it("carries over the current role/workspace and secondary-auth state when refreshing the same super_admin user", async () => {
    vi.mocked(getAuthState).mockReturnValue({
      userId: "u1",
      role: "super_admin",
      sessionWorkspaceId: "ws-legacy",
      hasSecondaryAuth: true,
      superVerifiedAt: "2026-07-01T00:00:00Z",
      adminVerifiedAt: "2026-07-01T00:00:00Z",
    } as never);

    await applyHttpSessionSummary({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: null,
    });

    expect(setAuthStateFromBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "super_admin",
        sessionWorkspaceId: "ws-legacy",
        hasSecondaryAuth: true,
        superVerifiedAt: "2026-07-01T00:00:00Z",
        adminVerifiedAt: "2026-07-01T00:00:00Z",
      })
    );
  });

  it("resets role/workspace/secondary-auth when the summary is for a different user than the current one", async () => {
    vi.mocked(getAuthState).mockReturnValue({
      userId: "someone-else",
      role: "super_admin",
      sessionWorkspaceId: "ws-legacy",
      hasSecondaryAuth: true,
      superVerifiedAt: "2026-07-01T00:00:00Z",
      adminVerifiedAt: "2026-07-01T00:00:00Z",
    } as never);

    await applyHttpSessionSummary({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: null,
    });

    expect(setAuthStateFromBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: null,
        sessionWorkspaceId: null,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
        adminVerifiedAt: null,
      })
    );
  });
});

describe("refreshAuthFromSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthState).mockReturnValue({
      userId: null,
      role: null,
      sessionWorkspaceId: null,
      hasSecondaryAuth: false,
      superVerifiedAt: null,
      adminVerifiedAt: null,
    } as never);
  });

  it("clears auth state when the session summary fetch throws", async () => {
    vi.mocked(fetchHttpSessionSummary).mockRejectedValueOnce(new Error("network down"));

    await refreshAuthFromSession();

    expect(clearAuthState).toHaveBeenCalledWith(true);
  });

  it("applies the fetched summary on success", async () => {
    vi.mocked(fetchHttpSessionSummary).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: { role: "tenant_account", workspace_id: null, auth_email: "a@b.com", is_active: true },
    });

    await refreshAuthFromSession();

    expect(setAuthStateFromBackend).toHaveBeenCalledWith(
      expect.objectContaining({ isAuthenticated: true, userId: "u1", role: "tenant_account" })
    );
  });
});

describe("initAuthListener", () => {
  it("is a no-op that does not throw", () => {
    expect(() => initAuthListener()).not.toThrow();
  });
});
