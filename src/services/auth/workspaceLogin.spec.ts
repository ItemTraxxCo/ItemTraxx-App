import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

vi.mock("../../store/workspaceState", () => ({
  getWorkspaceState: vi.fn(),
}));

vi.mock("../../store/authState", () => ({
  getAuthState: vi.fn(),
  setWorkspaceContext: vi.fn(),
}));

vi.mock("../httpSessionService", () => ({
  exchangeHttpSession: vi.fn(),
  fetchHttpSessionSummary: vi.fn(),
}));

vi.mock("./sessionBootstrap", () => ({
  applyHttpSessionSummary: vi.fn(),
  resolveWorkspaceSlug: vi.fn(),
}));

import { clearLocalSession, sendLoginNotification, workspaceLogin } from "./workspaceLogin";
import { invokeEdgeFunction } from "../edgeFunctionClient";
import { getWorkspaceState } from "../../store/workspaceState";
import { getAuthState, setWorkspaceContext } from "../../store/authState";
import { exchangeHttpSession, fetchHttpSessionSummary } from "../httpSessionService";
import { applyHttpSessionSummary, resolveWorkspaceSlug } from "./sessionBootstrap";

describe("sendLoginNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires a fire-and-forget login-notify call when an access token is present", () => {
    sendLoginNotification("tok-1", { loginLocation: "account_login" });
    expect(invokeEdgeFunction).toHaveBeenCalledWith("login-notify", {
      method: "POST",
      accessToken: "tok-1",
      body: { login_location: "account_login" },
    });
  });

  it("does nothing when there is no access token", () => {
    sendLoginNotification(null);
    expect(invokeEdgeFunction).not.toHaveBeenCalled();
  });

  it("defaults login_location to null when not provided", () => {
    sendLoginNotification("tok-1");
    expect(invokeEdgeFunction).toHaveBeenCalledWith("login-notify", {
      method: "POST",
      accessToken: "tok-1",
      body: { login_location: null },
    });
  });
});

describe("clearLocalSession", () => {
  it("resolves without doing anything (workspace flow keeps the cookie session)", async () => {
    await expect(clearLocalSession()).resolves.toBeUndefined();
  });
});

describe("workspaceLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspaceState).mockReturnValue({
      host: "acme.app.itemtraxx.com",
      slug: "acme",
      isWorkspaceHost: true,
      baseHost: "app.itemtraxx.com",
      workspaceId: null,
      workspaceName: null,
      isKnownWorkspace: false,
      hostMismatch: false,
    });
    vi.mocked(getAuthState).mockReturnValue({
      role: "tenant_account",
      sessionWorkspaceId: "ws-1",
      workspaceContextId: "ws-1",
    } as never);
    vi.mocked(exchangeHttpSession).mockResolvedValue({ authenticated: true, user: { id: "u1", email: "a@b.com", last_sign_in_at: null }, profile: null });
    vi.mocked(applyHttpSessionSummary).mockResolvedValue(undefined);
    vi.mocked(resolveWorkspaceSlug).mockResolvedValue("resolved-slug");
  });

  it("logs in successfully, exchanges the session, and notifies with an account_login location for a tenant", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { access_token: "at-1", refresh_token: "rt-1", workspace_slug: "acme" },
    });

    const result = await workspaceLogin("Person@Example.com", "hunter2", "turnstile-tok");

    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(1, "workspace-login", {
      method: "POST",
      body: {
        email: "person@example.com",
        password: "hunter2",
        turnstile_token: "turnstile-tok",
        workspace_slug: "acme",
      },
    });
    expect(exchangeHttpSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" });
    expect(applyHttpSessionSummary).toHaveBeenCalled();
    expect(setWorkspaceContext).toHaveBeenCalledWith("ws-1");
    // workspace_slug came back from the login response, so resolveWorkspaceSlug is skipped.
    expect(resolveWorkspaceSlug).not.toHaveBeenCalled();
    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(2, "login-notify", {
      method: "POST",
      accessToken: "at-1",
      body: { login_location: "account_login" },
    });
    expect(result).toEqual({ workspaceId: "ws-1", workspaceSlug: "acme", role: "tenant_account" });
  });

  it("uses a workspace_admin_login notification location for admins and resolves the slug when missing", async () => {
    vi.mocked(getAuthState).mockReturnValue({
      role: "workspace_admin",
      sessionWorkspaceId: "ws-2",
      workspaceContextId: "ws-2",
    } as never);
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { access_token: "at-1", refresh_token: "rt-1" },
    });

    const result = await workspaceLogin("admin@example.com", "hunter2");

    expect(resolveWorkspaceSlug).toHaveBeenCalledWith("ws-2");
    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(2, "login-notify", {
      method: "POST",
      accessToken: "at-1",
      body: { login_location: "workspace_admin_login" },
    });
    expect(result.workspaceSlug).toBe("resolved-slug");
  });

  it("omits workspace_slug and turnstile_token from the request when not applicable", async () => {
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
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { access_token: "at-1", refresh_token: "rt-1" },
    });

    await workspaceLogin("person@example.com", "hunter2");

    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(1, "workspace-login", {
      method: "POST",
      body: { email: "person@example.com", password: "hunter2" },
    });
  });

  it("falls back to fetchHttpSessionSummary when exchangeHttpSession throws", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { access_token: "at-1", refresh_token: "rt-1" },
    });
    vi.mocked(exchangeHttpSession).mockRejectedValueOnce(new Error("exchange failed"));
    const fallbackSummary = { authenticated: true, user: { id: "u2", email: "b@c.com", last_sign_in_at: null }, profile: null };
    vi.mocked(fetchHttpSessionSummary).mockResolvedValueOnce(fallbackSummary);

    await workspaceLogin("person@example.com", "hunter2");

    expect(applyHttpSessionSummary).toHaveBeenCalledWith(fallbackSummary);
  });

  it("throws LIMITER_UNAVAILABLE on a 503 response", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: false, status: 503, error: "", data: null });
    await expect(workspaceLogin("a@b.com", "pw")).rejects.toThrow("LIMITER_UNAVAILABLE");
  });

  it("throws TURNSTILE_FAILED on a 403 Turnstile failure", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: false, status: 403, error: "Turnstile check failed", data: null });
    await expect(workspaceLogin("a@b.com", "pw")).rejects.toThrow("TURNSTILE_FAILED");
  });

  it("throws WORKSPACE_DISABLED on a 403 disabled-workspace failure", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: false, status: 403, error: "Workspace disabled", data: null });
    await expect(workspaceLogin("a@b.com", "pw")).rejects.toThrow("WORKSPACE_DISABLED");
  });

  it("throws a generic invalid-credentials error for other failures", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: false, status: 401, error: "nope", data: null });
    await expect(workspaceLogin("a@b.com", "pw")).rejects.toThrow("Invalid email or password.");
  });

  it("throws when the response is ok but is missing tokens", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({ ok: true, status: 200, error: "", data: {} });
    await expect(workspaceLogin("a@b.com", "pw")).rejects.toThrow("Invalid email or password.");
  });
});
