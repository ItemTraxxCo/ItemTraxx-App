import { supabase } from "./supabaseClient";

const getErrorText = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return String(error ?? "");
  }
  const record = error as Record<string, unknown>;
  return [record.code, record.error_code, record.message, record.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
};

const getErrorStatus = (error: unknown) => {
  if (!error || typeof error !== "object") return null;
  const status = (error as Record<string, unknown>).status;
  return typeof status === "number" ? status : null;
};

const isMissingLocalSessionError = (error: unknown) => {
  const text = getErrorText(error);
  return text.includes("session_not_found") || (getErrorStatus(error) === 403 && text.includes("session"));
};

export const signOutLocalSupabaseSession = async () => {
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error && !isMissingLocalSessionError(error)) {
      throw error;
    }
  } catch (error) {
    if (!isMissingLocalSessionError(error)) {
      throw error;
    }
  }
};
