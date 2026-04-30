import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { withTimeout } from "./asyncUtils";
import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  getPersistedAdminVerification,
  markAdminVerified,
  setDistrictContext,
  setAuthStateFromBackend,
  setSecondaryAuth,
  setTenantContext,
} from "../store/authState";
import { clearSessionTermination } from "../store/sessionTermination";
import { getDistrictState } from "../store/districtState";
import { lookupDistrictById, resolveDistrictHost } from "./districtService";
import { edgeFunctionError } from "./appErrors";
import { registerPrivilegedAdminStepUp } from "./privilegedStepUpService";
import {
  clearHttpSession,
  exchangeHttpSession,
  fetchHttpSessionSummary,
  type HttpSessionSummary,
} from "./httpSessionService";
import { authenticatedRpc, authenticatedSelect } from "./authenticatedDataClient";
import { rotateDeviceSession } from "../utils/deviceSession";
import { revokeCurrentTenantAdminSession, touchTenantAdminSession } from "./adminOpsService";

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

const normalizeFunctionTarget = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || fallback;
  } catch {
    const segments = trimmed.split("/").filter(Boolean);
    return segments[segments.length - 1] || fallback;
  }
};

const getTenantLoginFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_TENANT_LOGIN_FUNCTION, "tenant-login");
const getLoginNotifyFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_LOGIN_NOTIFY_FUNCTION, "login-notify");
const getDistrictHandoffFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_DISTRICT_HANDOFF_FUNCTION, "district-handoff");

const AUTH_QUERY_TIMEOUT_MS = 15000;
const DISTRICT_HANDOFF_MARKER_KEY = "itemtraxx:district-handoff-at";
const SUPER_ADMIN_2FA_FUNCTION = normalizeFunctionTarget(
  import.meta.env.VITE_SUPER_ADMIN_2FA_FUNCTION,
  "super-auth-verify"
);
let pendingSuperAdminVerificationEmail: string | null = null;
let pendingSuperAdminChallengeToken: string | null = null;

const RAW_HANDOFF_TOKEN_PARAMS = ["itx_at", "itx_rt"];

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
  pendingSuperAdminVerificationEmail = email;
};

const setPendingSuperAdminChallengeToken = (challengeToken: string | null) => {
  pendingSuperAdminChallengeToken = challengeToken;
};

export const getPendingSuperAdminChallengeToken = () => pendingSuperAdminChallengeToken;

export const getPendingSuperAdminVerificationEmail = () => pendingSuperAdminVerificationEmail;

export const clearPendingSuperAdminVerificationEmail = () => {
  setPendingSuperAdminVerificationEmail(null);
  setPendingSuperAdminChallengeToken(null);
};

export const resendSuperAdminEmailChallenge = async () => {
  const challengeToken = getPendingSuperAdminChallengeToken();
  if (!challengeToken) {
    throw new Error("Verification session expired. Sign in again.");
  }
  const result = await invokeEdgeFunction<{ challenge_started?: boolean; email?: string | null }>(
    SUPER_ADMIN_2FA_FUNCTION,
    {
      method: "POST",
      body: { action: "resend_email_challenge", payload: { challenge_token: challengeToken } },
    }
  );

  if (!result.ok || !result.data?.challenge_started) {
    throw edgeFunctionError(result, "Unable to send verification code.");
  }

  const recipientEmail = result.data.email ?? null;
  setPendingSuperAdminVerificationEmail(recipientEmail);
  return { email: recipientEmail };
};

export const verifySuperAdminEmailChallenge = async (code: string) => {
  const challengeToken = getPendingSuperAdminChallengeToken();
  if (!challengeToken) {
    throw new Error("Verification session expired. Sign in again.");
  }

  const result = await invokeEdgeFunction<{
    verified?: boolean;
    access_token?: string | null;
    refresh_token?: string | null;
  }>(SUPER_ADMIN_2FA_FUNCTION, {
    method: "POST",
    body: {
      action: "verify_email_challenge",
      payload: { code, challenge_token: challengeToken },
    },
  });

  if (
    !result.ok ||
    !result.data?.verified ||
    !result.data.access_token ||
    !result.data.refresh_token
  ) {
    throw edgeFunctionError(result, "Unable to verify code.");
  }

  await exchangeHttpSession({
    access_token: result.data.access_token,
    refresh_token: result.data.refresh_token,
  });
  setSecondaryAuth(true);
  await refreshAuthFromSession();
  const current = getAuthState();
  if (current.role !== "super_admin") {
    await signOut();
    throw new Error("Access denied.");
  }
  setSecondaryAuth(true);
  clearPendingSuperAdminVerificationEmail();
};

const clearLocalSession = async () => {
  // Browser session persistence is disabled in the Supabase client, so temporary
  // sign-in sessions remain in memory only. Avoid calling signOut here because it
  // can revoke the freshly exchanged server-managed session.
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
          authenticatedRpc<string | null>("current_user_role", {}, {
            suppressUnauthorizedRecovery: true,
          }),
          AUTH_QUERY_TIMEOUT_MS,
          "Role lookup timed out."
        ),
      2
    ),
    withRetry(
      () =>
        withTimeout(
          authenticatedRpc<string | null>("current_tenant_id", {}, {
            suppressUnauthorizedRecovery: true,
          }),
          AUTH_QUERY_TIMEOUT_MS,
          "Tenant lookup timed out."
        ),
      2
    ),
  ]);

  return {
    role: toKnownRole(roleResult),
    tenantId: typeof tenantResult === "string" && tenantResult.trim() ? tenantResult : null,
  };
};

const fetchProfile = async (userId: string): Promise<ProfileRow | null> => {
  let data: unknown = null;
  try {
    const response = await withRetry(
      () =>
        withTimeout(
          authenticatedSelect<ProfileRow[]>("profiles", {
            select: "id,role,tenant_id,district_id,auth_email,is_active",
            id: `eq.${userId}`,
            limit: "1",
          }, {
            suppressUnauthorizedRecovery: true,
          }),
          AUTH_QUERY_TIMEOUT_MS,
          "Profile lookup timed out."
        ),
      2
    );
    data = response?.[0] ?? null;
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

  return data as ProfileRow;
};

const fetchTenantContext = async (tenantId: string): Promise<TenantRow | null> => {
  let data: unknown = null;
  try {
    const response = await withRetry(
      () =>
        withTimeout(
          authenticatedSelect<TenantRow[]>("tenants", {
            select: "id,status,district_id",
            id: `eq.${tenantId}`,
            limit: "1",
          }, {
            suppressUnauthorizedRecovery: true,
          }),
          AUTH_QUERY_TIMEOUT_MS,
          "Tenant status lookup timed out."
        ),
      2
    );
    data = response?.[0] ?? null;
  } catch (requestError) {
    console.error("Tenant status lookup failed:", requestError);
    return null;
  }

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

const applySessionSummary = async (
  summary: Awaited<ReturnType<typeof fetchHttpSessionSummary>>
) => {
  if (!summary.authenticated || !summary.user) {
    clearAuthState(true);
    return;
  }

  const profile: ProfileRow | null = summary.profile
    ? {
        id: summary.user.id,
        role: summary.profile.role,
        tenant_id: summary.profile.tenant_id,
        district_id: summary.profile.district_id,
        auth_email: summary.profile.auth_email,
        is_active: summary.profile.is_active,
      }
    : null;

  const effectiveDistrictId = await resolveEffectiveDistrictId(profile);
  const isSuspended = await handleSuspendedTenantSession(profile);
  if (isSuspended) {
    return;
  }

  const current = getAuthState();
  const isSameUser = current.userId === summary.user.id;
  const resolvedRole = profile?.role ?? (isSameUser ? current.role : null);
  const resolvedSessionTenantId =
    profile?.tenant_id ?? (isSameUser ? current.sessionTenantId : null);
  const isSuperRole = resolvedRole === "super_admin";

  const persistedAdminVerifiedAt =
    resolvedRole === "tenant_admin" || resolvedRole === "district_admin"
      ? getPersistedAdminVerification(summary.user.id)
      : null;

  setAuthStateFromBackend({
    isInitialized: true,
    isAuthenticated: true,
    userId: summary.user.id,
    email: summary.user.email ?? null,
    signedInAt: summary.user.last_sign_in_at ?? null,
    role: resolvedRole,
    sessionTenantId: resolvedSessionTenantId,
    tenantContextId: current.tenantContextId ?? resolvedSessionTenantId ?? null,
    districtContextId:
      effectiveDistrictId ?? (isSameUser ? current.districtContextId : null) ?? null,
    hasSecondaryAuth:
      isSameUser && isSuperRole ? current.hasSecondaryAuth ?? false : false,
    superVerifiedAt:
      isSameUser && isSuperRole ? current.superVerifiedAt ?? null : null,
    adminVerifiedAt:
      (isSameUser ? current.adminVerifiedAt : null) ?? persistedAdminVerifiedAt ?? null,
  });
  clearSessionTermination();
};

const handleSuspendedTenantSession = async (profile: ProfileRow | null) => {
  if (!profile?.tenant_id || !["tenant_user", "tenant_admin"].includes(profile.role ?? "")) {
    return false;
  }
  const tenant = await fetchTenantContext(profile.tenant_id);
  if (tenant?.status && tenant.status !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    clearAdminVerification();
    clearAuthState(true);
    return true;
  }
  return false;
};

export const refreshAuthFromSession = async () => {
  try {
    const summary = await withTimeout(
      fetchHttpSessionSummary(),
      AUTH_QUERY_TIMEOUT_MS,
      "Session refresh timed out."
    );
    await applySessionSummary(summary);
  } catch (requestError) {
    console.error("Session refresh failed:", requestError);
    clearAuthState(true);
  }
};

export const initAuthListener = () => {
  // Cookie-backed sessions are restored through /auth/session/me during bootstrap.
  // Keep the listener disabled so transient in-memory Supabase auth state does not
  // overwrite the server-managed session view.
};

export const tenantLogin = async (
  accessCode: string,
  password: string,
  turnstileToken?: string
) => {
  const functionName = getTenantLoginFunctionName();
  const district = getDistrictState();
  const result = await invokeEdgeFunction<{
    access_token?: string | null;
    refresh_token?: string | null;
    district_slug?: string | null;
  }, {
    access_code: string;
    password: string;
    turnstile_token?: string;
    district_slug?: string;
  }>(functionName, {
    method: "POST",
    body: {
      access_code: accessCode,
      password,
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
  if (!data?.access_token || !data?.refresh_token) {
    throw new Error("Invalid tenant access code.");
  }

  const shouldCrossHostRedirect =
    !district.isDistrictHost &&
    typeof data.district_slug === "string" &&
    !!data.district_slug.trim();

  const exchangedSessionSummary = await exchangeHttpSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  await clearLocalSession();
  const sessionSummary =
    exchangedSessionSummary?.authenticated && exchangedSessionSummary?.user
      ? exchangedSessionSummary
      : await fetchHttpSessionSummary();
  let shouldRegisterTenantAdminSession = sessionSummary.profile?.role === "tenant_admin";
  if (!shouldRegisterTenantAdminSession) {
    try {
      const fallback = await fetchCurrentRoleAndTenant();
      shouldRegisterTenantAdminSession = fallback.role === "tenant_admin";
    } catch {
      // Ignore fallback failures; applySessionSummary will still restore best-effort auth state.
    }
  }
  if (shouldRegisterTenantAdminSession) {
    rotateDeviceSession();
    try {
      await touchTenantAdminSession({
        loginMethod: "password",
        loginLocation: "regular_login",
      });
    } catch {
      // Session tracking is best-effort and must not block successful login.
    }
  }
  await applySessionSummary(sessionSummary);
  const current = getAuthState();
  setTenantContext(current.sessionTenantId ?? null);
  const districtSlug =
    (typeof data.district_slug === "string" && data.district_slug.trim()) ||
    (await resolveDistrictSlug(current.districtContextId));

  if (!shouldCrossHostRedirect) {
    sendLoginNotification(data.access_token);
  }

  return {
    districtId: current.districtContextId ?? null,
    districtSlug: districtSlug || null,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
};

export const consumeDistrictSessionHandoff = async (): Promise<
  | false
  | {
      accessToken: string;
      refreshToken: string;
      sessionSummary: HttpSessionSummary | null;
      loginMethod: "password" | "magic_link" | "session_handoff" | null;
      loginLocation: "regular_login" | "admin_login" | null;
    }
> => {
  if (typeof window === "undefined" || !window.location.hash) {
    return false;
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const handoffCode = params.get("itx_hc");
  const tokenHash = params.get("itx_th");
  const hasRawTokenParams = RAW_HANDOFF_TOKEN_PARAMS.some((key) => params.has(key));
  const rawLoginMethod = params.get("itx_lm");
  const rawLoginLocation = params.get("itx_ll");
  const loginMethod =
    rawLoginMethod === "password" ||
    rawLoginMethod === "magic_link" ||
    rawLoginMethod === "session_handoff"
      ? rawLoginMethod
      : null;
  const loginLocation =
    rawLoginLocation === "regular_login" || rawLoginLocation === "admin_login"
      ? rawLoginLocation
      : null;

  if (!handoffCode && !tokenHash && !hasRawTokenParams) {
    return false;
  }

  params.delete("itx_hc");
  params.delete("itx_th");
  RAW_HANDOFF_TOKEN_PARAMS.forEach((key) => params.delete(key));
  params.delete("itx_lm");
  params.delete("itx_ll");
  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, document.title, nextUrl);

  if (!handoffCode && !tokenHash) {
    console.warn("Ignored deprecated raw district handoff token parameters.");
    return false;
  }

  let finalAccessToken: string | null = null;
  let finalRefreshToken: string | null = null;

  if (tokenHash) {
    const verifyResult = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });

    if (
      verifyResult.error ||
      !verifyResult.data.session?.access_token ||
      !verifyResult.data.session.refresh_token
    ) {
      throw new Error("Unable to complete district sign-in.");
    }

    const verifiedAccessToken = verifyResult.data.session.access_token;
    const verifiedRefreshToken = verifyResult.data.session.refresh_token;

    const exchangedSessionSummary = await exchangeHttpSession({
      access_token: verifiedAccessToken,
      refresh_token: verifiedRefreshToken,
    });
    await clearLocalSession();
    sendLoginNotification(verifiedAccessToken);

    try {
      window.sessionStorage.setItem(
        DISTRICT_HANDOFF_MARKER_KEY,
        String(Date.now())
      );
    } catch {
      // Ignore sessionStorage failures.
    }

    return {
      accessToken: verifiedAccessToken,
      refreshToken: verifiedRefreshToken,
      sessionSummary: exchangedSessionSummary ?? null,
      loginMethod,
      loginLocation,
    };
  } else if (handoffCode) {
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

  const exchangedSessionSummary = await exchangeHttpSession({
    access_token: finalAccessToken,
    refresh_token: finalRefreshToken,
  });
  await clearLocalSession();

  sendLoginNotification(finalAccessToken);

  try {
    window.sessionStorage.setItem(
      DISTRICT_HANDOFF_MARKER_KEY,
      String(Date.now())
    );
  } catch {
    // Ignore sessionStorage failures.
  }
  return {
    accessToken: finalAccessToken,
    refreshToken: finalRefreshToken,
    sessionSummary: exchangedSessionSummary ?? null,
    loginMethod,
    loginLocation,
  };
};

export const createDistrictSessionHandoff = async (districtSlug: string) => {
  const result = await invokeEdgeFunction<
    { hashed_token?: string },
    { action: "create"; district_slug: string }
  >(getDistrictHandoffFunctionName(), {
    method: "POST",
    body: {
      action: "create",
      district_slug: districtSlug,
    },
  });

  if (!result.ok || !result.data?.hashed_token) {
    throw new Error("Unable to prepare district sign-in.");
  }

  await clearLocalSession();
  return {
    tokenHash: result.data.hashed_token,
  };
};

export const createDistrictAdminSessionHandoff = async (
  email: string,
  password: string,
  turnstileToken: string
) => {
  const district = getDistrictState();
  const result = await invokeEdgeFunction<
    {
      district_slug?: string | null;
      role?: "tenant_admin" | "district_admin";
      hashed_token?: string | null;
    },
    {
      action: "create_admin";
      email: string;
      password: string;
      turnstile_token: string;
      current_district_slug?: string;
    }
  >(getDistrictHandoffFunctionName(), {
    method: "POST",
    body: {
      action: "create_admin",
      email,
      password,
      turnstile_token: turnstileToken,
      current_district_slug: district.isDistrictHost ? district.slug ?? undefined : undefined,
    },
  });

  if (
    !result.ok ||
    !result.data?.hashed_token ||
    !result.data?.role
  ) {
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
    districtSlug: result.data.district_slug ?? null,
    role: result.data.role,
    tokenHash: result.data.hashed_token,
  };
};


export const adminLoginWithSession = async (
  accessToken: string,
  refreshToken: string,
  sessionTouchOptions: {
    loginMethod?: "password" | "magic_link" | "session_handoff" | null;
    loginLocation?: "regular_login" | "admin_login" | null;
    skipExchange?: boolean;
    skipLoginNotification?: boolean;
    preExchangedSessionSummary?: HttpSessionSummary | null;
  } = {}
) => {
  const priorTenantContextId = getAuthState().tenantContextId;
  const districtHost = getDistrictState();
  const exchangedSessionSummary = sessionTouchOptions.skipExchange
    ? sessionTouchOptions.preExchangedSessionSummary ?? null
    : await exchangeHttpSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
  if (!sessionTouchOptions.skipExchange) {
    await clearLocalSession();
  }

  const sessionSummary =
    exchangedSessionSummary?.authenticated && exchangedSessionSummary?.user
      ? exchangedSessionSummary
      : await fetchHttpSessionSummary();
  if (!sessionSummary.authenticated || !sessionSummary.user) {
    throw new Error("Invalid credentials.");
  }

  const current = getAuthState();
  let profile = sessionSummary.profile
    ? {
        id: sessionSummary.user.id,
        role: sessionSummary.profile.role,
        tenant_id: sessionSummary.profile.tenant_id,
        district_id: sessionSummary.profile.district_id,
        auth_email: sessionSummary.profile.auth_email,
        is_active: sessionSummary.profile.is_active,
      }
    : await fetchProfile(sessionSummary.user.id);
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

  try {
    await registerPrivilegedAdminStepUp(accessToken);
  } catch (error) {
    await signOut();
    throw error;
  }

  if (resolvedRole === "tenant_admin") {
    rotateDeviceSession();
    try {
      await touchTenantAdminSession({
        loginMethod: sessionTouchOptions.loginMethod ?? "password",
        loginLocation: sessionTouchOptions.loginLocation ?? "admin_login",
      });
    } catch {
      // Session tracking is best-effort and must not block successful admin sign-in.
    }
  }

  setAuthStateFromBackend({
    isInitialized: true,
    isAuthenticated: true,
    userId: sessionSummary.user.id,
    email: sessionSummary.user.email ?? null,
    signedInAt: sessionSummary.user.last_sign_in_at ?? null,
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
  if (!sessionTouchOptions.skipLoginNotification) {
    sendLoginNotification(accessToken);
  }
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
    challenge_token?: string | null;
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
    !result.data.challenge_token
  ) {
    throw edgeFunctionError(result, "Unable to send verification code.");
  }

  await clearLocalSession();
  setSecondaryAuth(false);
  clearAuthState(true);
  setPendingSuperAdminChallengeToken(result.data.challenge_token);
  const challenge = { email: result.data.email ?? email };
  setPendingSuperAdminVerificationEmail(challenge.email);
  return {
    email: challenge.email,
  };
};

export const signOut = async () => {
  const current = getAuthState();
  const shouldRevokeTenantAdminSession = current.role === "tenant_admin" && !!current.adminVerifiedAt;

  if (shouldRevokeTenantAdminSession) {
    try {
      await revokeCurrentTenantAdminSession();
    } catch {
      // Ignore device-session revocation failures during sign-out.
    }
  }

  try {
    await clearHttpSession();
  } catch {
    // Ignore cookie logout failures during the migration window.
  }
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("session_not_found")) {
      throw error;
    }
  }
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
