const PASSWORD_RESET_PATH = "/reset-password";
const PRODUCTION_PASSWORD_RESET_URL = "https://www.itemtraxx.com/reset-password";
const PRODUCTION_HOSTS = new Set(["itemtraxx.com", "www.itemtraxx.com"]);

const parseHashParams = (hash: string) =>
  new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);

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
