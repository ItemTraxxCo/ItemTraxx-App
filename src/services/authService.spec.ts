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
  superAdminLogin: vi.fn(),
  superAdminPasskeyLogin: vi.fn(),
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
import { superAdminLogin, superAdminPasskeyLogin } from "./auth/privilegedLogin";
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
    expect(authService.superAdminLogin).toBe(superAdminLogin);
    expect(authService.superAdminPasskeyLogin).toBe(superAdminPasskeyLogin);
  });

  it("re-exports sign-out helpers from auth/signOut", () => {
    expect(authService.getPostSignOutUrl).toBe(getPostSignOutUrl);
    expect(authService.signOut).toBe(signOut);
  });
});
