import { onScopeDispose, watch } from "vue";
import type { IntercomUser } from "../services/intercomService";
import { SUPPORT_MESSENGER_OPEN_EVENT } from "../services/supportMessengerEvent";

type IntercomAuthState = {
  isInitialized: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
};

// The Intercom service is loaded lazily so it stays out of the initial bundle.
const loadIntercomService = () => import("../services/intercomService");

const ANONYMOUS_BOOT_DELAY_MS = 1500;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Support chat is classified as an essential service (see the Cookies Notice)
 * and loads for everyone, but lazily:
 * - signed-in sessions boot immediately with a server-signed JWT;
 * - anonymous visitors boot app-id-only once the page is idle, so Intercom
 *   never competes with first paint or the initial bundle.
 * SUPPORT_MESSENGER_OPEN_EVENT opens the Messenger from any "contact support"
 * control, booting it first if it has not loaded yet.
 */
export const useIntercom = (auth: IntercomAuthState) => {
  let wasAuthenticated = false;
  let cancelPendingBoot: (() => void) | null = null;

  const signedInUser = (): IntercomUser | null =>
    auth.isInitialized && auth.isAuthenticated && auth.userId
      ? { userId: auth.userId, email: auth.email }
      : null;

  const clearPendingBoot = () => {
    cancelPendingBoot?.();
    cancelPendingBoot = null;
  };

  const scheduleAnonymousBoot = () => {
    if (cancelPendingBoot || typeof window === "undefined") return;
    const run = () => {
      cancelPendingBoot = null;
      if (signedInUser() || !auth.isInitialized) return;
      void loadIntercomService().then((service) => service.initializeIntercom(null));
    };
    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(run, { timeout: 3000 });
      cancelPendingBoot = () => idleWindow.cancelIdleCallback?.(handle);
    } else {
      const handle = window.setTimeout(run, ANONYMOUS_BOOT_DELAY_MS);
      cancelPendingBoot = () => window.clearTimeout(handle);
    }
  };

  const sync = () => {
    const user = signedInUser();
    if (user) {
      wasAuthenticated = true;
      clearPendingBoot();
      void loadIntercomService().then((service) => service.initializeIntercom(user));
      return;
    }

    // While auth is still loading we do not know whether this is a signed-in
    // user, so booting anonymously now could attach the wrong identity.
    if (!auth.isInitialized) return;

    if (wasAuthenticated) {
      wasAuthenticated = false;
      void loadIntercomService().then((service) => service.shutdownIntercom());
    }
    scheduleAnonymousBoot();
  };

  const openSupport = async () => {
    const service = await loadIntercomService();
    return service.openIntercomMessenger(signedInUser());
  };

  const handleOpenRequest = () => {
    void openSupport();
  };
  if (typeof window !== "undefined") {
    window.addEventListener(SUPPORT_MESSENGER_OPEN_EVENT, handleOpenRequest);
  }

  watch(
    () => [auth.isInitialized, auth.isAuthenticated, auth.userId, auth.email] as const,
    sync,
    { immediate: true },
  );

  onScopeDispose(() => {
    clearPendingBoot();
    if (typeof window !== "undefined") {
      window.removeEventListener(SUPPORT_MESSENGER_OPEN_EVENT, handleOpenRequest);
    }
    void loadIntercomService().then((service) => service.shutdownIntercom());
  });

  return { openSupport };
};
