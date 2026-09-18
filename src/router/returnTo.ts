const INTERNAL_REDIRECT_ORIGIN = "https://itemtraxx.invalid";
const MAX_RETURN_TO_LENGTH = 2048;

/**
 * Keep login return targets local to the current application. Absolute URLs,
 * protocol-relative URLs, login loops, and malformed values are rejected so a
 * query parameter can never become an open redirect.
 */
export const sanitizeReturnTo = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_RETURN_TO_LENGTH ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//")
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate, INTERNAL_REDIRECT_ORIGIN);
    if (parsed.origin !== INTERNAL_REDIRECT_ORIGIN) return null;
    if (parsed.pathname === "/login" || parsed.pathname.startsWith("/login/")) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

export const addLoginContext = (
  path: string,
  loginContext: "admin_login" | "regular_login",
) => {
  const safePath = sanitizeReturnTo(path) ?? "/";
  const parsed = new URL(safePath, INTERNAL_REDIRECT_ORIGIN);
  parsed.searchParams.set("login_ctx", loginContext);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};
