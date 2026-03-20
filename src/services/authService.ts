import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getFreshAccessToken } from "./sessionAccessToken";
import { TimeoutError, withTimeout } from "./asyncUtils";
import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  markAdminVerified,
  setDistrictContext,
  setAuthStateFromBackend,
  setSecondaryAuth,
  setTenantContext,
} from "../store/authState";
import { getDistrictState } from "../store/districtState";
import { lookupDistrictById, resolveDistrictHost } from "./districtService";

type ProfileRow = {
  id: string;
  role: "tenant_user" | "tenant_admin" | "district_admin" | "super_admin" | null;
  tenant_id: string | null;
  district_id?: string | null;
  auth_email: string | null;
  is_active?: boolean | null;
};

type TenantRow = {
  id: string;
  status: "active" | "suspended" | "archived" | null;
  district_id?: string | null;
};

const getTenantLoginFunctionName = () =>
  import.meta.env.VITE_TENANT_LOGIN_FUNCTION || "tenant-login";
const getLoginNotifyFunctionName = () =>
  import.meta.env.VITE_LOGIN_NOTIFY_FUNCTION || "login-notify";
const getDistrictHandoffFunctionName = () =>
  import.meta.env.VITE_DISTRICT_HANDOFF_FUNCTION || "district-handoff";

const AUTH_QUERY_TIMEOUT_MS = 15000;
const DISTRICT_HANDOFF_MARKER_KEY = "itemtraxx:district-handoff-at";
const SUPER_ADMIN_2FA_FUNCTION = import.meta.env.VITE_SUPER_ADMIN_2FA_FUNCTION || "super-auth-verify";
const SUPER_ADMIN_2FA_PENDING_EMAIL_KEY = "itemtraxx:super-admin-2fa-email";

const sendLoginNotification = (accessToken: string | null) => {
  if (!accessToken) return;
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
};


const setPendingSuperAdminVerificationEmail = (email: string | null) => {
  if (typeof window === "undefined") return;
  try {
    if (email) {
      window.sessionStorage.setItem(SUPER_ADMIN_2FA_PENDING_EMAIL_KEY, email);
    } else {
      window.sessionStorage.removeItem(SUPER_ADMIN_2FA_PENDING_EMAIL_KEY);
    }
  } catch {
    // Ignore sessionStorage failures.
  }
};

export const getPendingSuperAdminVerificationEmail = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SUPER_ADMIN_2FA_PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
};

export const clearPendingSuperAdminVerificationEmail = () => {
  setPendingSuperAdminVerificationEmail(null);
};

export const resendSuperAdminEmailChallenge = async () => {
  const accessToken = await getFreshAccessToken();
  const result = await invokeEdgeFunction<{ challenge_started?: boolean; email?: string | null }>(
    SUPER_ADMIN_2FA_FUNCTION,
    {
      method: "POST",
      accessToken,
      body: { action: "resend_email_challenge" },
    }
  );

  if (!result.ok || !result.data?.challenge_started) {
    throw new Error(result.error || "Unable to send verification code.");
  }

  const recipientEmail = result.data.email ?? null;
  setPendingSuperAdminVerificationEmail(recipientEmail);
  return { email: recipientEmail };
};

export const verifySuperAdminEmailChallenge = async (code: string) => {
  const accessToken = await getFreshAccessToken();
  const result = await invokeEdgeFunction<{ verified?: boolean }>(SUPER_ADMIN_2FA_FUNCTION, {
    method: "POST",
    accessToken,
    body: {
      action: "verify_email_challenge",
      payload: { code },
    },
  });

  if (!result.ok || !result.data?.verified) {
    throw new Error(result.error || "Unable to verify code.");
  }

  setSecondaryAuth(true);
  sendLoginNotification(accessToken);
  clearPendingSuperAdminVerificationEmail();
};

const clearLocalSession = async () => {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Ignore local storage cleanup failures during handoff.
  }
};

const setSessionFromTokens = async (accessToken: string, refreshToken: string) => {
  const sessionResult = await withTimeout(
    supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    }),
    AUTH_QUERY_TIMEOUT_MS,
    "Sign in timed out."
  );

  if (sessionResult.error || !sessionResult.data.session?.access_token) {
    throw new Error("Invalid credentials.");
  }

  return sessionResult.data.session;
};

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
  if (
    value === "tenant_user" ||
    value === "tenant_admin" ||
    value === "district_admin" ||
    value === "super_admin"
  ) {
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
            .select("id, role, tenant_id, district_id, auth_email, is_active")
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
        district_id: null,
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

const fetchTenantContext = async (tenantId: string): Promise<TenantRow | null> => {
  let data: unknown = null;
  let error: unknown = null;
  try {
    const response = await withRetry(
      () =>
        withTimeout(
          supabase
            .from("tenants")
            .select("id, status, district_id")
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

const resolveEffectiveDistrictId = async (profile: ProfileRow | null) => {
  if (profile?.district_id) {
    return profile.district_id;
  }
  if (!profile?.tenant_id) {
    return null;
  }
  const tenant = await fetchTenantContext(profile.tenant_id);
  return tenant?.district_id ?? null;
};

const resolveDistrictSlug = async (districtId: string | null) => {
  if (!districtId) {
    return null;
  }
  const district = await lookupDistrictById(districtId);
  return district?.slug?.trim() || null;
};

const handleSuspendedTenantSession = async (profile: ProfileRow | null) => {
  if (!profile?.tenant_id || !["tenant_user", "tenant_admin"].includes(profile.role ?? "")) {
    return false;
  }
  const tenant = await fetchTenantContext(profile.tenant_id);
  if (tenant?.status && tenant.status !== "active") {
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
  const effectiveDistrictId = await resolveEffectiveDistrictId(profile);
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
    districtContextId:
      effectiveDistrictId ?? (isSameUser ? current.districtContextId : null) ?? null,
    hasSecondaryAuth:
      isSameUser && isSuperRole ? current.hasSecondaryAuth ?? false : false,
    superVerifiedAt:
      isSameUser && isSuperRole ? current.superVerifiedAt ?? null : null,
  });
};

const syncAuthStateFromListener = async (
  session: {
    user: { id: string; email?: string | null; last_sign_in_at?: string | null };
  } | null
) => {
  if (!session) {
    clearAuthState(true);
    return;
  }

  const profile = await fetchProfile(session.user.id);
  const effectiveDistrictId = await resolveEffectiveDistrictId(profile);
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
    tenantContextId: current.tenantContextId ?? resolvedSessionTenantId ?? null,
    districtContextId:
      effectiveDistrictId ?? (isSameUser ? current.districtContextId : null) ?? null,
    hasSecondaryAuth:
      isSameUser && isSuperRole ? current.hasSecondaryAuth ?? false : false,
    superVerifiedAt:
      isSameUser && isSuperRole ? current.superVerifiedAt ?? null : null,
  });
};

export const initAuthListener = () => {
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      void syncAuthStateFromListener(
        session
          ? {
              user: {
                id: session.user.id,
                email: session.user.email ?? null,
                last_sign_in_at: session.user.last_sign_in_at ?? null,
              },
            }
          : null
      );
    }, 0);
  });
};

export const tenantLogin = async (
  accessCode: string,
  password: string,
  turnstileToken?: string
) => {
  const functionName = getTenantLoginFunctionName();
  const district = getDistrictState();
  const result = await invokeEdgeFunction<{ auth_email?: string; district_slug?: string | null }, {
    access_code: string;
    turnstile_token?: string;
    district_slug?: string;
  }>(functionName, {
    method: "POST",
    body: {
      access_code: accessCode,
      ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      ...(district.isDistrictHost && district.slug ? { district_slug: district.slug } : {}),
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

  const shouldCrossHostRedirect =
    !district.isDistrictHost &&
    typeof data.district_slug === "string" &&
    !!data.district_slug.trim();

  if (shouldCrossHostRedirect) {
    return {
      districtId: null,
      districtSlug: data.district_slug?.trim() ?? null,
      authEmail: data.auth_email,
      accessToken: null,
      refreshToken: null,
    };
  }

  let signInError: unknown = null;
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
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
    refreshToken = signIn.data.session?.refresh_token ?? null;
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
  const districtSlug =
    (typeof data.district_slug === "string" && data.district_slug.trim()) ||
    (await resolveDistrictSlug(current.districtContextId));

  sendLoginNotification(accessToken);

  return {
    districtId: current.districtContextId ?? null,
    districtSlug: districtSlug || null,
    accessToken,
    refreshToken,
  };
};

export const consumeDistrictSessionHandoff = async () => {
  if (typeof window === "undefined" || !window.location.hash) {
    return false;
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const handoffCode = params.get("itx_hc");
  const accessToken = params.get("itx_at");
  const refreshToken = params.get("itx_rt");

  if (!handoffCode && (!accessToken || !refreshToken)) {
    return false;
  }

  params.delete("itx_hc");
  params.delete("itx_at");
  params.delete("itx_rt");
  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, document.title, nextUrl);

  let finalAccessToken = accessToken;
  let finalRefreshToken = refreshToken;

  if (handoffCode) {
    const result = await invokeEdgeFunction<
      { access_token?: string; refresh_token?: string },
      { action: "consume"; code: string }
    >(getDistrictHandoffFunctionName(), {
      method: "POST",
      body: {
        action: "consume",
        code: handoffCode,
      },
    });

    if (!result.ok || !result.data?.access_token || !result.data?.refresh_token) {
      if (result.status === 410) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.access_token && sessionData.session?.refresh_token) {
          return false;
        }
      }
      throw new Error("Unable to complete district sign-in.");
    }

    finalAccessToken = result.data.access_token;
    finalRefreshToken = result.data.refresh_token;
  }

  if (!finalAccessToken || !finalRefreshToken) {
    throw new Error("Unable to complete district sign-in.");
  }

  await clearLocalSession();

  const { data, error } = await supabase.auth.setSession({
    access_token: finalAccessToken,
    refresh_token: finalRefreshToken,
  });

  if (error || !data.session?.access_token) {
    await clearLocalSession();
    throw new Error("Unable to complete district sign-in.");
  }

  sendLoginNotification(finalAccessToken);

  try {
    window.sessionStorage.setItem(
      DISTRICT_HANDOFF_MARKER_KEY,
      String(Date.now())
    );
  } catch {
    // Ignore sessionStorage failures.
  }
  return true;
};

export const createDistrictSessionHandoff = async (
  districtSlug: string,
  authEmail: string,
  password: string
) => {
  const result = await invokeEdgeFunction<
    { code?: string },
    { action: "create"; district_slug: string; auth_email: string; password: string }
  >(getDistrictHandoffFunctionName(), {
    method: "POST",
    body: {
      action: "create",
      district_slug: districtSlug,
      auth_email: authEmail,
      password,
    },
  });

  if (!result.ok || !result.data?.code) {
    throw new Error("Unable to prepare district sign-in.");
  }

  await clearLocalSession();
  return result.data.code;
};

export const createDistrictAdminSessionHandoff = async (
  email: string,
  password: string,
  turnstileToken: string
) => {
  const result = await invokeEdgeFunction<
    {
      code?: string | null;
      district_slug?: string | null;
      role?: "tenant_admin" | "district_admin";
      root_only?: boolean;
      access_token?: string | null;
      refresh_token?: string | null;
    },
    { action: "create_admin"; email: string; password: string; turnstile_token: string }
  >(getDistrictHandoffFunctionName(), {
    method: "POST",
    body: {
      action: "create_admin",
      email,
      password,
      turnstile_token: turnstileToken,
    },
  });

  if (result.ok && result.data?.root_only) {
    return {
      code: null,
      districtSlug: null,
      role: result.data.role ?? "tenant_admin",
      rootOnly: true,
      accessToken: result.data.access_token ?? null,
      refreshToken: result.data.refresh_token ?? null,
    };
  }

  if (!result.ok || !result.data?.code || !result.data?.district_slug || !result.data?.role) {
    if (!result.ok && result.error === "Tenant disabled") {
      throw new Error("Tenant disabled.");
    }
    if (!result.ok && result.error === "Access denied") {
      throw new Error("Access denied.");
    }
    if (!result.ok && result.error === "Invalid credentials") {
      throw new Error("Invalid credentials.");
    }
    if (!result.ok && result.error === "District not found") {
      throw new Error("No district assignment.");
    }
    throw new Error("Unable to prepare district sign-in.");
  }

  return {
    code: result.data.code,
    districtSlug: result.data.district_slug,
    role: result.data.role,
    rootOnly: false,
    accessToken: null,
    refreshToken: null,
  };
};

export const adminLoginWithSession = async (accessToken: string, refreshToken: string) => {
  const priorTenantContextId = getAuthState().tenantContextId;
  const districtHost = getDistrictState();
  const session = await setSessionFromTokens(accessToken, refreshToken);
  const signedInUser =
    (session.user as { id: string; email?: string | null; last_sign_in_at?: string | null } | null) ??
    null;
  if (!signedInUser?.id) {
    throw new Error("Invalid credentials.");
  }

  const current = getAuthState();
  let profile = await fetchProfile(signedInUser.id);
  let fallbackRole: ProfileRow["role"] = null;
  let fallbackTenantId: string | null = null;
  let resolvedRole = profile?.role ?? null;
  let resolvedTenantId = profile?.tenant_id ?? null;
  let resolvedDistrictId = profile?.district_id ?? null;

  if (!resolvedRole || (!resolvedTenantId && !resolvedDistrictId)) {
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
  if (resolvedRole !== "tenant_admin" && resolvedRole !== "district_admin") {
    await signOut();
    throw new Error("Access denied.");
  }
  if (profile && profile.is_active === false) {
    await signOut();
    throw new Error("Access denied.");
  }
  if (resolvedRole === "tenant_admin" && resolvedTenantId) {
    const tenant = await fetchTenantContext(resolvedTenantId);
    if (tenant?.status && tenant.status !== "active") {
      await signOut();
      throw new Error("Tenant disabled.");
    }
    resolvedDistrictId = resolvedDistrictId ?? tenant?.district_id ?? null;
  }

  if (
    resolvedRole === "tenant_admin" &&
    priorTenantContextId &&
    resolvedTenantId &&
    resolvedTenantId !== priorTenantContextId
  ) {
    await signOut();
    throw new Error("Access denied.");
  }

  if (districtHost.isDistrictHost) {
    if (!districtHost.districtId) {
      await signOut();
      throw new Error("This district URL is not configured.");
    }
    if (!resolvedDistrictId || resolvedDistrictId !== districtHost.districtId) {
      await signOut();
      throw new Error("Access denied.");
    }
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
    districtContextId: resolvedDistrictId ?? current.districtContextId ?? null,
    hasSecondaryAuth: false,
    superVerifiedAt: null,
  });

  if (resolvedRole === "tenant_admin" && !getAuthState().tenantContextId) {
    setTenantContext(finalTenantId);
  }
  if (resolvedRole === "district_admin") {
    setDistrictContext(resolvedDistrictId ?? null);
  }
  markAdminVerified();
  sendLoginNotification(accessToken);
  const districtSlug = await resolveDistrictSlug(resolvedDistrictId ?? null);
  return {
    role: resolvedRole,
    tenantId: finalTenantId,
    districtId: resolvedDistrictId ?? null,
    districtSlug,
    accessToken,
    refreshToken,
  };
};

export const superAdminLogin = async (
  email: string,
  password: string,
  turnstileToken: string
) => {
  const result = await invokeEdgeFunction<{
    challenge_started?: boolean;
    email?: string | null;
    access_token?: string | null;
    refresh_token?: string | null;
  }>(SUPER_ADMIN_2FA_FUNCTION, {
    method: "POST",
    body: {
      action: "start_password_login",
      payload: {
        email,
        password,
        turnstile_token: turnstileToken,
      },
    },
  });

  if (
    !result.ok ||
    !result.data?.challenge_started ||
    !result.data.access_token ||
    !result.data.refresh_token
  ) {
    throw new Error(result.error || "Unable to send verification code.");
  }

  await setSessionFromTokens(result.data.access_token, result.data.refresh_token);
  await refreshAuthFromSession();
  const current = getAuthState();
  if (current.role !== "super_admin") {
    await signOut();
    throw new Error("Access denied.");
  }

  setSecondaryAuth(false);
  const challenge = { email: result.data.email ?? email };
  setPendingSuperAdminVerificationEmail(challenge.email);
  return {
    email: challenge.email,
  };
};

export const signOut = async () => {
  await supabase.auth.signOut();
  clearAdminVerification();
  clearPendingSuperAdminVerificationEmail();
  clearAuthState(true);
  setDistrictContext(null);
};

export const getPostSignOutUrl = () => {
  if (typeof window === "undefined") {
    return "/login";
  }

  const { host, isDistrictHost } = resolveDistrictHost(window.location.hostname);
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) {
    return "/login";
  }

  if (
    normalizedHost === "itemtraxx.com" ||
    normalizedHost === "www.itemtraxx.com" ||
    normalizedHost === "localhost" ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "0.0.0.0" ||
    normalizedHost.endsWith(".localhost")
  ) {
    return "/login";
  }

  if (isDistrictHost || normalizedHost !== "app.itemtraxx.com") {
    return "https://itemtraxx.com/login";
  }

  return "/login";
};
