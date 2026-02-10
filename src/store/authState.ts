import { reactive } from "vue";

export type UserRole = "tenant_user" | "tenant_admin" | "super_admin";

export type AuthState = {
  isInitialized: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  signedInAt: string | null;
  role: UserRole | null;
  sessionTenantId: string | null;
  tenantContextId: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  hasSecondaryAuth: boolean;
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
  isAdmin: false,
  isSuperAdmin: false,
  hasSecondaryAuth: false,
};

const authState = reactive<AuthState>({ ...defaultState });

export const getAuthState = (): AuthState => authState;

export const setAuthStateFromBackend = (next: Partial<AuthState>) => {
  Object.assign(authState, next, {
    isAdmin: next.role === "tenant_admin",
    isSuperAdmin: next.role === "super_admin",
  });
};

export const setTenantContext = (tenantId: string | null) => {
  authState.tenantContextId = tenantId;
};

export const setSecondaryAuth = (value: boolean) => {
  authState.hasSecondaryAuth = value;
};

export const clearAuthState = (markInitialized = false) => {
  Object.assign(authState, {
    ...defaultState,
    isInitialized: markInitialized ? true : defaultState.isInitialized,
  });
};
