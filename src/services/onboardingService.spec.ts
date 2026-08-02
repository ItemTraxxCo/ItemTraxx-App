import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
  resetOnboarding,
} from "./onboardingService";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("hasCompletedOnboarding", () => {
  it("returns false when no onboarding record exists", () => {
    expect(hasCompletedOnboarding("tenant_account")).toBe(false);
  });

  it("returns true after onboarding is marked completed for that role", () => {
    markOnboardingCompleted("workspace_admin");
    expect(hasCompletedOnboarding("workspace_admin")).toBe(true);
  });

  it("keeps roles independent of each other", () => {
    markOnboardingCompleted("tenant_account");
    expect(hasCompletedOnboarding("tenant_account")).toBe(true);
    expect(hasCompletedOnboarding("workspace_admin")).toBe(false);
  });

  it("returns false when localStorage access throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(hasCompletedOnboarding("tenant_account")).toBe(false);
  });
});

describe("markOnboardingCompleted", () => {
  it("stores an ISO timestamp for the role", () => {
    markOnboardingCompleted("tenant_account");
    const value = window.localStorage.getItem("itemtraxx:onboarding:v1:tenant_account");
    expect(value).not.toBeNull();
    expect(new Date(value!).toISOString()).toBe(value);
  });

  it("swallows localStorage write failures", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => markOnboardingCompleted("tenant_account")).not.toThrow();
  });
});

describe("resetOnboarding", () => {
  it("clears only the given role when one is provided", () => {
    markOnboardingCompleted("tenant_account");
    markOnboardingCompleted("workspace_admin");

    resetOnboarding("tenant_account");

    expect(hasCompletedOnboarding("tenant_account")).toBe(false);
    expect(hasCompletedOnboarding("workspace_admin")).toBe(true);
  });

  it("clears both roles when called with no argument", () => {
    markOnboardingCompleted("tenant_account");
    markOnboardingCompleted("workspace_admin");

    resetOnboarding();

    expect(hasCompletedOnboarding("tenant_account")).toBe(false);
    expect(hasCompletedOnboarding("workspace_admin")).toBe(false);
  });

  it("swallows localStorage removal failures", () => {
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => resetOnboarding("tenant_account")).not.toThrow();
  });
});
