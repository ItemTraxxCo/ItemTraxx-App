export const PASSWORD_RESET_PATH = "/reset-password";
const PRODUCTION_PASSWORD_RESET_URL = "https://www.itemtraxx.com/reset-password";
const PRODUCTION_HOSTS = new Set(["itemtraxx.com", "www.itemtraxx.com"]);
const isPasswordResetPath = (pathname: string) =>
  pathname.toLowerCase().replace(/\/+$/, "") === PASSWORD_RESET_PATH;

const parseHashParams = (hash: string) =>
  new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);

/**
 * Remove recovery query/hash material after Supabase has had a chance to
 * consume it. A path-only history entry prevents browser history, referrers,
 * and pageview/pageleave telemetry from retaining bearer tokens or reset
 * codes.
 */
export const scrubSensitiveRecoveryUrl = () => {
  if (typeof window === "undefined") return false;
  if (!isPasswordResetPath(window.location.pathname)) return false;
  // Treat every query/hash value on the reset path as sensitive. Recovery
  // providers can add new parameter names, and a path-only entry is the
  // safest stable contract for browser history and referrer telemetry.
  if (!window.location.search && !window.location.hash) return false;
  window.history.replaceState(
    window.history.state,
    document.title,
    PASSWORD_RESET_PATH,
  );
  return true;
};

export const scrubSensitiveRecoveryUrlValue = (value: string) => {
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  try {
    const base = typeof window !== "undefined"
      ? window.location.origin
      : "https://www.itemtraxx.com";
    const url = new URL(value, base);
    if (!isPasswordResetPath(url.pathname) || (!url.search && !url.hash)) {
      return value;
    }
    url.search = "";
    url.hash = "";
    return isAbsolute ? url.toString() : PASSWORD_RESET_PATH;
  } catch {
    return value;
  }
};

export const getPasswordResetRedirectUrl = () => {
  if (typeof window === "undefined") {
    return PRODUCTION_PASSWORD_RESET_URL;
  }

  const hostname = window.location.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(hostname)) {
    return PRODUCTION_PASSWORD_RESET_URL;
  }

  return `${window.location.origin}${PASSWORD_RESET_PATH}`;
};

export const routeRecoveryLinksToResetPassword = () => {
  if (typeof window === "undefined") {
    return;
  }

  if (window.location.pathname === PASSWORD_RESET_PATH) {
    return;
  }

  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = parseHashParams(window.location.hash);
  const isRecoveryLink =
    queryParams.get("type") === "recovery" || hashParams.get("type") === "recovery";

  if (!isRecoveryLink) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    document.title,
    `${PASSWORD_RESET_PATH}${window.location.search}${window.location.hash}`
  );
};
