import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/client", () => ({
  authClient: { signIn: { email: vi.fn() } },
}));
vi.mock("../../store/workspaceState", () => ({ getWorkspaceState: vi.fn() }));
vi.mock("../../store/authState", () => ({
  getAuthState: vi.fn(),
  markAdminVerified: vi.fn(),
  setWorkspaceContext: vi.fn(),
}));
vi.mock("../httpSessionService", () => ({ fetchHttpSessionSummary: vi.fn() }));
vi.mock("../auditLogService", () => ({ logAdminAction: vi.fn() }));
vi.mock("./sessionBootstrap", () => ({
  applyHttpSessionSummary: vi.fn(),
  resolveWorkspaceSlug: vi.fn(),
}));
vi.mock("../privilegedStepUpService", () => ({
  registerPrivilegedAdminStepUp: vi.fn(),
}));
vi.mock("../edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "../edgeFunctionClient";
import { sendLoginNotification } from "./workspaceLogin";

describe("sendLoginNotification", () => {
  beforeEach(() => {
    vi.mocked(invokeEdgeFunction).mockReset();
  });

  it("uses a cookie-authenticated CORS-simple request", () => {
    sendLoginNotification(null, { loginLocation: "super_admin_login" });

    expect(invokeEdgeFunction).toHaveBeenCalledWith("login-notify", {
      method: "POST",
      body: { login_location: "super_admin_login" },
      avoidCorsPreflight: true,
    });
  });
});
