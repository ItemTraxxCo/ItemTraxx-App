export type IntercomUser = {
  userId: string;
  email?: string | null;
};

type IntercomSdk = typeof import("@intercom/messenger-js-sdk");
type IntercomSettings = {
  app_id: string;
  user_id?: string;
  email?: string;
};

// Messenger identity-verification tokens must be generated server-side. Keep
// the Intercom secret out of this client-only integration.

const appId = (import.meta.env.VITE_INTERCOM_APP_ID ?? "").trim();
const isE2ETestMode = import.meta.env.VITE_E2E_TEST_UTILS === "true";

let sdkPromise: Promise<IntercomSdk> | null = null;
let sdk: IntercomSdk | null = null;
let activeIdentity: { userId: string | null; email: string | null } | null = null;
let syncGeneration = 0;

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

export const isIntercomConfigured = () => isBrowser() && !isE2ETestMode && appId.length > 0;

export const buildIntercomSettings = (user?: IntercomUser | null): IntercomSettings | null => {
  if (!appId) return null;

  const userId = user?.userId.trim();
  // Intercom's anonymous installation is app_id-only; it stores the visitor
  // conversation in the browser rather than attaching an account identity.
  if (!userId) return { app_id: appId };

  const email = user?.email?.trim();
  return {
    app_id: appId,
    user_id: userId,
    ...(email ? { email } : {}),
  };
};

const loadSdk = () => {
  if (!sdkPromise) {
    sdkPromise = import("@intercom/messenger-js-sdk")
      .then((module) => {
        sdk = module;
        return module;
      })
      .catch((error) => {
        sdkPromise = null;
        throw error;
      });
  }
  return sdkPromise;
};

export const initializeIntercom = async (user?: IntercomUser | null) => {
  if (!isIntercomConfigured()) {
    shutdownIntercom();
    return;
  }

  const settings = buildIntercomSettings(user);
  if (!settings) return;

  const nextUserId = settings.user_id ?? null;
  const nextEmail = typeof settings.email === "string" ? settings.email : null;
  if (activeIdentity?.userId === nextUserId && activeIdentity?.email === nextEmail) return;

  const generation = ++syncGeneration;
  if (activeIdentity) {
    try {
      sdk?.shutdown();
    } catch (error) {
      console.warn("[intercom] shutdown failed; continuing with reinitialization.", error);
    }
    activeIdentity = null;
  }

  try {
    const intercom = await loadSdk();
    if (generation !== syncGeneration) return;
    intercom.default(settings);
    activeIdentity = { userId: nextUserId, email: nextEmail };
  } catch (error) {
    console.warn("[intercom] initialization failed; continuing without Messenger.", error);
  }
};

export const shutdownIntercom = () => {
  syncGeneration += 1;
  activeIdentity = null;
  if (!sdk) return;

  try {
    sdk.shutdown();
  } catch (error) {
    console.warn("[intercom] shutdown failed; continuing without Messenger.", error);
  }
};
