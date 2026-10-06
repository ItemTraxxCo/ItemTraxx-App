import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveOfflinePackForSignIn,
  getOfflinePackDownloadPreference,
  getOfflinePackSignInKey,
  isOfflinePackAutomaticDownloadAllowed,
  setOfflinePackDownloadPreference,
} from "./offlineCheckoutPreferences";

const scope = { workspaceId: "workspace-1", profileId: "profile-1" };
const auth = {
  isInitialized: true,
  isAuthenticated: true,
  userId: scope.profileId,
  email: null,
  signedInAt: "2026-10-03T12:00:00.000Z",
  role: "tenant_account" as const,
  sessionWorkspaceId: scope.workspaceId,
  workspaceContextId: scope.workspaceId,
  isAdmin: false,
  isWorkspaceAdmin: false,
  isSuperAdmin: false,
  hasSecondaryAuth: false,
  superVerifiedAt: null,
  adminVerifiedAt: null,
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("offline pack download preferences", () => {
  it("defaults to ask and keeps choices scoped to the account", () => {
    expect(getOfflinePackDownloadPreference(scope)).toBe("ask");
    setOfflinePackDownloadPreference(scope, "manual");
    expect(getOfflinePackDownloadPreference(scope)).toBe("manual");
    expect(getOfflinePackDownloadPreference({ ...scope, profileId: "profile-2" })).toBe("ask");
  });

  it("only permits automatic downloads for always or a current sign-in approval", () => {
    expect(isOfflinePackAutomaticDownloadAllowed(auth)).toBe(false);

    setOfflinePackDownloadPreference(scope, "always");
    expect(isOfflinePackAutomaticDownloadAllowed(auth)).toBe(true);

    setOfflinePackDownloadPreference(scope, "ask");
    expect(isOfflinePackAutomaticDownloadAllowed(auth)).toBe(false);
    const signInKey = getOfflinePackSignInKey(auth)!;
    approveOfflinePackForSignIn(signInKey);
    expect(isOfflinePackAutomaticDownloadAllowed(auth)).toBe(true);

    expect(isOfflinePackAutomaticDownloadAllowed({ ...auth, signedInAt: "2026-10-03T12:01:00.000Z" })).toBe(false);
    setOfflinePackDownloadPreference(scope, "manual");
    expect(isOfflinePackAutomaticDownloadAllowed(auth)).toBe(false);
  });
});
