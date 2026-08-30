import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabaseClient", () => ({
  supabase: {
    auth: {
      signInWithPasskey: vi.fn(),
    },
  },
}));

vi.mock("../edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

vi.mock("../../store/authState", () => ({
  clearAuthState: vi.fn(),
  getAuthState: vi.fn(),
  markAdminVerified: vi.fn(),
  setAuthStateFromBackend: vi.fn(),
  setSecondaryAuth: vi.fn(),
  setWorkspaceContext: vi.fn(),
}));

vi.mock("../../store/workspaceState", () => ({
  getWorkspaceState: vi.fn(),
}));

vi.mock("../privilegedStepUpService", () => ({
  registerPrivilegedAdminStepUp: vi.fn(),
}));

vi.mock("../httpSessionService", () => ({
  exchangeHttpSession: vi.fn(),
  fetchHttpSessionSummary: vi.fn(),
}));

vi.mock("../../utils/deviceSession", () => ({
  rotateDeviceSession: vi.fn(),
}));

vi.mock("../adminOpsService", () => ({
  touchAccountSession: vi.fn(),
}));

vi.mock("../superOps/sessions", () => ({
  touchSuperAdminSession: vi.fn(),
}));

vi.mock("./sessionBootstrap", () => ({
  fetchCurrentRoleAndWorkspace: vi.fn(),
  fetchProfile: vi.fn(),
  fetchWorkspaceContext: vi.fn(),
  refreshAuthFromSession: vi.fn(),
  resolveWorkspaceSlug: vi.fn(),
}));

vi.mock("./workspaceLogin", () => ({
  clearLocalSession: vi.fn(),
  sendLoginNotification: vi.fn(),
}));

vi.mock("../offlineCheckoutQueue", () => ({
  quarantineOfflineCheckoutQueueForCurrentSession: vi.fn(),
}));

vi.mock("./signOut", () => ({
  signOut: vi.fn(),
}));

vi.mock("./sessionState", () => ({
  clearPendingSuperAdminVerificationEmail: vi.fn(),
  getPendingSuperAdminChallengeToken: vi.fn(),
  setPendingSuperAdminChallengeToken: vi.fn(),
  setPendingSuperAdminVerificationEmail: vi.fn(),
}));

import {
  adminLoginWithSession,
  resendSuperAdminEmailChallenge,
  superAdminLogin,
  superAdminPasskeyLogin,
  verifySuperAdminEmailChallenge,
} from "./privilegedLogin";
import { supabase } from "../supabaseClient";
import { invokeEdgeFunction } from "../edgeFunctionClient";
import {
  clearAuthState,
  getAuthState,
  markAdminVerified,
  setAuthStateFromBackend,
  setSecondaryAuth,
} from "../../store/authState";
import { getWorkspaceState } from "../../store/workspaceState";
import { registerPrivilegedAdminStepUp } from "../privilegedStepUpService";
import { exchangeHttpSession, fetchHttpSessionSummary } from "../httpSessionService";
import { rotateDeviceSession } from "../../utils/deviceSession";
import { touchAccountSession } from "../adminOpsService";
import { touchSuperAdminSession } from "../superOps/sessions";
import {
  fetchCurrentRoleAndWorkspace,
  fetchProfile,
  fetchWorkspaceContext,
  refreshAuthFromSession,
  resolveWorkspaceSlug,
} from "./sessionBootstrap";
import { sendLoginNotification } from "./workspaceLogin";
import { quarantineOfflineCheckoutQueueForCurrentSession } from "../offlineCheckoutQueue";
import { signOut } from "./signOut";
import {
  clearPendingSuperAdminVerificationEmail,
  getPendingSuperAdminChallengeToken,
  setPendingSuperAdminChallengeToken,
  setPendingSuperAdminVerificationEmail,
} from "./sessionState";

describe("resendSuperAdminEmailChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPendingSuperAdminChallengeToken).mockReturnValue(null);
  });

  it("requests a fresh email challenge with no prior token and stores the returned email", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { challenge_started: true, email: "admin@example.com" },
    });

    const result = await resendSuperAdminEmailChallenge();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-auth-verify", {
      method: "POST",
      body: { action: "resend_email_challenge", payload: {} },
    });
    expect(setPendingSuperAdminVerificationEmail).toHaveBeenCalledWith("admin@example.com");
    expect(result).toEqual({ email: "admin@example.com" });
  });

  it("includes the in-memory challenge token when one is pending", async () => {
    vi.mocked(getPendingSuperAdminChallengeToken).mockReturnValue("chal-tok");
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { challenge_started: true, email: null },
    });

    await resendSuperAdminEmailChallenge();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-auth-verify", {
      method: "POST",
      body: { action: "resend_email_challenge", payload: { challenge_token: "chal-tok" } },
    });
  });

  it("throws when the server declines to start a challenge", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { challenge_started: false },
    });

    await expect(resendSuperAdminEmailChallenge()).rejects.toThrow();
  });

  it("throws when the request itself fails", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });
    await expect(resendSuperAdminEmailChallenge()).rejects.toThrow("boom");
  });
});

describe("verifySuperAdminEmailChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPendingSuperAdminChallengeToken).mockReturnValue(null);
    vi.mocked(refreshAuthFromSession).mockResolvedValue(undefined);
    vi.mocked(getAuthState).mockReturnValue({ role: "super_admin" } as never);
  });

  it("throws when the code is not verified", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { verified: false } });
    await expect(verifySuperAdminEmailChallenge("000000")).rejects.toThrow();
  });

  it("throws when the underlying request fails", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: false, status: 500, error: "server error", data: null });
    await expect(verifySuperAdminEmailChallenge("000000")).rejects.toThrow("server error");
  });

  it("exchanges the returned tokens, confirms super_admin, and completes login", async () => {
    vi.mocked(getPendingSuperAdminChallengeToken).mockReturnValue("chal-tok");
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { verified: true, access_token: "at-1", refresh_token: "rt-1" },
    });

    await verifySuperAdminEmailChallenge("123456");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-auth-verify", {
      method: "POST",
      body: { action: "verify_email_challenge", payload: { code: "123456", challenge_token: "chal-tok" } },
    });
    expect(exchangeHttpSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" });
    expect(setSecondaryAuth).toHaveBeenCalledWith(true);
    expect(refreshAuthFromSession).toHaveBeenCalledTimes(1);
    expect(clearPendingSuperAdminVerificationEmail).toHaveBeenCalledTimes(1);
    expect(touchSuperAdminSession).toHaveBeenCalledWith({ loginMethod: "password", loginLocation: "super_auth" });
    expect(sendLoginNotification).toHaveBeenCalledWith("at-1", { loginLocation: "super_admin_login" });
  });

  it("does not exchange tokens when none are returned (resumed via HttpOnly cookie)", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { verified: true },
    });

    await verifySuperAdminEmailChallenge("123456");

    expect(exchangeHttpSession).not.toHaveBeenCalled();
    expect(sendLoginNotification).toHaveBeenCalledWith(null, { loginLocation: "super_admin_login" });
  });

  it("signs out and throws Access denied when the resulting session is not super_admin", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { verified: true, access_token: "at-1", refresh_token: "rt-1" },
    });
    vi.mocked(getAuthState).mockReturnValue({ role: "tenant_account" } as never);

    await expect(verifySuperAdminEmailChallenge("123456")).rejects.toThrow("Access denied.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("swallows a touchSuperAdminSession failure without blocking login", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { verified: true, access_token: "at-1", refresh_token: "rt-1" },
    });
    vi.mocked(touchSuperAdminSession).mockRejectedValueOnce(new Error("tracking down"));

    await expect(verifySuperAdminEmailChallenge("123456")).resolves.toBeUndefined();
    expect(sendLoginNotification).toHaveBeenCalled();
  });
});

const baseSessionSummary = () => ({
  authenticated: true,
  user: { id: "u1", email: "admin@example.com", last_sign_in_at: "2026-08-01T00:00:00Z" },
  profile: { role: "workspace_admin" as const, workspace_id: "ws-1", auth_email: "admin@example.com", is_active: true },
});

describe("adminLoginWithSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthState).mockReturnValue({ workspaceContextId: null } as never);
    vi.mocked(getWorkspaceState).mockReturnValue({
      host: null,
      slug: null,
      isWorkspaceHost: false,
      baseHost: null,
      workspaceId: null,
      workspaceName: null,
      isKnownWorkspace: false,
      hostMismatch: false,
    });
    vi.mocked(exchangeHttpSession).mockResolvedValue(baseSessionSummary());
    vi.mocked(fetchWorkspaceContext).mockResolvedValue({ id: "ws-1", status: "active", slug: "acme" });
    vi.mocked(registerPrivilegedAdminStepUp).mockResolvedValue({ registered: true, expires_at: "x" });
    vi.mocked(resolveWorkspaceSlug).mockResolvedValue("acme");
    vi.mocked(touchAccountSession).mockResolvedValue({ ok: true });
    vi.mocked(quarantineOfflineCheckoutQueueForCurrentSession).mockResolvedValue(0);
  });

  it("logs an admin in end to end: exchanges the session, verifies the workspace, and sets auth state", async () => {
    const result = await adminLoginWithSession("at-1", "rt-1");

    expect(exchangeHttpSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" });
    expect(fetchWorkspaceContext).toHaveBeenCalledWith("ws-1");
    expect(registerPrivilegedAdminStepUp).toHaveBeenCalledWith("at-1");
    expect(rotateDeviceSession).toHaveBeenCalledTimes(1);
    expect(touchAccountSession).toHaveBeenCalledWith({ loginMethod: "password", loginLocation: "admin_login" });
    expect(setAuthStateFromBackend).toHaveBeenCalledWith(
      expect.objectContaining({ isAuthenticated: true, userId: "u1", role: "workspace_admin", sessionWorkspaceId: "ws-1" })
    );
    expect(markAdminVerified).toHaveBeenCalledTimes(1);
    expect(sendLoginNotification).toHaveBeenCalledWith("at-1", { loginLocation: "workspace_admin_login" });
    expect(result).toEqual({
      role: "workspace_admin",
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      accessToken: "at-1",
      refreshToken: "rt-1",
    });
  });

  it("quarantines legacy offline entries when the authenticated admin changes", async () => {
    vi.mocked(getAuthState).mockReturnValue({
      isAuthenticated: true,
      userId: "previous-user",
      workspaceContextId: "ws-1",
    } as never);

    await adminLoginWithSession("at-1", "rt-1");

    expect(quarantineOfflineCheckoutQueueForCurrentSession).toHaveBeenCalledTimes(1);
  });

  it("skips the exchange and clearLocalSession when skipExchange is set with a pre-exchanged summary", async () => {
    const preExchanged = baseSessionSummary();
    await adminLoginWithSession("at-1", "rt-1", { skipExchange: true, preExchangedSessionSummary: preExchanged });

    expect(exchangeHttpSession).not.toHaveBeenCalled();
  });

  it("falls back to fetchHttpSessionSummary when the exchange result is not usable", async () => {
    vi.mocked(exchangeHttpSession).mockResolvedValueOnce({ authenticated: false, user: null, profile: null });
    vi.mocked(fetchHttpSessionSummary).mockResolvedValueOnce(baseSessionSummary());

    await adminLoginWithSession("at-1", "rt-1");

    expect(fetchHttpSessionSummary).toHaveBeenCalledTimes(1);
    expect(setAuthStateFromBackend).toHaveBeenCalled();
  });

  it("throws Invalid credentials when no usable session can be found at all", async () => {
    vi.mocked(exchangeHttpSession).mockResolvedValueOnce({ authenticated: false, user: null, profile: null });
    vi.mocked(fetchHttpSessionSummary).mockResolvedValueOnce({ authenticated: false, user: null, profile: null });

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("Invalid credentials.");
  });

  it("falls back to fetchProfile when the session summary has no profile", async () => {
    vi.mocked(exchangeHttpSession).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "u1", email: "admin@example.com", last_sign_in_at: null },
      profile: null,
    });
    vi.mocked(fetchProfile).mockResolvedValueOnce({
      id: "u1",
      role: "workspace_admin",
      workspace_id: "ws-1",
      auth_email: "admin@example.com",
      is_active: true,
    });

    await adminLoginWithSession("at-1", "rt-1");

    expect(fetchProfile).toHaveBeenCalledWith("u1");
    expect(setAuthStateFromBackend).toHaveBeenCalled();
  });

  it("uses the role/workspace RPC fallback when the profile is missing role or workspace", async () => {
    vi.mocked(exchangeHttpSession).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "u1", email: "admin@example.com", last_sign_in_at: null },
      profile: { role: null, workspace_id: null, auth_email: null, is_active: true },
    });
    vi.mocked(fetchCurrentRoleAndWorkspace).mockResolvedValueOnce({ role: "workspace_admin", workspaceId: "ws-1" });

    await adminLoginWithSession("at-1", "rt-1");

    expect(fetchCurrentRoleAndWorkspace).toHaveBeenCalledTimes(1);
    expect(setAuthStateFromBackend).toHaveBeenCalledWith(
      expect.objectContaining({ role: "workspace_admin", sessionWorkspaceId: "ws-1" })
    );
  });

  it("ignores a failing role/workspace RPC fallback and continues with whatever is known", async () => {
    vi.mocked(exchangeHttpSession).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "u1", email: "admin@example.com", last_sign_in_at: null },
      profile: { role: null, workspace_id: null, auth_email: null, is_active: true },
    });
    vi.mocked(fetchCurrentRoleAndWorkspace).mockRejectedValueOnce(new Error("rpc down"));

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("Access denied.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out and denies access when the resolved role is not workspace_admin", async () => {
    vi.mocked(exchangeHttpSession).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: { role: "tenant_account", workspace_id: null, auth_email: "a@b.com", is_active: true },
    });

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("Access denied.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out and denies access when the profile is explicitly inactive", async () => {
    vi.mocked(exchangeHttpSession).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "u1", email: "a@b.com", last_sign_in_at: null },
      profile: { role: "workspace_admin", workspace_id: "ws-1", auth_email: "a@b.com", is_active: false },
    });

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("Access denied.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out and reports the workspace as disabled when it is not active", async () => {
    vi.mocked(fetchWorkspaceContext).mockResolvedValueOnce({ id: "ws-1", status: "suspended", slug: "acme" });

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("Workspace disabled.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out and denies access when the workspace changed from a prior session context", async () => {
    vi.mocked(getAuthState).mockReturnValue({ workspaceContextId: "ws-old" } as never);

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("Access denied.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out when on an unconfigured workspace host", async () => {
    vi.mocked(getWorkspaceState).mockReturnValue({
      host: "unknown.app.itemtraxx.com",
      slug: "unknown",
      isWorkspaceHost: true,
      baseHost: "app.itemtraxx.com",
      workspaceId: null,
      workspaceName: null,
      isKnownWorkspace: false,
      hostMismatch: false,
    });

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("This workspace URL is not configured.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out when the workspace host does not match the admin's workspace", async () => {
    vi.mocked(getWorkspaceState).mockReturnValue({
      host: "acme.app.itemtraxx.com",
      slug: "acme",
      isWorkspaceHost: true,
      baseHost: "app.itemtraxx.com",
      workspaceId: "ws-other",
      workspaceName: "Other",
      isKnownWorkspace: true,
      hostMismatch: false,
    });

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("Access denied.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out and rethrows when privileged step-up registration fails", async () => {
    vi.mocked(registerPrivilegedAdminStepUp).mockRejectedValueOnce(new Error("step-up failed"));

    await expect(adminLoginWithSession("at-1", "rt-1")).rejects.toThrow("step-up failed");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("does not block login when best-effort session tracking (touchAccountSession) fails", async () => {
    vi.mocked(touchAccountSession).mockRejectedValueOnce(new Error("tracking down"));

    await expect(adminLoginWithSession("at-1", "rt-1")).resolves.toBeDefined();
    expect(setAuthStateFromBackend).toHaveBeenCalled();
  });

  it("skips the login notification when skipLoginNotification is set", async () => {
    await adminLoginWithSession("at-1", "rt-1", { skipLoginNotification: true });
    expect(sendLoginNotification).not.toHaveBeenCalled();
  });

  it("uses the explicit login location for the notification when provided", async () => {
    await adminLoginWithSession("at-1", "rt-1", { loginLocation: "regular_login" });
    expect(sendLoginNotification).toHaveBeenCalledWith("at-1", { loginLocation: "regular_login" });
  });
});

describe("superAdminLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a password challenge, clears any prior session, and stores the pending challenge", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { challenge_started: true, email: "super@example.com", challenge_token: "chal-1" },
    });

    const result = await superAdminLogin("Super@Example.com", "pw", "turnstile-tok");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-auth-verify", {
      method: "POST",
      body: { action: "start_password_login", payload: { email: "Super@Example.com", password: "pw", turnstile_token: "turnstile-tok" } },
    });
    expect(setSecondaryAuth).toHaveBeenCalledWith(false);
    expect(clearAuthState).toHaveBeenCalledWith(true);
    expect(setPendingSuperAdminChallengeToken).toHaveBeenCalledWith("chal-1");
    expect(setPendingSuperAdminVerificationEmail).toHaveBeenCalledWith("super@example.com");
    expect(result).toEqual({ email: "super@example.com" });
  });

  it("falls back to the submitted email when the server does not echo one back", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { challenge_started: true, email: null, challenge_token: "chal-1" },
    });

    const result = await superAdminLogin("super@example.com", "pw", "turnstile-tok");
    expect(result).toEqual({ email: "super@example.com" });
  });

  it("throws when the challenge fails to start", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { challenge_started: false },
    });

    await expect(superAdminLogin("super@example.com", "pw", "turnstile-tok")).rejects.toThrow();
  });

  it("throws when the request fails outright", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: false, status: 500, error: "boom", data: null });
    await expect(superAdminLogin("super@example.com", "pw", "turnstile-tok")).rejects.toThrow("boom");
  });
});

describe("superAdminPasskeyLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(refreshAuthFromSession).mockResolvedValue(undefined);
    vi.mocked(getAuthState).mockReturnValue({ role: "super_admin" } as never);
  });

  it("throws when the passkey sign-in itself errors", async () => {
    vi.mocked(supabase.auth.signInWithPasskey).mockResolvedValueOnce({
      data: null,
      error: { message: "user cancelled" },
    } as never);

    await expect(superAdminPasskeyLogin()).rejects.toThrow("user cancelled");
  });

  it("throws a generic failure when there is no error but also no session", async () => {
    vi.mocked(supabase.auth.signInWithPasskey).mockResolvedValueOnce({ data: {}, error: null } as never);
    await expect(superAdminPasskeyLogin()).rejects.toThrow("Passkey sign in failed.");
  });

  it("throws when the session is missing tokens", async () => {
    vi.mocked(supabase.auth.signInWithPasskey).mockResolvedValueOnce({
      data: { session: { access_token: null, refresh_token: null } },
      error: null,
    } as never);

    await expect(superAdminPasskeyLogin()).rejects.toThrow("Passkey sign in failed.");
  });

  it("throws a mapped error when server-side verification fails", async () => {
    vi.mocked(supabase.auth.signInWithPasskey).mockResolvedValueOnce({
      data: { session: { access_token: "at-1", refresh_token: "rt-1" } },
      error: null,
    } as never);
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: false, status: 422, error: "denied", data: null });

    await expect(superAdminPasskeyLogin()).rejects.toThrow("denied");
  });

  it("completes login end-to-end on success, touching the session and notifying", async () => {
    vi.mocked(supabase.auth.signInWithPasskey).mockResolvedValueOnce({
      data: { session: { access_token: "at-1", refresh_token: "rt-1" } },
      error: null,
    } as never);
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { verified: true },
    });

    await superAdminPasskeyLogin({ loginLocation: "super_settings" });

    expect(exchangeHttpSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" });
    expect(refreshAuthFromSession).toHaveBeenCalledTimes(1);
    expect(setSecondaryAuth).toHaveBeenCalledWith(true);
    expect(clearPendingSuperAdminVerificationEmail).toHaveBeenCalledTimes(1);
    expect(touchSuperAdminSession).toHaveBeenCalledWith({ loginMethod: "passkey", loginLocation: "super_settings" });
    expect(sendLoginNotification).toHaveBeenCalledWith("at-1", { loginLocation: "super_admin_login" });
  });

  it("signs out and denies access when the resulting session is not super_admin", async () => {
    vi.mocked(supabase.auth.signInWithPasskey).mockResolvedValueOnce({
      data: { session: { access_token: "at-1", refresh_token: "rt-1" } },
      error: null,
    } as never);
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { verified: true } });
    vi.mocked(getAuthState).mockReturnValue({ role: "tenant_account" } as never);

    await expect(superAdminPasskeyLogin()).rejects.toThrow("Access denied.");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("suppresses the login notification when sendLoginNotification is explicitly false", async () => {
    vi.mocked(supabase.auth.signInWithPasskey).mockResolvedValueOnce({
      data: { session: { access_token: "at-1", refresh_token: "rt-1" } },
      error: null,
    } as never);
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { verified: true } });

    await superAdminPasskeyLogin({ sendLoginNotification: false });

    expect(sendLoginNotification).not.toHaveBeenCalled();
  });

  it("swallows a touchSuperAdminSession failure without blocking login", async () => {
    vi.mocked(supabase.auth.signInWithPasskey).mockResolvedValueOnce({
      data: { session: { access_token: "at-1", refresh_token: "rt-1" } },
      error: null,
    } as never);
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { verified: true } });
    vi.mocked(touchSuperAdminSession).mockRejectedValueOnce(new Error("tracking down"));

    await expect(superAdminPasskeyLogin()).resolves.toBeUndefined();
    expect(sendLoginNotification).toHaveBeenCalled();
  });
});
