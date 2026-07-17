import type { Router } from "vue-router";
import type {
  BufferedCheckoutItem,
  CheckoutReturnPayload,
} from "../services/offlineCheckoutQueue";
import {
  clearAdminVerification,
  clearAuthState,
  markAdminVerified,
  setAuthStateFromBackend,
  setDistrictContext,
  setSecondaryAuth,
  setTenantContext,
} from "../store/authState";

declare global {
  interface Window {
    __itemtraxxTest?: {
      setTenantUserSession: (tenantId?: string) => void;
      setTenantAdminSession: (tenantId?: string, options?: { verified?: boolean }) => void;
      setDistrictAdminSession: (districtId?: string, options?: { verified?: boolean }) => void;
      setSuperAdminSession: (options?: { verified?: boolean }) => void;
      invokeAdminGearCreate: (payload: {
        tenant_id: string;
        name: string;
        barcode: string;
        status: string;
        notes?: string;
      }) => Promise<unknown>;
      invokeAdminStudentCreate: (payload: {
        tenant_id: string;
        username?: string;
        student_id?: string;
      }) => Promise<unknown>;
      clearSession: () => void;
      navigate: (path: string) => Promise<void>;
      generateBarcodePattern: (
        value: string
      ) => Promise<{ modules: number; bars: { start: number; width: number }[] }>;
      offlineCheckoutQueue: {
        clear: () => Promise<void>;
        consumeWarning: () => Promise<string | null>;
        ensureOperationId: (payload: CheckoutReturnPayload) => Promise<CheckoutReturnPayload>;
        getCount: () => Promise<number>;
        queue: (payload: CheckoutReturnPayload, error?: string | null) => Promise<number>;
        read: () => Promise<BufferedCheckoutItem[]>;
        withLock: <T>(callback: () => Promise<T>) => Promise<T>;
        write: (items: BufferedCheckoutItem[]) => Promise<void>;
      };
    };
  }
}

export const attachE2EControls = (router: Router): void => {
  if (import.meta.env.VITE_E2E_TEST_UTILS !== "true") {
    return;
  }

  if (import.meta.env.PROD) {
    throw new Error("VITE_E2E_TEST_UTILS cannot be enabled in production.");
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
        districtContextId: null,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
      });
      setTenantContext(tenantId);
    },
    setTenantAdminSession(tenantId = "tenant-e2e", options = { verified: true }) {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-admin",
        email: "tenant.admin@example.com",
        signedInAt: new Date().toISOString(),
        role: "tenant_admin",
        sessionTenantId: tenantId,
        tenantContextId: tenantId,
        districtContextId: null,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
      });
      setTenantContext(tenantId);
      setDistrictContext(null);
      if (options.verified === false) {
        clearAdminVerification();
        return;
      }
      markAdminVerified();
    },
    setDistrictAdminSession(districtId = "district-e2e", options = { verified: true }) {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-district-admin",
        email: "district.admin@example.com",
        signedInAt: new Date().toISOString(),
        role: "district_admin",
        sessionTenantId: null,
        tenantContextId: null,
        districtContextId: districtId,
        hasSecondaryAuth: false,
        superVerifiedAt: null,
      });
      setTenantContext(null);
      setDistrictContext(districtId);
      if (options.verified === false) {
        clearAdminVerification();
        return;
      }
      markAdminVerified();
    },
    setSuperAdminSession(options = { verified: true }) {
      setAuthStateFromBackend({
        isInitialized: true,
        isAuthenticated: true,
        userId: "user-e2e-super",
        email: "super.admin@example.com",
        signedInAt: new Date().toISOString(),
        role: "super_admin",
        sessionTenantId: null,
        tenantContextId: null,
        districtContextId: null,
        hasSecondaryAuth: options.verified !== false,
      });
      setTenantContext(null);
      setDistrictContext(null);
      setSecondaryAuth(options.verified !== false);
    },
    async invokeAdminGearCreate(payload) {
      const { createGear } = await import("../services/gearService");
      return await createGear(payload);
    },
    async invokeAdminStudentCreate(payload) {
      const { createStudent } = await import("../services/studentService");
      return await createStudent(payload);
    },
    clearSession() {
      clearAuthState(true);
      setTenantContext(null);
      setDistrictContext(null);
    },
    async navigate(path: string) {
      await router.push(path);
    },
    async generateBarcodePattern(value: string) {
      const [{ createBarcodePattern }, { default: JsBarcode }] = await Promise.all([
        import("../services/barcodePdfService"),
        import("jsbarcode"),
      ]);
      return createBarcodePattern(
        value,
        JsBarcode as (
          element: HTMLCanvasElement,
          text: string,
          options?: unknown
        ) => void
      );
    },
    offlineCheckoutQueue: {
      async clear() {
        const { clearOfflineCheckoutQueue } = await import("../services/offlineCheckoutQueue");
        return clearOfflineCheckoutQueue();
      },
      async consumeWarning() {
        const { consumeCheckoutOfflineWarning } = await import("../services/offlineCheckoutQueue");
        return consumeCheckoutOfflineWarning();
      },
      async ensureOperationId(payload) {
        const { ensureCheckoutOperationId } = await import("../services/offlineCheckoutQueue");
        return ensureCheckoutOperationId(payload);
      },
      async getCount() {
        const { getBufferedCheckoutCount } = await import("../services/offlineCheckoutQueue");
        return getBufferedCheckoutCount();
      },
      async queue(payload, error) {
        const { queueCheckoutPayload } = await import("../services/offlineCheckoutQueue");
        return queueCheckoutPayload(payload, error);
      },
      async read() {
        const { readOfflineQueue } = await import("../services/offlineCheckoutQueue");
        return readOfflineQueue();
      },
      async withLock(callback) {
        const { withOfflineQueueLock } = await import("../services/offlineCheckoutQueue");
        return withOfflineQueueLock(callback);
      },
      async write(items) {
        const { writeOfflineQueue } = await import("../services/offlineCheckoutQueue");
        return writeOfflineQueue(items);
      },
    },
  };
};
