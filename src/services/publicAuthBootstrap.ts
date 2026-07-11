import { clearAuthState } from "../store/authState";
import { fetchHttpSessionSummary } from "./httpSessionService";

const HANDOFF_KEYS = ["itx_hc", "itx_th", "itx_at", "itx_rt"];

export const hasDistrictSessionHandoff = (hash = window.location.hash): boolean => {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return HANDOFF_KEYS.some((key) => params.has(key));
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
