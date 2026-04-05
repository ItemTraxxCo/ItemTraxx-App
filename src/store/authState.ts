import { reactive } from "vue";

export type UserRole = "tenant_user" | "tenant_admin" | "district_admin" | "super_admin";

export type AuthState = {
  isInitialized: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  signedInAt: string | null;
  role: UserRole | null;
  sessionTenantId: string | null;
  tenantContextId: string | null;
  districtContextId: string | null;
  isAdmin: boolean;
  isDistrictAdmin: boolean;
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
  sessionTenantId: null,
  tenantContextId: null,
  districtContextId: null,
  isAdmin: false,
  isDistrictAdmin: false,
  isSuperAdmin: false,
  hasSecondaryAuth: false,
  superVerifiedAt: null,
  adminVerifiedAt: null,
};

const authState = reactive<AuthState>({ ...defaultState });

export const getAuthState = (): AuthState => authState;

export const setAuthStateFromBackend = (next: Partial<AuthState>) => {
  Object.assign(authState, next, {
    isAdmin: next.role === "tenant_admin",
    isDistrictAdmin: next.role === "district_admin",
    isSuperAdmin: next.role === "super_admin",
  });
};

export const setTenantContext = (tenantId: string | null) => {
  authState.tenantContextId = tenantId;
};

export const setDistrictContext = (districtId: string | null) => {
  authState.districtContextId = districtId;
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
