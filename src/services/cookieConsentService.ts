const COOKIE_CONSENT_STORAGE_KEY = "itemtraxx-cookie-consent";
const COOKIE_CONSENT_VERSION = 1;

export type CookieConsentChoice = "essential" | "all";

export type CookieConsentState = {
  version: number;
  choice: CookieConsentChoice;
  updatedAt: string;
};

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const readCookieConsent = (): CookieConsentState | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentState>;
    if (
      parsed.version !== COOKIE_CONSENT_VERSION ||
      (parsed.choice !== "essential" && parsed.choice !== "all") ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      version: COOKIE_CONSENT_VERSION,
      choice: parsed.choice,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
};

export const writeCookieConsent = (choice: CookieConsentChoice) => {
  if (!isBrowser()) return;
  const next: CookieConsentState = {
    version: COOKIE_CONSENT_VERSION,
    choice,
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("itemtraxx:cookie-consent", { detail: next }));
  } catch {
    // Ignore localStorage failures.
  }
};

export const allowsAnalytics = (state: CookieConsentState | null) => state?.choice === "all";
export const allowsDiagnostics = (state: CookieConsentState | null) => state?.choice === "all";
export const allowsSessionReplay = (state: CookieConsentState | null) => state?.choice === "all";
export const hasCookieConsent = (state: CookieConsentState | null) => state !== null;
