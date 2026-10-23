import type { AuthState } from "../store/authState";

export type OfflinePackDownloadPreference = "manual" | "ask" | "always";

export type OfflinePackPreferenceScope = {
  workspaceId: string;
  profileId: string;
};

const PREFERENCE_PREFIX = "itemtraxx:offline-pack-preference:v1";
const SESSION_APPROVAL_PREFIX = "itemtraxx:offline-pack-approved:v1";
const SESSION_PROMPT_PREFIX = "itemtraxx:offline-pack-prompted:v1";
const DEFAULT_PREFERENCE: OfflinePackDownloadPreference = "ask";

const preferenceKey = ({ workspaceId, profileId }: OfflinePackPreferenceScope) =>
  `${PREFERENCE_PREFIX}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(profileId)}`;

export const getOfflinePackDownloadPreference = (scope: OfflinePackPreferenceScope): OfflinePackDownloadPreference => {
  try {
    const value = window.localStorage.getItem(preferenceKey(scope));
    return value === "manual" || value === "ask" || value === "always"
      ? value
      : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
};

export const setOfflinePackDownloadPreference = (
  scope: OfflinePackPreferenceScope,
  value: OfflinePackDownloadPreference,
) => {
  try {
    window.localStorage.setItem(preferenceKey(scope), value);
  } catch {
    // Preferences are device-local; storage failure should not block account settings.
  }
  window.dispatchEvent(new CustomEvent("itemtraxx:offline-pack-preference-changed", {
    detail: { ...scope, preference: value },
  }));
};

export const getOfflinePackSignInKey = (auth: Pick<AuthState, "workspaceContextId" | "userId" | "signedInAt">) => {
  if (!auth.workspaceContextId || !auth.userId) return null;
  const signedInAt = auth.signedInAt?.trim() || "restored-session";
  return `${encodeURIComponent(auth.workspaceContextId)}:${encodeURIComponent(auth.userId)}:${encodeURIComponent(signedInAt)}`;
};

const sessionKey = (prefix: string, signInKey: string) => `${prefix}:${signInKey}`;

export const hasOfflinePackPromptedForSignIn = (signInKey: string) => {
  try {
    return window.sessionStorage.getItem(sessionKey(SESSION_PROMPT_PREFIX, signInKey)) === "yes";
  } catch {
    return false;
  }
};

export const markOfflinePackPromptedForSignIn = (signInKey: string) => {
  try {
    window.sessionStorage.setItem(sessionKey(SESSION_PROMPT_PREFIX, signInKey), "yes");
  } catch {
    // The live component still guarantees a single prompt for this mount.
  }
};

export const approveOfflinePackForSignIn = (signInKey: string) => {
  try {
    window.sessionStorage.setItem(sessionKey(SESSION_APPROVAL_PREFIX, signInKey), "yes");
  } catch {
    // Without a stored approval, later automatic refreshes fail closed.
  }
};

export const isOfflinePackAutomaticDownloadAllowed = (
  auth: Pick<AuthState, "workspaceContextId" | "userId" | "signedInAt">,
) => {
  if (!auth.workspaceContextId || !auth.userId) return false;
  const scope = { workspaceId: auth.workspaceContextId, profileId: auth.userId };
  const preference = getOfflinePackDownloadPreference(scope);
  if (preference === "always") return true;
  if (preference === "manual") return false;
  const key = getOfflinePackSignInKey(auth);
  if (!key) return false;
  try {
    return window.sessionStorage.getItem(sessionKey(SESSION_APPROVAL_PREFIX, key)) === "yes";
  } catch {
    return false;
  }
};
