export type IntercomUser = {
  userId: string;
  email?: string | null;
};

type IntercomSdk = {
  default: (settings: IntercomSettings) => void;
  shutdown: () => void;
};
type IntercomSettings = {
  app_id: string;
  user_id?: string;
  email?: string;
  intercom_user_jwt?: string;
};

type IntercomJwtResponse = {
  data?: {
    token?: string;
  };
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

const fetchIntercomUserJwt = async () => {
  // Keep the authenticated-only edge client out of the public initial bundle.
  // Anonymous visitors only need the Intercom SDK, while this path is loaded
  // after a signed-in user is detected.
  const { invokeEdgeFunction } = await import("./edgeFunctionClient");
  const result = await invokeEdgeFunction<IntercomJwtResponse>("intercom-jwt", {
    method: "POST",
  });
  const token = result.data?.data?.token?.trim();
  if (!result.ok || !token) {
    throw new Error(result.error || "Messenger security token unavailable.");
  }
  return token;
};

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
        // Vite/Rolldown can wrap this CommonJS package twice in production,
        // yielding either module.default(settings) or
        // module.default.default(settings). Normalize both shapes here.
        const candidate = module.default as unknown;
        if (typeof candidate === "function") {
          sdk = module as unknown as IntercomSdk;
          return sdk;
        }

        if (candidate && typeof candidate === "object") {
          const nested = candidate as Partial<IntercomSdk>;
          if (typeof nested.default === "function" && typeof nested.shutdown === "function") {
            sdk = nested as IntercomSdk;
            return sdk;
          }
        }

        throw new TypeError("Unexpected Intercom SDK module shape.");
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
    const bootSettings = settings.user_id
      ? {
          // Keep identifying attributes inside the signed JWT. Intercom can
          // enforce that these values are only updated by a verified request.
          app_id: settings.app_id,
          intercom_user_jwt: await fetchIntercomUserJwt(),
        }
      : settings;
    if (generation !== syncGeneration) return;

    const intercom = await loadSdk();
    if (generation !== syncGeneration) return;
    intercom.default(bootSettings);
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
