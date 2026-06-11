const COOKIE_CONSENT_STORAGE_KEY = "itemtraxx-cookie-consent";
const COOKIE_CONSENT_VERSION = 2;
const COOKIE_CONSENT_SUBJECT_KEY = "itemtraxx-cookie-consent-subject";

export type CookieConsentPreferences = {
  analytics: boolean;
  diagnostics: boolean;
};

export type CookieConsentState = {
  version: number;
  preferences: CookieConsentPreferences;
  updatedAt: string;
};

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const readCookieConsent = (): CookieConsentState | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentState>;
    if (parsed.version === 1 && (parsed as { choice?: unknown }).choice) {
      const choice = (parsed as { choice?: unknown }).choice;
      if ((choice === "essential" || choice === "all") && typeof parsed.updatedAt === "string") {
        return {
          version: COOKIE_CONSENT_VERSION,
          preferences: {
            analytics: choice === "all",
            diagnostics: choice === "all",
          },
          updatedAt: parsed.updatedAt,
        };
      }
    }
    if (
      parsed.version !== COOKIE_CONSENT_VERSION ||
      typeof parsed.preferences?.analytics !== "boolean" ||
      typeof parsed.preferences?.diagnostics !== "boolean" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      version: COOKIE_CONSENT_VERSION,
      preferences: parsed.preferences,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
};

export const writeCookieConsent = (preferences: CookieConsentPreferences) => {
  if (!isBrowser()) return;
  const next: CookieConsentState = {
    version: COOKIE_CONSENT_VERSION,
    preferences,
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("itemtraxx:cookie-consent", { detail: next }));
  } catch {
    // Ignore localStorage failures.
  }
};

export const getOrCreateCookieConsentSubject = () => {
  if (!isBrowser()) return "";
  const existing = window.localStorage.getItem(COOKIE_CONSENT_SUBJECT_KEY);
  if (existing) return existing;
  const subject = crypto.randomUUID();
  window.localStorage.setItem(COOKIE_CONSENT_SUBJECT_KEY, subject);
  return subject;
};

export const allowsAnalytics = (state: CookieConsentState | null) => state?.preferences.analytics === true;
export const allowsDiagnostics = (state: CookieConsentState | null) => state?.preferences.diagnostics === true;
export const allowsSessionReplay = (state: CookieConsentState | null) => state?.preferences.diagnostics === true;
export const hasCookieConsent = (state: CookieConsentState | null) => state !== null;
