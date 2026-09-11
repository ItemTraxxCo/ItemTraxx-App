import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = {
  getSession: vi.fn(),
  signOut: vi.fn(),
  signIn: { email: vi.fn(), passkey: vi.fn() },
  organization: { setActive: vi.fn() },
};
const authenticatedSelect = vi.fn();
vi.mock("../../auth/client", () => ({ authClient }));
vi.mock("../authenticatedDataClient", () => ({ authenticatedSelect }));

describe("Better Auth session bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authClient.signOut.mockResolvedValue({ error: null });
  });

  it("maps a Better Auth user to the stable ItemTraxx profile UUID", async () => {
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "better-user", email: "user@example.com" }, session: { createdAt: new Date("2026-09-07T20:00:00Z") } },
      error: null,
    });
    authenticatedSelect.mockResolvedValue([{ id: "2cf6a564-05ab-4c7d-9ab5-7887d19b5025", role: "tenant_account", workspace_id: "e3610ae4-eb84-4215-b3fa-8aa488809b72", auth_email: "user@example.com", is_active: true }]);
    const { fetchHttpSessionSummary } = await import("../httpSessionService");
    const summary = await fetchHttpSessionSummary();
    expect(summary.user?.id).toBe("2cf6a564-05ab-4c7d-9ab5-7887d19b5025");
    expect(authenticatedSelect).toHaveBeenCalledWith("profiles", expect.objectContaining({ better_auth_user_id: "eq.better-user" }), expect.anything());
  });

  it("fails closed when Better Auth has no session", async () => {
    authClient.getSession.mockResolvedValue({ data: null, error: null });
    const { fetchHttpSessionSummary } = await import("../httpSessionService");
    await expect(fetchHttpSessionSummary()).resolves.toMatchObject({ authenticated: false, user: null });
    expect(authenticatedSelect).not.toHaveBeenCalled();
  });

  it("signs out through Better Auth", async () => {
    const { clearHttpSession } = await import("../httpSessionService");
    await expect(clearHttpSession()).resolves.toEqual({ ok: true });
    expect(authClient.signOut).toHaveBeenCalledOnce();
  });

  it("surfaces Better Auth sign-out failures", async () => {
    authClient.signOut.mockResolvedValue({ error: { message: "network unavailable" } });
    const { clearHttpSession } = await import("../httpSessionService");
    await expect(clearHttpSession()).rejects.toThrow("network unavailable");
  });
});
