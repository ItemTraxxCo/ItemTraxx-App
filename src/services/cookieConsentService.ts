const COOKIE_CONSENT_STORAGE_KEY = "itemtraxx-cookie-consent";
const COOKIE_CONSENT_VERSION = 2;
const COOKIE_CONSENT_SUBJECT_KEY = "itemtraxx-cookie-consent-subject";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type CookieConsentPreferences = {
  analytics: boolean;
  diagnostics: boolean;
};

export type CookieConsentState = {
  version: number;
  preferences: CookieConsentPreferences;
  updatedAt: string;
};

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

const getCookieDomain = (): string | undefined => {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "itemtraxx.com" || hostname.endsWith(".itemtraxx.com")) return ".itemtraxx.com";
  return undefined;
};

const readCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

const writeCookie = (name: string, value: string) => {
  const domain = getCookieDomain();
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (domain) parts.push(`Domain=${domain}`);
  if (window.location.protocol === "https:") parts.push("Secure");
  document.cookie = parts.join("; ");
};

const migrateFromLocalStorage = (key: string): string | null => {
  if (typeof window.localStorage === "undefined") return null;
  try {
    const legacy = window.localStorage.getItem(key);
    if (!legacy) return null;
    window.localStorage.removeItem(key);
    return legacy;
  } catch {
    return null;
  }
};

export const readCookieConsent = (): CookieConsentState | null => {
  if (!isBrowser()) return null;
  try {
    const raw = readCookie(COOKIE_CONSENT_STORAGE_KEY) ?? migrateFromLocalStorage(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentState>;
    if (parsed.version === 1 && (parsed as { choice?: unknown }).choice) {
      const choice = (parsed as { choice?: unknown }).choice;
      if ((choice === "essential" || choice === "all") && typeof parsed.updatedAt === "string") {
        const migrated: CookieConsentState = {
          version: COOKIE_CONSENT_VERSION,
          preferences: {
            analytics: choice === "all",
            diagnostics: choice === "all",
          },
          updatedAt: parsed.updatedAt,
        };
        writeCookie(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
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
    const state: CookieConsentState = {
      version: COOKIE_CONSENT_VERSION,
      preferences: parsed.preferences,
      updatedAt: parsed.updatedAt,
    };
    writeCookie(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(state));
    return state;
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
    writeCookie(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("itemtraxx:cookie-consent", { detail: next }));
  } catch {
    // Ignore cookie write failures.
  }
};

export const getOrCreateCookieConsentSubject = () => {
  if (!isBrowser()) return "";
  const existing = readCookie(COOKIE_CONSENT_SUBJECT_KEY) ?? migrateFromLocalStorage(COOKIE_CONSENT_SUBJECT_KEY);
  if (existing) {
    writeCookie(COOKIE_CONSENT_SUBJECT_KEY, existing);
    return existing;
  }
  const subject = crypto.randomUUID();
  writeCookie(COOKIE_CONSENT_SUBJECT_KEY, subject);
  return subject;
};

export const allowsAnalytics = (state: CookieConsentState | null) => state?.preferences.analytics === true;
export const allowsDiagnostics = (state: CookieConsentState | null) => state?.preferences.diagnostics === true;
export const allowsSessionReplay = (state: CookieConsentState | null) => state?.preferences.diagnostics === true;
export const hasCookieConsent = (state: CookieConsentState | null) => state !== null;

export const clearAnalyticsPersistence = () => {
  if (!isBrowser()) return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("ph_")) window.localStorage.removeItem(key);
    }
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith("ph_")) window.sessionStorage.removeItem(key);
    }
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=", 1)[0]?.trim();
      if (!name?.startsWith("ph_")) continue;
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  } catch {
    // Storage cleanup is best-effort.
  }
};
