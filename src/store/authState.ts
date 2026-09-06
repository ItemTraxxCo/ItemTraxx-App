import { reactive } from "vue";

type UserRole = "tenant_account" | "workspace_admin" | "super_admin";

export type AuthState = {
  isInitialized: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  signedInAt: string | null;
  role: UserRole | null;
  sessionWorkspaceId: string | null;
  workspaceContextId: string | null;
  isAdmin: boolean;
  isWorkspaceAdmin: boolean;
  isSuperAdmin: boolean;
  hasSecondaryAuth: boolean;
  superVerifiedAt: string | null;
  adminVerifiedAt: string | null;
};

const ADMIN_VERIFICATION_STORAGE_KEY = "itemtraxx:admin-verification";

type PersistedAdminVerification = {
  userId: string;
  verifiedAt: string;
};

const readPersistedAdminVerification = (): PersistedAdminVerification | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ADMIN_VERIFICATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAdminVerification>;
    if (typeof parsed.userId !== "string" || typeof parsed.verifiedAt !== "string") {
      return null;
    }
    return { userId: parsed.userId, verifiedAt: parsed.verifiedAt };
  } catch {
    return null;
  }
};

const writePersistedAdminVerification = (value: PersistedAdminVerification | null) => {
  if (typeof window === "undefined") return;
  try {
    if (!value) {
      window.sessionStorage.removeItem(ADMIN_VERIFICATION_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(ADMIN_VERIFICATION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore sessionStorage failures.
  }
};

const defaultState: AuthState = {
  isInitialized: false,
  isAuthenticated: false,
  userId: null,
  email: null,
  signedInAt: null,
  role: null,
  sessionWorkspaceId: null,
  workspaceContextId: null,
  isAdmin: false,
  isWorkspaceAdmin: false,
  isSuperAdmin: false,
  hasSecondaryAuth: false,
  superVerifiedAt: null,
  adminVerifiedAt: null,
};

const authState = reactive<AuthState>({ ...defaultState });

export const getAuthState = (): AuthState => authState;

type AuthStateBackendPatch = Partial<
  Omit<AuthState, "isAdmin" | "isWorkspaceAdmin" | "isSuperAdmin">
>;

export const setAuthStateFromBackend = (next: AuthStateBackendPatch) => {
  // Keep derived flags out of the merge even if a JavaScript caller bypasses
  // the TypeScript boundary. They must never be accepted as backend data.
  const backendPatch = { ...next } as Partial<AuthState>;
  delete backendPatch.isAdmin;
  delete backendPatch.isWorkspaceAdmin;
  delete backendPatch.isSuperAdmin;
  Object.assign(authState, backendPatch);

  // Role-derived flags are only authoritative when the backend patch includes
  // a role. Partial updates (for example, refreshing a session timestamp) must
  // not infer a missing role as "no role" and silently clear existing access.
  if (Object.prototype.hasOwnProperty.call(next, "role") && next.role !== undefined) {
    authState.isAdmin = next.role === "workspace_admin";
    authState.isWorkspaceAdmin = next.role === "workspace_admin";
    authState.isSuperAdmin = next.role === "super_admin";
  }
};

export const setWorkspaceContext = (workspaceId: string | null) => {
  authState.workspaceContextId = workspaceId;
};

export const setSecondaryAuth = (value: boolean) => {
  authState.hasSecondaryAuth = value;
  authState.superVerifiedAt = value ? new Date().toISOString() : null;
};

export const getPersistedAdminVerification = (userId: string | null) => {
  if (!userId) return null;
  const persisted = readPersistedAdminVerification();
  if (!persisted || persisted.userId !== userId) {
    return null;
  }
  return persisted.verifiedAt;
};

export const markAdminVerified = () => {
  const verifiedAt = new Date().toISOString();
  authState.adminVerifiedAt = verifiedAt;
  if (authState.userId) {
    writePersistedAdminVerification({ userId: authState.userId, verifiedAt });
  }
};

export const clearAdminVerification = () => {
  authState.adminVerifiedAt = null;
  writePersistedAdminVerification(null);
};

export const clearAuthState = (markInitialized = false) => {
  Object.assign(authState, {
    ...defaultState,
    isInitialized: markInitialized ? true : defaultState.isInitialized,
  });
};
