import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../store/authState", () => ({
  clearAdminVerification: vi.fn(),
  clearAuthState: vi.fn(),
  getAuthState: vi.fn(),
  setWorkspaceContext: vi.fn(),
}));

vi.mock("../adminOpsService", () => ({
  revokeCurrentAccountSession: vi.fn(),
}));

vi.mock("../workspaceService", () => ({
  resolveWorkspaceHost: vi.fn(),
}));

vi.mock("../httpSessionService", () => ({
  clearHttpSession: vi.fn(),
}));

vi.mock("../offlineCheckoutQueue", () => ({
  clearOfflineCheckoutQueue: vi.fn(),
}));

vi.mock("../offlineCheckoutWorkflow", () => ({
  clearOfflineCheckoutWorkflow: vi.fn(),
}));

vi.mock("../offlineConnectionState", () => ({
  clearOfflineConnectionState: vi.fn(),
}));

vi.mock("../supabaseAuthSession", () => ({
  signOutLocalSupabaseSession: vi.fn(),
}));

vi.mock("./sessionState", () => ({
  clearPendingSuperAdminVerificationEmail: vi.fn(),
}));

import { getPostSignOutUrl, signOut } from "./signOut";
import { clearAdminVerification, clearAuthState, getAuthState, setWorkspaceContext } from "../../store/authState";
import { revokeCurrentAccountSession } from "../adminOpsService";
import { resolveWorkspaceHost } from "../workspaceService";
import { clearHttpSession } from "../httpSessionService";
import { clearOfflineCheckoutQueue } from "../offlineCheckoutQueue";
import { clearOfflineCheckoutWorkflow } from "../offlineCheckoutWorkflow";
import { clearOfflineConnectionState } from "../offlineConnectionState";
import { signOutLocalSupabaseSession } from "../supabaseAuthSession";
import { clearPendingSuperAdminVerificationEmail } from "./sessionState";

describe("signOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthState).mockReturnValue({ role: "tenant_account", adminVerifiedAt: null } as never);
  });

  it("revokes the current device session when the caller is a verified workspace admin", async () => {
    vi.mocked(getAuthState).mockReturnValue({ role: "workspace_admin", adminVerifiedAt: "2026-08-01T00:00:00Z" } as never);

    await signOut();

    expect(revokeCurrentAccountSession).toHaveBeenCalledTimes(1);
    expect(signOutLocalSupabaseSession).toHaveBeenCalledTimes(1);
    expect(clearOfflineCheckoutQueue).toHaveBeenCalledTimes(1);
    expect(clearOfflineCheckoutWorkflow).toHaveBeenCalledTimes(1);
    expect(clearOfflineConnectionState).toHaveBeenCalledTimes(1);
    expect(clearHttpSession).toHaveBeenCalledTimes(1);
    expect(clearAdminVerification).toHaveBeenCalledTimes(1);
    expect(clearPendingSuperAdminVerificationEmail).toHaveBeenCalledTimes(1);
    expect(clearAuthState).toHaveBeenCalledWith(true);
    expect(setWorkspaceContext).toHaveBeenCalledWith(null);
  });

  it("does not revoke a device session for a non-admin or an unverified admin", async () => {
    vi.mocked(getAuthState).mockReturnValue({ role: "tenant_account", adminVerifiedAt: null } as never);
    await signOut();
    expect(revokeCurrentAccountSession).not.toHaveBeenCalled();

    vi.mocked(getAuthState).mockReturnValue({ role: "workspace_admin", adminVerifiedAt: null } as never);
    await signOut();
    expect(revokeCurrentAccountSession).not.toHaveBeenCalled();
  });

  it("continues cleanup even when revoking the device session fails", async () => {
    vi.mocked(getAuthState).mockReturnValue({ role: "workspace_admin", adminVerifiedAt: "2026-08-01T00:00:00Z" } as never);
    vi.mocked(revokeCurrentAccountSession).mockRejectedValueOnce(new Error("network down"));

    await expect(signOut()).resolves.toMatchObject({
      ok: true,
      httpSessionCleared: true,
      accountSessionRevoked: false,
    });

    expect(signOutLocalSupabaseSession).toHaveBeenCalledTimes(1);
    expect(clearAuthState).toHaveBeenCalledWith(true);
  });

  it("continues clearing the HttpOnly session when local Supabase sign-out fails", async () => {
    vi.mocked(signOutLocalSupabaseSession).mockRejectedValueOnce(new Error("local sign-out unavailable"));

    await expect(signOut()).resolves.toMatchObject({
      ok: true,
      httpSessionCleared: true,
      accountSessionRevoked: true,
    });

    expect(clearHttpSession).toHaveBeenCalledTimes(1);
    expect(clearAuthState).toHaveBeenCalledWith(true);
    expect(setWorkspaceContext).toHaveBeenCalledWith(null);
  });

  it("returns a failed result and keeps local auth state when clearing the HttpOnly session fails", async () => {
    vi.mocked(clearHttpSession).mockRejectedValueOnce(new Error("cookie logout down"));

    await expect(signOut()).resolves.toEqual({
      ok: false,
      httpSessionCleared: false,
      accountSessionRevoked: true,
    });

    expect(clearAdminVerification).not.toHaveBeenCalled();
    expect(clearPendingSuperAdminVerificationEmail).not.toHaveBeenCalled();
    expect(clearAuthState).not.toHaveBeenCalled();
    expect(setWorkspaceContext).not.toHaveBeenCalled();
  });

  it("supports best-effort cleanup for login/error recovery when the HttpOnly session fails", async () => {
    vi.mocked(clearHttpSession).mockRejectedValueOnce(new Error("cookie logout down"));

    await expect(signOut({ bestEffort: true })).resolves.toEqual({
      ok: false,
      httpSessionCleared: false,
      accountSessionRevoked: true,
    });

    expect(clearAdminVerification).toHaveBeenCalledTimes(1);
    expect(clearPendingSuperAdminVerificationEmail).toHaveBeenCalledTimes(1);
    expect(clearAuthState).toHaveBeenCalledWith(true);
    expect(setWorkspaceContext).toHaveBeenCalledWith(null);
  });
});

describe("getPostSignOutUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns /login for the root marketing/app hosts", () => {
    for (const host of ["itemtraxx.com", "www.itemtraxx.com", "localhost", "127.0.0.1", "0.0.0.0", "kid.localhost"]) {
      vi.mocked(resolveWorkspaceHost).mockReturnValue({ host, slug: null, isWorkspaceHost: false, baseHost: host });
      expect(getPostSignOutUrl()).toBe("/login");
    }
  });

  it("returns /login when the resolved host is empty", () => {
    vi.mocked(resolveWorkspaceHost).mockReturnValue({ host: "", slug: null, isWorkspaceHost: false, baseHost: null });
    expect(getPostSignOutUrl()).toBe("/login");
  });

  it("redirects to the marketing login for a workspace subdomain host", () => {
    vi.mocked(resolveWorkspaceHost).mockReturnValue({
      host: "acme.app.itemtraxx.com",
      slug: "acme",
      isWorkspaceHost: true,
      baseHost: "app.itemtraxx.com",
    });
    expect(getPostSignOutUrl()).toBe("https://itemtraxx.com/login");
  });

  it("redirects to the marketing login for an unrecognized host that isn't app.itemtraxx.com", () => {
    vi.mocked(resolveWorkspaceHost).mockReturnValue({
      host: "some-other-domain.com",
      slug: null,
      isWorkspaceHost: false,
      baseHost: "some-other-domain.com",
    });
    expect(getPostSignOutUrl()).toBe("https://itemtraxx.com/login");
  });

  it("returns /login for the app.itemtraxx.com host itself", () => {
    vi.mocked(resolveWorkspaceHost).mockReturnValue({
      host: "app.itemtraxx.com",
      slug: null,
      isWorkspaceHost: false,
      baseHost: "app.itemtraxx.com",
    });
    expect(getPostSignOutUrl()).toBe("/login");
  });
});
