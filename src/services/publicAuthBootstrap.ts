import { clearAuthState } from "../store/authState";
import { fetchHttpSessionSummary, isSessionNetworkError } from "./httpSessionService";

const LEGACY_AUTH_FRAGMENT_KEYS = ["itx_hc", "itx_th", "itx_at", "itx_rt"];

const SESSION_PROBE_RETRY_DELAY_MS = 500;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

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

// This probe answers "does this visitor already have a session?" while a public
// page such as /admin/login is booting. It runs once, fire-and-forget, so a
// single transport blip would otherwise leave an already signed-in admin looking
// anonymous for the rest of the page's life — and re-entering credentials they
// did not need. One cheap retry covers that; the caller's bootstrap timeout
// still bounds the whole attempt. Only transport failures are retried: a server
// that answered has given a real answer.
const probeHttpSessionSummary = async () => {
  try {
    return await fetchHttpSessionSummary();
  } catch (error) {
    if (!isSessionNetworkError(error)) throw error;
    await delay(SESSION_PROBE_RETRY_DELAY_MS);
    return await fetchHttpSessionSummary();
  }
};

export const refreshPublicAuthFromSession = async (): Promise<void> => {
  const summary = await probeHttpSessionSummary();
  if (!summary.authenticated || !summary.user) {
    clearAuthState(true);
    return;
  }
  const { applyHttpSessionSummary, initAuthListener } = await import("./authService");
  await applyHttpSessionSummary(summary);
  initAuthListener();
};
