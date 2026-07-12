import { supabase } from "../supabaseClient";
import { invokeEdgeFunction } from "../edgeFunctionClient";
import {
  clearAuthState,
  getAuthState,
  markAdminVerified,
  setAuthStateFromBackend,
  setDistrictContext,
  setSecondaryAuth,
  setTenantContext,
} from "../../store/authState";
import { getDistrictState } from "../../store/districtState";
import { edgeFunctionError } from "../appErrors";
import { registerPrivilegedAdminStepUp } from "../privilegedStepUpService";
import {
  exchangeHttpSession,
  fetchHttpSessionSummary,
  type HttpSessionSummary,
} from "../httpSessionService";
import { rotateDeviceSession } from "../../utils/deviceSession";
import { touchTenantAdminSession } from "../adminOpsService";
import { touchSuperAdminSession } from "../superOpsService";
import {
  fetchCurrentRoleAndTenant,
  fetchProfile,
  fetchTenantContext,
  refreshAuthFromSession,
  resolveDistrictSlug,
} from "./sessionBootstrap";
import { clearLocalSession, sendLoginNotification } from "./tenantLogin";
import { signOut } from "./signOut";
import {
  clearPendingSuperAdminVerificationEmail,
  getPendingSuperAdminChallengeToken,
  setPendingSuperAdminChallengeToken,
  setPendingSuperAdminVerificationEmail,
} from "./sessionState";
import {
  normalizeFunctionTarget,
  toTenantAdminSessionLocation,
  type LoginNotificationLocation,
  type ProfileRow,
} from "./types";

const SUPER_ADMIN_2FA_FUNCTION = normalizeFunctionTarget(
  import.meta.env.VITE_SUPER_ADMIN_2FA_FUNCTION,
  "super-auth-verify"
);

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
    throw edgeFunctionError(result, "Unable to send verification code. fix yo code.");
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
    throw edgeFunctionError(result, "Unable to verify code. u prob put it in wrong u might wanna check it");
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
      throw new Error("This workspace URL is not configured.");
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
