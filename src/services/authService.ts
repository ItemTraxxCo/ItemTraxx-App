import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
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
};

const getTenantLoginFunctionName = () =>
  import.meta.env.VITE_TENANT_LOGIN_FUNCTION || "tenant-login";

const fetchProfile = async (userId: string): Promise<ProfileRow | null> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, tenant_id, auth_email")
    .eq("id", userId)
    .single();

  if (error) {
    return null;
  }

  return data as ProfileRow;
};

export const refreshAuthFromSession = async () => {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    clearAuthState(true);
    return;
  }

  const userId = data.session.user.id;
  const email = data.session.user.email ?? null;
  const signedInAt = data.session.user.last_sign_in_at ?? null;
  const profile = await fetchProfile(userId);
  const current = getAuthState();

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
    hasSecondaryAuth: current.hasSecondaryAuth ?? false,
  });
};

export const initAuthListener = () => {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      clearAuthState(true);
      return;
    }
    const profile = await fetchProfile(session.user.id);
    const current = getAuthState();
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
      hasSecondaryAuth: current.hasSecondaryAuth ?? false,
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
    if (result.status === 503 && result.error === "Rate limit check failed") {
      throw new Error("LIMITER_UNAVAILABLE");
    }
    if (result.status === 403 && result.error === "Turnstile verification failed") {
      throw new Error("TURNSTILE_FAILED");
    }
    throw new Error("Invalid tenant access code.");
  }

  const data = result.data;
  if (!data?.auth_email) {
    throw new Error("Invalid tenant access code.");
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: data.auth_email,
    password,
  });

  if (signInError) {
    throw new Error("Invalid credentials.");
  }

  await refreshAuthFromSession();
  const current = getAuthState();
  setTenantContext(current.sessionTenantId ?? null);
};

export const adminLogin = async (email: string, password: string) => {
  const priorTenantContextId = getAuthState().tenantContextId;
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error("Invalid credentials.");
  }

  await refreshAuthFromSession();
  const current = getAuthState();
  if (current.role !== "tenant_admin") {
    await signOut();
    throw new Error("Access denied.");
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
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

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
