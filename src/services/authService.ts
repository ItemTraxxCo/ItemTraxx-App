import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
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
import { resolveDistrictHost } from "./districtService";
import { edgeFunctionError } from "./appErrors";
import { registerPrivilegedAdminStepUp } from "./privilegedStepUpService";
import {
  clearHttpSession,
  exchangeHttpSession,
  fetchHttpSessionSummary,
  type HttpSessionSummary,
} from "./httpSessionService";
import { signOutLocalSupabaseSession } from "./supabaseAuthSession";
import { rotateDeviceSession } from "../utils/deviceSession";
import { revokeCurrentTenantAdminSession, touchTenantAdminSession } from "./adminOpsService";
import { touchSuperAdminSession } from "./superOpsService";
import {
  normalizeFunctionTarget,
  normalizeLoginNotificationLocation,
  toTenantAdminSessionLocation,
  type LoginNotificationLocation,
  type ProfileRow,
} from "./auth/types";
import {
  applyHttpSessionSummary,
  fetchCurrentRoleAndTenant,
  fetchProfile,
  fetchTenantContext,
  refreshAuthFromSession,
  resolveDistrictSlug,
} from "./auth/sessionBootstrap";
export {
  applyHttpSessionSummary,
  initAuthListener,
  refreshAuthFromSession,
} from "./auth/sessionBootstrap";
export type { LoginNotificationLocation } from "./auth/types";

const getTenantLoginFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_TENANT_LOGIN_FUNCTION, "tenant-login");
const getLoginNotifyFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_LOGIN_NOTIFY_FUNCTION, "login-notify");
const getDistrictHandoffFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_DISTRICT_HANDOFF_FUNCTION, "district-handoff");

const DISTRICT_HANDOFF_MARKER_KEY = "itemtraxx:district-handoff-at";
const SUPER_ADMIN_2FA_FUNCTION = normalizeFunctionTarget(
  import.meta.env.VITE_SUPER_ADMIN_2FA_FUNCTION,
  "super-auth-verify"
);
let pendingSuperAdminVerificationEmail: string | null = null;
let pendingSuperAdminChallengeToken: string | null = null;

const RAW_HANDOFF_TOKEN_PARAMS = ["itx_at", "itx_rt"];


const sendLoginNotification = (
  accessToken: string | null,
  options: { loginLocation?: LoginNotificationLocation | null } = {}
) => {
  if (!accessToken) return;
  const loginNotifyFunctionName = getLoginNotifyFunctionName();
  void invokeEdgeFunction(loginNotifyFunctionName, {
    method: "POST",
    accessToken,
    body: {
      login_location: options.loginLocation ?? null,
    },
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
  try {
    await touchSuperAdminSession({
      loginMethod: "password",
      loginLocation: "super_auth",
    });
  } catch {
    // Super-admin session tracking is best-effort and must not block successful login.
  }
  sendLoginNotification(result.data.access_token, { loginLocation: "super_admin_login" });
};

const clearLocalSession = async () => {
  // Browser session persistence is disabled in the Supabase client, so temporary
  // sign-in sessions remain in memory only. Avoid calling signOut here because it
  // can revoke the freshly exchanged server-managed session.
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
      // Ignore fallback failures; applyHttpSessionSummary will still restore best-effort auth state.
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
  await applyHttpSessionSummary(sessionSummary);
  const current = getAuthState();
  setTenantContext(current.sessionTenantId ?? null);
  const districtSlug =
    (typeof data.district_slug === "string" && data.district_slug.trim()) ||
    (await resolveDistrictSlug(current.districtContextId));

  if (!shouldCrossHostRedirect) {
    sendLoginNotification(data.access_token, { loginLocation: "tenant_login" });
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
      loginLocation: LoginNotificationLocation | null;
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
  const loginLocation = normalizeLoginNotificationLocation(rawLoginLocation);

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
    sendLoginNotification(verifiedAccessToken, { loginLocation });

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

  sendLoginNotification(finalAccessToken, { loginLocation });

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
  turnstileToken: string,
) => {
  const district = getDistrictState();
  const result = await invokeEdgeFunction<
    {
      district_slug?: string | null;
      role?: "tenant_admin" | "district_admin";
      hashed_token?: string | null;
      user_id?: string | null;
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
    userId: result.data.user_id ?? null,
  };
};


export const adminLoginWithSession = async (
  accessToken: string,
  refreshToken: string,
  sessionTouchOptions: {
    loginMethod?: "password" | "magic_link" | "session_handoff" | null;
    loginLocation?: LoginNotificationLocation | null;
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

  const finalTenantId = resolvedTenantId ?? fallbackTenantId ?? null;

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
        loginLocation:
          toTenantAdminSessionLocation(sessionTouchOptions.loginLocation) ?? "admin_login",
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
    tenantContextId: finalTenantId,
    districtContextId: resolvedDistrictId ?? null,
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
    const fallbackLoginLocation: LoginNotificationLocation =
      resolvedRole === "district_admin" ? "district_admin_login" : "tenant_admin_login";
    sendLoginNotification(accessToken, {
      loginLocation: sessionTouchOptions.loginLocation ?? fallbackLoginLocation,
    });
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

export const superAdminPasskeyLogin = async (options: {
  sendLoginNotification?: boolean;
  loginLocation?: "super_auth" | "super_settings";
} = {}) => {
  const passkeySignIn = await supabase.auth.signInWithPasskey();
  if (passkeySignIn.error || !passkeySignIn.data?.session) {
    throw new Error(passkeySignIn.error?.message || "Passkey sign in failed.");
  }

  const session = passkeySignIn.data.session;
  const accessToken = session.access_token;
  const refreshToken = session.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new Error("Passkey sign in failed.");
  }

  const verify = await invokeEdgeFunction<{ verified?: boolean }>(SUPER_ADMIN_2FA_FUNCTION, {
    method: "POST",
    accessToken,
    body: {
      action: "complete_passkey_login",
      payload: {},
    },
  });
  if (!verify.ok || !verify.data?.verified) {
    throw edgeFunctionError(verify, "Passkey verification failed.");
  }

  await exchangeHttpSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  await clearLocalSession();
  await refreshAuthFromSession();
  const current = getAuthState();
  if (current.role !== "super_admin") {
    await signOut();
    throw new Error("Access denied.");
  }

  setSecondaryAuth(true);
  clearPendingSuperAdminVerificationEmail();
  try {
    await touchSuperAdminSession({
      loginMethod: "passkey",
      loginLocation: options.loginLocation ?? "super_auth",
    });
  } catch {
    // Super-admin session tracking is best-effort and must not block successful login.
  }
  if (options.sendLoginNotification !== false) {
    sendLoginNotification(accessToken, { loginLocation: "super_admin_login" });
  }
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

  await signOutLocalSupabaseSession();
  try {
    await clearHttpSession();
  } catch {
    // Ignore cookie logout failures during the migration window.
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
