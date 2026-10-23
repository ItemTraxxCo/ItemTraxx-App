import type { RouteLocationNormalized } from "vue-router";
import type { AuthState } from "../store/authState";

// Redirect authenticated users away from the public home page while leaving
// the login page available so users can intentionally switch accounts.
const authenticatedHomeRedirect = (
  to: RouteLocationNormalized,
  name: string,
) => {
  const proof = to.query.itx_sso_proof;
  if (proof) {
    return {
      name,
      query: {
        itx_sso_proof: proof,
      },
    };
  }
  return { name };
};

export const resolveAuthenticatedHomeRoute = (
  to: RouteLocationNormalized,
  auth: AuthState,
) => {
  if (!auth.isInitialized || !auth.isAuthenticated || to.name !== "public-home") return undefined;
  if (auth.role === "super_admin") {
    return auth.hasSecondaryAuth
      ? { name: "super-admin-home" }
      : { name: "super-auth" };
  }
  if (auth.role === "workspace_admin") {
    return authenticatedHomeRedirect(to, "workspace-admin-home");
  }
  if (auth.role === "individual_account") {
    return authenticatedHomeRedirect(to, "workspace-checkout");
  }
  if (auth.role === "tenant_account" && auth.workspaceContextId) {
    return authenticatedHomeRedirect(to, "workspace-checkout");
  }
  return undefined;
};
