import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import { initAuthListener, refreshAuthFromSession } from "./services/authService";
import {
  clearAuthState,
  getAuthState,
  markAdminVerified,
  setAuthStateFromBackend,
  setSecondaryAuth,
  setTenantContext,
} from "./store/authState";
import { TimeoutError, withTimeout } from "./services/asyncUtils";

declare global {
  interface Window {
    __itemtraxxTest?: {
      setTenantUserSession: (tenantId?: string) => void;
      setTenantAdminSession: (tenantId?: string) => void;
      setSuperAdminSession: () => void;
      clearSession: () => void;
      navigate: (path: string) => Promise<void>;
    };
  }
}

const attachE2EControls = () => {
  if (import.meta.env.VITE_E2E_TEST_UTILS !== "true") {
    return;
  }

  window.__itemtraxxTest = {
    setTenantUserSession(tenantId = "tenant-e2e") {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-tenant",
        email: "tenant.user@example.com",
        signedInAt: new Date().toISOString(),
        role: "tenant_user",
        sessionTenantId: tenantId,
        tenantContextId: tenantId,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
      });
      setTenantContext(tenantId);
    },
    setTenantAdminSession(tenantId = "tenant-e2e") {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-admin",
        email: "tenant.admin@example.com",
        signedInAt: new Date().toISOString(),
        role: "tenant_admin",
        sessionTenantId: tenantId,
        tenantContextId: tenantId,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
      });
      setTenantContext(tenantId);
      markAdminVerified();
    },
    setSuperAdminSession() {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-super",
        email: "super.admin@example.com",
        signedInAt: new Date().toISOString(),
        role: "super_admin",
        sessionTenantId: null,
        tenantContextId: null,
        hasSecondaryAuth: true,
      });
      setSecondaryAuth(true);
    },
    clearSession() {
      clearAuthState(true);
      setTenantContext(null);
    },
    async navigate(path: string) {
      await router.push(path);
    },
  };
};

const bootstrap = async () => {
  const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";
  if (!isE2ETestMode) {
    try {
      await withTimeout(
        refreshAuthFromSession(),
        6000,
        "Authentication initialization timed out."
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        console.error("Auth initialization timeout:", error.message);
      } else {
        console.error("Auth initialization failed:", error);
      }
    } finally {
      if (!getAuthState().isInitialized) {
        clearAuthState(true);
      }
    }
    initAuthListener();
  } else {
    clearAuthState(true);
  }

  const app = createApp(App);
  app.use(router);
  app.mount("#app");
  attachE2EControls();
};

bootstrap();
