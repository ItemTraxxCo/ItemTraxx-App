import { invokeEdgeFunction } from "../edgeFunctionClient";
import { getDistrictState } from "../../store/districtState";
import { getAuthState, setTenantContext } from "../../store/authState";
import { exchangeHttpSession, fetchHttpSessionSummary } from "../httpSessionService";
import { rotateDeviceSession } from "../../utils/deviceSession";
import { touchTenantAdminSession } from "../adminOpsService";
import {
  applyHttpSessionSummary,
  fetchCurrentRoleAndTenant,
  resolveDistrictSlug,
} from "./sessionBootstrap";
import { normalizeFunctionTarget, type LoginNotificationLocation } from "./types";

const getTenantLoginFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_TENANT_LOGIN_FUNCTION, "tenant-login");
const getLoginNotifyFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_LOGIN_NOTIFY_FUNCTION, "login-notify");

export const sendLoginNotification = (
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

export const clearLocalSession = async () => {
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
