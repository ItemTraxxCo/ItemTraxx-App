const BETTER_AUTH_CAPTCHA_PATHS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/request-password-reset",
]);
const CAPTCHA_FORM_FIELD = "captchaResponse";

export const normalizeBetterAuthPathname = (pathname: string) => {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
};

/**
 * Keep password sign-in and reset requests CORS-simple even when Turnstile is
 * enabled. The browser sends the token as a form field (rather than the
 * non-safelisted x-captcha-response header); promote it back to the header only
 * inside the Worker, immediately before Better Auth's captcha middleware runs.
 */
export const normalizeBetterAuthCaptchaRequest = async (request: Request) => {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    !BETTER_AUTH_CAPTCHA_PATHS.has(normalizeBetterAuthPathname(url.pathname)) ||
    request.headers.has("x-captcha-response")
  ) {
    return request;
  }

  const rawContentType = request.headers.get("content-type");
  const contentType = rawContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return request;

  let form: FormData;
  try {
    form = await request.clone().formData();
  } catch {
    return request;
  }

  const rawToken = form.get(CAPTCHA_FORM_FIELD);
  if (typeof rawToken !== "string" || !rawToken.trim()) return request;

  const body = new URLSearchParams();
  form.forEach((value, key) => {
    if (key !== CAPTCHA_FORM_FIELD && typeof value === "string") {
      body.append(key, value);
    }
  });
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("x-captcha-response", rawToken.trim());
  headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  return new Request(request, { headers, body: body.toString() });
};
