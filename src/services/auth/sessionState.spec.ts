import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingSuperAdminVerificationEmail,
  getPendingSuperAdminChallengeToken,
  getPendingSuperAdminVerificationEmail,
  setPendingSuperAdminChallengeToken,
  setPendingSuperAdminVerificationEmail,
} from "./sessionState";

describe("pending super-admin verification state", () => {
  afterEach(() => {
    clearPendingSuperAdminVerificationEmail();
  });

  it("stores and retrieves the pending verification email", () => {
    expect(getPendingSuperAdminVerificationEmail()).toBeNull();
    setPendingSuperAdminVerificationEmail("admin@example.com");
    expect(getPendingSuperAdminVerificationEmail()).toBe("admin@example.com");
  });

  it("stores and retrieves the pending challenge token", () => {
    expect(getPendingSuperAdminChallengeToken()).toBeNull();
    setPendingSuperAdminChallengeToken("challenge-123");
    expect(getPendingSuperAdminChallengeToken()).toBe("challenge-123");
  });

  it("clears both the email and the challenge token together", () => {
    setPendingSuperAdminVerificationEmail("admin@example.com");
    setPendingSuperAdminChallengeToken("challenge-123");

    clearPendingSuperAdminVerificationEmail();

    expect(getPendingSuperAdminVerificationEmail()).toBeNull();
    expect(getPendingSuperAdminChallengeToken()).toBeNull();
  });

  it("can set the email or token back to null explicitly", () => {
    setPendingSuperAdminVerificationEmail("admin@example.com");
    setPendingSuperAdminVerificationEmail(null);
    expect(getPendingSuperAdminVerificationEmail()).toBeNull();

    setPendingSuperAdminChallengeToken("challenge-123");
    setPendingSuperAdminChallengeToken(null);
    expect(getPendingSuperAdminChallengeToken()).toBeNull();
  });
});
