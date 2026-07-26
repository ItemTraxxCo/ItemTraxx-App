import { clearAuthState } from "../store/authState";
import { fetchHttpSessionSummary } from "./httpSessionService";

const LEGACY_AUTH_FRAGMENT_KEYS = ["itx_hc", "itx_th", "itx_at", "itx_rt"];

export const hasLegacyAuthFragment = (hash = window.location.hash): boolean => {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return LEGACY_AUTH_FRAGMENT_KEYS.some((key) => params.has(key));
};

export const scrubLegacyAuthFragment = () => {
  if (typeof window === "undefined" || !hasLegacyAuthFragment()) return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  for (const key of LEGACY_AUTH_FRAGMENT_KEYS) params.delete(key);
  const hash = params.toString();
  window.history.replaceState(
    {},
    document.title,
    `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`,
  );
};

export const refreshPublicAuthFromSession = async (): Promise<void> => {
  const summary = await fetchHttpSessionSummary();
  if (!summary.authenticated || !summary.user) {
    clearAuthState(true);
    return;
  }
  const { applyHttpSessionSummary, initAuthListener } = await import("./authService");
  await applyHttpSessionSummary(summary);
  initAuthListener();
};
