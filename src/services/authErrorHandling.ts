import type { Router } from "vue-router";
import { isUnauthorizedError } from "./appErrors";
import { clearAuthState } from "../store/authState";

export const handleSuperAdminUnauthorized = async (router: Router) => {
  clearAuthState(true);
  await router.replace({
    name: "super-auth",
    query: { reason: "session-expired" },
  });
};

export { isUnauthorizedError };
