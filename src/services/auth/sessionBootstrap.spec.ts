import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authState: {
    isInitialized: false,
    isAuthenticated: false,
    userId: null as string | null,
    email: null as string | null,
    signedInAt: null as string | null,
    role: null as "tenant_account" | "workspace_admin" | "super_admin" | null,
    sessionWorkspaceId: null as string | null,
    workspaceContextId: null as string | null,
    isAdmin: false,
    isWorkspaceAdmin: false,
    isSuperAdmin: false,
    hasSecondaryAuth: false,
    superVerifiedAt: null as string | null,
    adminVerifiedAt: null as string | null,
  },
  authenticatedSelect: vi.fn(),
  clearAdminVerification: vi.fn(),
  clearAuthState: vi.fn(),
  clearHttpSession: vi.fn(),
  clearSessionTermination: vi.fn(),
  getAuthState: vi.fn(),
  getPersistedAdminVerification: vi.fn(),
  lookupWorkspaceById: vi.fn(),
  quarantineOfflineCheckoutQueueForCurrentSession: vi.fn(),
  setAuthStateFromBackend: vi.fn(),
}));

vi.mock("../../store/authState", () => ({
  clearAdminVerification: mocks.clearAdminVerification,
  clearAuthState: mocks.clearAuthState,
  getAuthState: mocks.getAuthState,
  getPersistedAdminVerification: mocks.getPersistedAdminVerification,
  setAuthStateFromBackend: mocks.setAuthStateFromBackend,
}));
vi.mock("../../store/sessionTermination", () => ({
  clearSessionTermination: mocks.clearSessionTermination,
}));
vi.mock("../workspaceService", () => ({
  lookupWorkspaceById: mocks.lookupWorkspaceById,
}));
vi.mock("../httpSessionService", () => ({
  clearHttpSession: mocks.clearHttpSession,
}));
vi.mock("../authenticatedDataClient", () => ({
  authenticatedRpc: vi.fn(),
  authenticatedSelect: mocks.authenticatedSelect,
}));
vi.mock("../offlineCheckoutQueue", () => ({
  quarantineOfflineCheckoutQueueForCurrentSession:
    mocks.quarantineOfflineCheckoutQueueForCurrentSession,
}));

import { applyHttpSessionSummary } from "./sessionBootstrap";

describe("session bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.authState, {
      isInitialized: false,
      isAuthenticated: false,
      userId: null,
      email: null,
      signedInAt: null,
      role: null,
      sessionWorkspaceId: null,
      workspaceContextId: null,
      isAdmin: false,
      isWorkspaceAdmin: false,
      isSuperAdmin: false,
      hasSecondaryAuth: false,
      superVerifiedAt: null,
      adminVerifiedAt: null,
    });
    mocks.getAuthState.mockReturnValue(mocks.authState);
    mocks.getPersistedAdminVerification.mockReturnValue(null);
    mocks.authenticatedSelect.mockResolvedValue([
      { id: "workspace-1", status: "active", slug: "acme" },
    ]);
    mocks.quarantineOfflineCheckoutQueueForCurrentSession.mockResolvedValue(undefined);
  });

  it("uses the Better Auth session timestamp after a root-to-workspace handoff", async () => {
    const authenticatedAt = "2026-09-11T20:00:00.000Z";

    await applyHttpSessionSummary({
      authenticated: true,
      user: {
        id: "profile-1",
        email: "admin@example.com",
        last_sign_in_at: authenticatedAt,
      },
      profile: {
        role: "workspace_admin",
        workspace_id: "workspace-1",
        auth_email: "admin@example.com",
        is_active: true,
      },
      password_authenticated_at: null,
    });

    expect(mocks.setAuthStateFromBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "workspace_admin",
        workspaceContextId: "workspace-1",
        adminVerifiedAt: authenticatedAt,
      }),
    );
  });
});
