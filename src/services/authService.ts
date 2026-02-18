import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { TimeoutError, withTimeout } from "./asyncUtils";
import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  markAdminVerified,
  setAuthStateFromBackend,
  setSecondaryAuth,
  setTenantContext,
} from "../store/authState";

type ProfileRow = {
  id: string;
  role: "tenant_user" | "tenant_admin" | "super_admin" | null;
  tenant_id: string | null;
  auth_email: string | null;
  is_active?: boolean | null;
};

type TenantRow = {
  id: string;
  status: "active" | "suspended" | null;
};

const getTenantLoginFunctionName = () =>
  import.meta.env.VITE_TENANT_LOGIN_FUNCTION || "tenant-login";

const AUTH_QUERY_TIMEOUT_MS = 7000;

const fetchProfile = async (userId: string): Promise<ProfileRow | null> => {
  let data: unknown = null;
  let error: unknown = null;
  try {
    const response = await withTimeout(
      supabase
        .from("profiles")
        .select("id, role, tenant_id, auth_email, is_active")
        .eq("id", userId)
        .single(),
      AUTH_QUERY_TIMEOUT_MS,
      "Profile lookup timed out."
    );
    data = response.data;
    error = response.error;
  } catch (requestError) {
    console.error("Profile lookup failed:", requestError);
    return null;
  }

  if (error) {
    return null;
  }

  return data as ProfileRow;
};

const fetchTenantStatus = async (tenantId: string): Promise<TenantRow | null> => {
  let data: unknown = null;
  let error: unknown = null;
  try {
    const response = await withTimeout(
      supabase
        .from("tenants")
        .select("id, status")
        .eq("id", tenantId)
        .single(),
      AUTH_QUERY_TIMEOUT_MS,
      "Tenant status lookup timed out."
    );
    data = response.data;
    error = response.error;
  } catch (requestError) {
    console.error("Tenant status lookup failed:", requestError);
    return null;
  }

  if (error) return null;
  return data as TenantRow;
};

const handleSuspendedTenantSession = async (profile: ProfileRow | null) => {
  if (!profile?.tenant_id || !["tenant_user", "tenant_admin"].includes(profile.role ?? "")) {
    return false;
  }
  const tenant = await fetchTenantStatus(profile.tenant_id);
  if (tenant?.status === "suspended") {
    await supabase.auth.signOut();
    clearAdminVerification();
    clearAuthState(true);
    return true;
  }
  return false;
};

export const refreshAuthFromSession = async () => {
  let data: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"] | null =
    null;
  let error: Awaited<ReturnType<typeof supabase.auth.getSession>>["error"] | null =
    null;
  try {
    const response = await withTimeout(
      supabase.auth.getSession(),
      AUTH_QUERY_TIMEOUT_MS,
      "Session refresh timed out."
    );
    data = response.data;
    error = response.error;
  } catch (requestError) {
    console.error("Session refresh failed:", requestError);
    clearAuthState(true);
    return;
  }

  if (error || !data.session) {
    clearAuthState(true);
    return;
  }

  const userId = data.session.user.id;
  const email = data.session.user.email ?? null;
  const signedInAt = data.session.user.last_sign_in_at ?? null;
  const profile = await fetchProfile(userId);
  const isSuspended = await handleSuspendedTenantSession(profile);
  if (isSuspended) {
    return;
  }
  const current = getAuthState();
  const isSameUser = current.userId === userId;
  const isSuperRole = profile?.role === "super_admin";

  setAuthStateFromBackend({
    isInitialized: true,
    isAuthenticated: true,
    userId,
    email,
    signedInAt,
    role: profile?.role ?? null,
    sessionTenantId: profile?.tenant_id ?? null,
    tenantContextId:
      current.tenantContextId ?? profile?.tenant_id ?? null,
    hasSecondaryAuth:
      isSameUser && isSuperRole ? current.hasSecondaryAuth ?? false : false,
    superVerifiedAt:
      isSameUser && isSuperRole ? current.superVerifiedAt ?? null : null,
  });
};

export const initAuthListener = () => {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      clearAuthState(true);
      return;
    }
    const profile = await fetchProfile(session.user.id);
    const isSuspended = await handleSuspendedTenantSession(profile);
    if (isSuspended) {
      return;
    }
    const current = getAuthState();
    const isSameUser = current.userId === session.user.id;
    const isSuperRole = profile?.role === "super_admin";
    setAuthStateFromBackend({
      isInitialized: true,
      isAuthenticated: true,
      userId: session.user.id,
      email: session.user.email ?? null,
      signedInAt: session.user.last_sign_in_at ?? null,
      role: profile?.role ?? null,
      sessionTenantId: profile?.tenant_id ?? null,
      tenantContextId:
        current.tenantContextId ?? profile?.tenant_id ?? null,
      hasSecondaryAuth:
        isSameUser && isSuperRole ? current.hasSecondaryAuth ?? false : false,
      superVerifiedAt:
        isSameUser && isSuperRole ? current.superVerifiedAt ?? null : null,
    });
  });
};

export const tenantLogin = async (
  accessCode: string,
  password: string,
  turnstileToken?: string
) => {
  const functionName = getTenantLoginFunctionName();
  const result = await invokeEdgeFunction<{ auth_email?: string }, {
    access_code: string;
    turnstile_token?: string;
  }>(functionName, {
    method: "POST",
    body: {
      access_code: accessCode,
      ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
    },
  });

  if (!result.ok) {
    if (result.status === 503 && result.error.toLowerCase().includes("maintenance")) {
      throw new Error("MAINTENANCE_MODE");
    }
    if (result.status === 503 && result.error === "Rate limit check failed") {
      throw new Error("LIMITER_UNAVAILABLE");
    }
    if (result.status === 403 && result.error === "Turnstile verification failed") {
      throw new Error("TURNSTILE_FAILED");
    }
    if (result.status === 403 && result.error === "Tenant disabled") {
      throw new Error("TENANT_DISABLED");
    }
    throw new Error("Invalid tenant access code.");
  }

  const data = result.data;
  if (!data?.auth_email) {
    throw new Error("Invalid tenant access code.");
  }

  let signInError: unknown = null;
  try {
    const signIn = await withTimeout(
      supabase.auth.signInWithPassword({
        email: data.auth_email,
        password,
      }),
      AUTH_QUERY_TIMEOUT_MS,
      "Sign in timed out."
    );
    signInError = signIn.error;
  } catch (requestError) {
    if (requestError instanceof TimeoutError) {
      throw new Error("Sign in timed out. Please try again.");
    }
    throw requestError;
  }

  if (signInError) {
    throw new Error("Invalid credentials.");
  }

  await refreshAuthFromSession();
  const current = getAuthState();
  setTenantContext(current.sessionTenantId ?? null);
};

export const adminLogin = async (email: string, password: string) => {
  const priorTenantContextId = getAuthState().tenantContextId;
  let error: unknown = null;
  try {
    const signIn = await withTimeout(
      supabase.auth.signInWithPassword({
        email,
        password,
      }),
      AUTH_QUERY_TIMEOUT_MS,
      "Sign in timed out."
    );
    error = signIn.error;
  } catch (requestError) {
    if (requestError instanceof TimeoutError) {
      throw new Error("Sign in timed out. Please try again.");
    }
    throw requestError;
  }

  if (error) {
    throw new Error("Invalid credentials.");
  }

  await refreshAuthFromSession();
  const profile = await fetchProfile(getAuthState().userId ?? "");
  const current = getAuthState();
  if (current.role !== "tenant_admin") {
    await signOut();
    throw new Error("Access denied.");
  }
  if (profile && profile.is_active === false) {
    await signOut();
    throw new Error("Access denied.");
  }
  if (profile?.tenant_id) {
    const tenant = await fetchTenantStatus(profile.tenant_id);
    if (tenant?.status === "suspended") {
      await signOut();
      throw new Error("Tenant disabled.");
    }
  }

  if (priorTenantContextId && current.sessionTenantId !== priorTenantContextId) {
    await signOut();
    throw new Error("Access denied.");
  }

  if (!current.tenantContextId) {
    setTenantContext(current.sessionTenantId ?? null);
  }
  markAdminVerified();
};

export const superAdminLogin = async (email: string, password: string) => {
  let error: unknown = null;
  try {
    const signIn = await withTimeout(
      supabase.auth.signInWithPassword({
        email,
        password,
      }),
      AUTH_QUERY_TIMEOUT_MS,
      "Sign in timed out."
    );
    error = signIn.error;
  } catch (requestError) {
    if (requestError instanceof TimeoutError) {
      throw new Error("Sign in timed out. Please try again.");
    }
    throw requestError;
  }

  if (error) {
    throw new Error("Invalid credentials.");
  }

  await refreshAuthFromSession();
  const current = getAuthState();
  if (current.role !== "super_admin") {
    await signOut();
    throw new Error("Access denied.");
  }

  setSecondaryAuth(true);
};

export const signOut = async () => {
  await supabase.auth.signOut();
  clearAdminVerification();
  clearAuthState(true);
};
