import { describe, expect, it, vi } from "vitest";

// authService.ts is a pure re-export barrel over the auth/* modules (which
// are already unit-tested on their own). Mock each underlying module and
// assert the barrel forwards the exact same bindings, rather than
// re-testing behavior that's already covered elsewhere.
vi.mock("./auth/workspaceLogin", () => ({
  workspaceLogin: vi.fn(),
}));

vi.mock("./auth/sessionBootstrap", () => ({
  applyHttpSessionSummary: vi.fn(),
  initAuthListener: vi.fn(),
  refreshAuthFromSession: vi.fn(),
}));

vi.mock("./auth/privilegedLogin", () => ({
  adminLoginWithSession: vi.fn(),
  resendSuperAdminEmailChallenge: vi.fn(),
  superAdminLogin: vi.fn(),
  superAdminPasskeyLogin: vi.fn(),
  verifySuperAdminEmailChallenge: vi.fn(),
}));

vi.mock("./auth/sessionState", () => ({
  clearPendingSuperAdminVerificationEmail: vi.fn(),
  getPendingSuperAdminChallengeToken: vi.fn(),
  getPendingSuperAdminVerificationEmail: vi.fn(),
}));

vi.mock("./auth/signOut", () => ({
  getPostSignOutUrl: vi.fn(),
  signOut: vi.fn(),
}));

import * as authService from "./authService";
import { workspaceLogin } from "./auth/workspaceLogin";
import {
  applyHttpSessionSummary,
  initAuthListener,
  refreshAuthFromSession,
} from "./auth/sessionBootstrap";
import {
  adminLoginWithSession,
  resendSuperAdminEmailChallenge,
  superAdminLogin,
  superAdminPasskeyLogin,
  verifySuperAdminEmailChallenge,
} from "./auth/privilegedLogin";
import {
  clearPendingSuperAdminVerificationEmail,
  getPendingSuperAdminChallengeToken,
  getPendingSuperAdminVerificationEmail,
} from "./auth/sessionState";
import { getPostSignOutUrl, signOut } from "./auth/signOut";

describe("authService barrel exports", () => {
  it("re-exports workspaceLogin from auth/workspaceLogin", () => {
    expect(authService.workspaceLogin).toBe(workspaceLogin);
  });

  it("re-exports session bootstrap helpers from auth/sessionBootstrap", () => {
    expect(authService.applyHttpSessionSummary).toBe(applyHttpSessionSummary);
    expect(authService.initAuthListener).toBe(initAuthListener);
    expect(authService.refreshAuthFromSession).toBe(refreshAuthFromSession);
  });

  it("re-exports privileged login helpers from auth/privilegedLogin", () => {
    expect(authService.adminLoginWithSession).toBe(adminLoginWithSession);
    expect(authService.resendSuperAdminEmailChallenge).toBe(resendSuperAdminEmailChallenge);
    expect(authService.superAdminLogin).toBe(superAdminLogin);
    expect(authService.superAdminPasskeyLogin).toBe(superAdminPasskeyLogin);
    expect(authService.verifySuperAdminEmailChallenge).toBe(verifySuperAdminEmailChallenge);
  });

  it("re-exports session state helpers from auth/sessionState", () => {
    expect(authService.clearPendingSuperAdminVerificationEmail).toBe(
      clearPendingSuperAdminVerificationEmail
    );
    expect(authService.getPendingSuperAdminChallengeToken).toBe(getPendingSuperAdminChallengeToken);
    expect(authService.getPendingSuperAdminVerificationEmail).toBe(
      getPendingSuperAdminVerificationEmail
    );
  });

  it("re-exports sign-out helpers from auth/signOut", () => {
    expect(authService.getPostSignOutUrl).toBe(getPostSignOutUrl);
    expect(authService.signOut).toBe(signOut);
  });
});
