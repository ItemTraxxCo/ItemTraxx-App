import { supabase } from "./supabaseClient";
import { unauthorizedError } from "./appErrors";

export const getFreshAccessToken = async () => {
  if (import.meta.env.VITE_E2E_TEST_UTILS === "true") {
    return "e2e-access-token";
  }

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data.session?.access_token;
  if (!refreshed.error && refreshedToken) {
    return refreshedToken;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw unauthorizedError();
  }

  return data.session.access_token;
};
