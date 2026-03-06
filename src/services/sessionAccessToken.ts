import { supabase } from "./supabaseClient";

export const getFreshAccessToken = async () => {
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
