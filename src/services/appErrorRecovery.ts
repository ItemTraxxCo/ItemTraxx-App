import type { Router } from "vue-router";
import { clearAuthState } from "../store/authState";
import { showSessionTermination } from "../store/sessionTermination";

type RecoverableAppErrorDetail = {
  code: string;
  message: string;
};

const EVENT_NAME = "itemtraxx:recoverable-app-error";
const CHUNK_RELOAD_KEY = "itemtraxx:chunk-reload-path";
let lastRecoveryAt = 0;

export const isRecoverableChunkLoadError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i
    .test(message);
};

export const recoverFromChunkLoadError = (path: string) => {
  if (typeof window === "undefined") return false;
  const target = path || "/";
  if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === target) {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    return false;
  }
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, target);
  window.location.assign(target);
  return true;
};

export const resolveRecoveryRouteFromPath = (currentPath: string) => {
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

const resolveRecoveryRoute = (router: Router) => resolveRecoveryRouteFromPath(router.currentRoute.value.path);

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
    showSessionTermination(resolveRecoveryRoute(router));
  });

  router.onError((error, to) => {
    if (isRecoverableChunkLoadError(error)) {
      recoverFromChunkLoadError(to.fullPath);
    }
  });

  router.afterEach((to) => {
    if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === to.fullPath) {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    }
  });
};
