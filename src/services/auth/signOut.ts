import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  setDistrictContext,
} from "../../store/authState";
import { revokeCurrentTenantAdminSession } from "../adminOpsService";
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
