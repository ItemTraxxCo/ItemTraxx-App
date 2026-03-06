import { supabase } from "./supabaseClient";

const DISTRICT_HANDOFF_MARKER_KEY = "itemtraxx:district-handoff-at";
const DISTRICT_HANDOFF_GRACE_MS = 60_000;

const isRecentDistrictHandoff = () => {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(DISTRICT_HANDOFF_MARKER_KEY);
    if (!raw) return false;
    const value = Number(raw);
    return Number.isFinite(value) && Date.now() - value < DISTRICT_HANDOFF_GRACE_MS;
  } catch {
    return false;
  }
};

export const getFreshAccessToken = async () => {
  const { data: currentData, error: currentError } = await supabase.auth.getSession();
  if (!currentError && currentData.session?.access_token) {
    if (isRecentDistrictHandoff()) {
      return currentData.session.access_token;
    }
  }

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data.session?.access_token;
  if (!refreshed.error && refreshedToken) {
    return refreshedToken;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Unauthorized");
  }

  return data.session.access_token;
};
