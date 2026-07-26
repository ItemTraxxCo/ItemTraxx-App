type WorkspaceOnboardingRole = "tenant_account" | "workspace_admin";

const ONBOARDING_VERSION = "v1";
const ONBOARDING_KEY_PREFIX = `itemtraxx:onboarding:${ONBOARDING_VERSION}`;

const safeGetItem = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSetItem = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore localStorage failures (private mode / blocked storage).
  }
};

const safeRemoveItem = (key: string) => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore localStorage failures (private mode / blocked storage).
  }
};

const getOnboardingKey = (role: WorkspaceOnboardingRole) =>
  `${ONBOARDING_KEY_PREFIX}:${role}`;

export const hasCompletedOnboarding = (role: WorkspaceOnboardingRole): boolean => {
  const value = safeGetItem(getOnboardingKey(role));
  return typeof value === "string" && value.trim().length > 0;
};

export const markOnboardingCompleted = (role: WorkspaceOnboardingRole): void => {
  safeSetItem(getOnboardingKey(role), new Date().toISOString());
};

export const resetOnboarding = (role?: WorkspaceOnboardingRole): void => {
  if (role) {
    safeRemoveItem(getOnboardingKey(role));
    return;
  }
  safeRemoveItem(getOnboardingKey("tenant_account"));
  safeRemoveItem(getOnboardingKey("workspace_admin"));
};

export type { WorkspaceOnboardingRole };
