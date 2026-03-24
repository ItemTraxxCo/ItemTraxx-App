import type { Router } from "vue-router";
import { clearAuthState } from "../store/authState";

type RecoverableAppErrorDetail = {
  code: string;
  message: string;
};

const EVENT_NAME = "itemtraxx:recoverable-app-error";
let lastRecoveryAt = 0;

const resolveRecoveryRoute = (router: Router) => {
  const currentPath = router.currentRoute.value.path;

  if (currentPath.startsWith("/internal")) {
    return { name: "internal-auth" as const };
  }
  if (currentPath.startsWith("/super-admin")) {
    return { name: "super-auth" as const, query: { reason: "session-expired" } };
  }
  if (currentPath.startsWith("/district")) {
    return { name: "tenant-admin-login" as const, query: { reason: "session-expired" } };
  }
  if (currentPath.startsWith("/tenant/admin")) {
    return { name: "tenant-admin-login" as const, query: { reason: "session-expired" } };
  }
  return { name: "public-login" as const, query: { reason: "session-expired" } };
};

export const dispatchRecoverableAppError = (detail: RecoverableAppErrorDetail) => {
  if (typeof window === "undefined") {
    return;
  }
  queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent<RecoverableAppErrorDetail>(EVENT_NAME, { detail }));
  });
};

export const installAppErrorRecovery = (router: Router) => {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener(EVENT_NAME, (event) => {
    const now = Date.now();
    if (now - lastRecoveryAt < 1000) {
      return;
    }

    const customEvent = event as CustomEvent<RecoverableAppErrorDetail>;
    if (customEvent.detail?.code !== "UNAUTHORIZED") {
      return;
    }

    lastRecoveryAt = now;
    clearAuthState(true);
    void router.replace(resolveRecoveryRoute(router));
  });
};
