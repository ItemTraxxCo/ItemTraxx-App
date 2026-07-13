import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  setDistrictContext,
} from "../../store/authState";
import { revokeCurrentTenantAdminSession } from "../adminOpsService";
import { resolveDistrictHost } from "../districtService";
import { clearHttpSession } from "../httpSessionService";
import { signOutLocalSupabaseSession } from "../supabaseAuthSession";
import { clearPendingSuperAdminVerificationEmail } from "./sessionState";

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
