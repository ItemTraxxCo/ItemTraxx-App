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
const getLoginNotifyFunctionName = () =>
  import.meta.env.VITE_LOGIN_NOTIFY_FUNCTION || "login-notify";

const AUTH_QUERY_TIMEOUT_MS = 15000;

const withRetry = async <T>(
  fn: () => Promise<T>,
  attempts = 2,
  delayMs = 250
): Promise<T> => {
  let lastError: unknown = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (index + 1 >= attempts) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
};

const toKnownRole = (value: unknown): ProfileRow["role"] => {
  if (value === "tenant_user" || value === "tenant_admin" || value === "super_admin") {
    return value;
  }
  return null;
};

const fetchCurrentRoleAndTenant = async () => {
  const [roleResult, tenantResult] = await Promise.all([
    withRetry(
      () =>
        withTimeout(
          supabase.rpc("current_user_role"),
          AUTH_QUERY_TIMEOUT_MS,
          "Role lookup timed out."
        ),
      2
    ),
    withRetry(
      () =>
        withTimeout(
          supabase.rpc("current_tenant_id"),
          AUTH_QUERY_TIMEOUT_MS,
          "Tenant lookup timed out."
        ),
      2
    ),
  ]);

  return {
    role: toKnownRole(roleResult.data),
    tenantId:
      typeof tenantResult.data === "string" && tenantResult.data.trim()
        ? tenantResult.data
        : null,
  };
};

const fetchProfile = async (userId: string): Promise<ProfileRow | null> => {
  let data: unknown = null;
  let error: unknown = null;
  try {
    const response = await withRetry(
      () =>
        withTimeout(
          supabase
            .from("profiles")
            .select("id, role, tenant_id, auth_email, is_active")
            .eq("id", userId)
            .single(),
          AUTH_QUERY_TIMEOUT_MS,
          "Profile lookup timed out."
        ),
      2
    );
    data = response.data;
    error = response.error;
  } catch (requestError) {
    console.error("Profile lookup failed:", requestError);
    try {
      // Fallback path when direct profile select is flaky/timeouts: use definer RPCs.
      const { role, tenantId } = await fetchCurrentRoleAndTenant();
      if (!role && !tenantId) {
        return null;
      }
      return {
        id: userId,
        role,
        tenant_id: tenantId,
        auth_email: null,
        is_active: null,
      };
    } catch (fallbackError) {
      console.error("Profile fallback lookup failed:", fallbackError);
      return null;
    }
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
    const response = await withRetry(
      () =>
        withTimeout(
          supabase
            .from("tenants")
            .select("id, status")
            .eq("id", tenantId)
            .single(),
          AUTH_QUERY_TIMEOUT_MS,
          "Tenant status lookup timed out."
        ),
      2
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
  const resolvedRole = profile?.role ?? (isSameUser ? current.role : null);
  const resolvedSessionTenantId =
    profile?.tenant_id ?? (isSameUser ? current.sessionTenantId : null);
  const isSuperRole = resolvedRole === "super_admin";

  setAuthStateFromBackend({
    isInitialized: true,
    isAuthenticated: true,
    userId,
    email,
    signedInAt,
    role: resolvedRole,
    sessionTenantId: resolvedSessionTenantId,
    tenantContextId:
      current.tenantContextId ?? resolvedSessionTenantId ?? null,
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
    const resolvedRole = profile?.role ?? (isSameUser ? current.role : null);
    const resolvedSessionTenantId =
      profile?.tenant_id ?? (isSameUser ? current.sessionTenantId : null);
    const isSuperRole = resolvedRole === "super_admin";
    setAuthStateFromBackend({
      isInitialized: true,
      isAuthenticated: true,
      userId: session.user.id,
      email: session.user.email ?? null,
      signedInAt: session.user.last_sign_in_at ?? null,
      role: resolvedRole,
      sessionTenantId: resolvedSessionTenantId,
      tenantContextId:
        current.tenantContextId ?? resolvedSessionTenantId ?? null,
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
  let accessToken: string | null = null;
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
    accessToken = signIn.data.session?.access_token ?? null;
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

  if (accessToken) {
    const loginNotifyFunctionName = getLoginNotifyFunctionName();
    void invokeEdgeFunction(loginNotifyFunctionName, {
      method: "POST",
      accessToken,
      body: {},
    }).then((result) => {
      if (!result.ok) {
        console.warn("login notification send failed", {
          status: result.status,
          error: result.error,
          requestId: result.requestId,
        });
      }
    });
  }
};

export const adminLogin = async (email: string, password: string) => {
  const priorTenantContextId = getAuthState().tenantContextId;
  let error: unknown = null;
  let signedInUser:
    | { id: string; email?: string | null; last_sign_in_at?: string | null }
    | null = null;
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
    signedInUser =
      (signIn.data.user as { id: string; email?: string | null; last_sign_in_at?: string | null } | null) ??
      (signIn.data.session?.user as { id: string; email?: string | null; last_sign_in_at?: string | null } | null) ??
      null;
  } catch (requestError) {
    if (requestError instanceof TimeoutError) {
      throw new Error("Sign in timed out. Please try again.");
    }
    throw requestError;
  }

  if (error || !signedInUser?.id) {
    throw new Error("Invalid credentials.");
  }

  const current = getAuthState();
  let profile = await fetchProfile(signedInUser.id);
  let fallbackRole: ProfileRow["role"] = null;
  let fallbackTenantId: string | null = null;
  let resolvedRole = profile?.role ?? null;
  let resolvedTenantId = profile?.tenant_id ?? null;

  if (!resolvedRole || !resolvedTenantId) {
    try {
      const fallback = await fetchCurrentRoleAndTenant();
      fallbackRole = fallback.role;
      fallbackTenantId = fallback.tenantId;
      resolvedRole = resolvedRole ?? fallbackRole ?? null;
      resolvedTenantId = resolvedTenantId ?? fallbackTenantId ?? null;
    } catch {
      // Ignore fallback failure and continue with best available values.
    }
  }

  if (!resolvedRole) {
    resolvedRole = current.role ?? null;
  }
  if (resolvedRole !== "tenant_admin") {
    await signOut();
    throw new Error("Access denied.");
  }
  if (profile && profile.is_active === false) {
    await signOut();
    throw new Error("Access denied.");
  }
  if (resolvedTenantId) {
    const tenant = await fetchTenantStatus(resolvedTenantId);
    if (tenant?.status === "suspended") {
      await signOut();
      throw new Error("Tenant disabled.");
    }
  }

  if (
    priorTenantContextId &&
    resolvedTenantId &&
    resolvedTenantId !== priorTenantContextId
  ) {
    await signOut();
    throw new Error("Access denied.");
  }

  const finalTenantId = resolvedTenantId ?? current.sessionTenantId ?? fallbackTenantId ?? null;
  setAuthStateFromBackend({
    isInitialized: true,
    isAuthenticated: true,
    userId: signedInUser.id,
    email: signedInUser.email ?? null,
    signedInAt: signedInUser.last_sign_in_at ?? null,
    role: resolvedRole,
    sessionTenantId: finalTenantId,
    tenantContextId: current.tenantContextId ?? finalTenantId ?? null,
    hasSecondaryAuth: false,
    superVerifiedAt: null,
  });

  if (!getAuthState().tenantContextId) {
    setTenantContext(finalTenantId);
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
