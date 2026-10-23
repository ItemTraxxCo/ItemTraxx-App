import { normalizeBetterAuthPathname } from "./authCaptcha.ts";
import { isItemTraxxHostname, trimTrailingSlash } from "./url.ts";

export const CANONICAL_PASSWORD_RESET_URL =
  "https://www.itemtraxx.com/reset-password";

const PASSWORD_RESET_REQUEST_PATH = "/api/auth/request-password-reset";
const PASSWORD_RESET_CALLBACK_PATH = /^\/api\/auth\/reset-password\/[^/]+$/;
const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1"]);
const ACCESS_PROTECTED_PASSWORD_RESET_HOSTS = new Set([
  "internal.itemtraxx.com",
  "itxinternal.app.itemtraxx.com",
]);

type PasswordResetEnvironment = {
  BETTER_AUTH_URL: string;
};

const isLocalBetterAuthEnvironment = (env: PasswordResetEnvironment) => {
  const baseURL = new URL(env.BETTER_AUTH_URL);
  return baseURL.protocol === "http:" && LOCALHOST_NAMES.has(baseURL.hostname);
};

const getDefaultPasswordResetURL = (env: PasswordResetEnvironment) => {
  if (isLocalBetterAuthEnvironment(env)) {
    return `${trimTrailingSlash(env.BETTER_AUTH_URL)}/reset-password`;
  }
  return CANONICAL_PASSWORD_RESET_URL;
};

/**
 * Password reset tokens are appended to the callback URL by Better Auth.
 * Keep that destination on the public reset page, even when a trusted origin
 * is also protected by Cloudflare Access.
 */
export const resolvePasswordResetRedirect = (
  env: PasswordResetEnvironment,
  requested: unknown,
) => {
  const isLocalEnvironment = isLocalBetterAuthEnvironment(env);
  const fallback = getDefaultPasswordResetURL(env);
  const configured = typeof requested === "string" && requested.trim()
    ? requested.trim()
    : fallback;
  const redirect = new URL(configured);
  const isLocal = redirect.protocol === "http:" &&
    LOCALHOST_NAMES.has(redirect.hostname);

  if (
    redirect.pathname !== "/reset-password" || redirect.search ||
    redirect.hash
  ) {
    throw new Error("Invalid password reset redirect");
  }

  if (isLocalEnvironment && isLocal) return redirect.toString();

  if (
    redirect.protocol !== "https:" ||
    !isItemTraxxHostname(redirect.hostname)
  ) {
    throw new Error("Invalid password reset redirect");
  }

  if (
    ACCESS_PROTECTED_PASSWORD_RESET_HOSTS.has(redirect.hostname) ||
    redirect.hostname === "itemtraxx.com"
  ) {
    return CANONICAL_PASSWORD_RESET_URL;
  }

  return redirect.toString();
};

const resolvePublicPasswordResetRedirect = (
  env: PasswordResetEnvironment,
  requested: unknown,
) => {
  try {
    return resolvePasswordResetRedirect(env, requested);
  } catch {
    return getDefaultPasswordResetURL(env);
  }
};

const badRequest = () =>
  Response.json({ message: "Invalid password reset request" }, { status: 400 });

const unsupportedContentType = () =>
  Response.json(
    { message: "Unsupported password reset request content type" },
    { status: 415 },
  );

const rebuildRequestWithBody = (request: Request, body: string) => {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, { headers, body });
};

/**
 * The public Better Auth endpoint validates redirectTo against the global
 * trustedOrigins list. Rewrite it here so a reset link can never target an
 * Access-protected origin. Also normalize callbackURL on the token callback:
 * Better Auth otherwise accepts any globally trusted origin and appends the
 * one-time reset token to it.
 */
export const normalizeBetterAuthPasswordResetRequest = async (
  request: Request,
  env: PasswordResetEnvironment,
): Promise<Request | Response> => {
  const url = new URL(request.url);
  const pathname = normalizeBetterAuthPathname(url.pathname);

  if (
    request.method === "GET" && PASSWORD_RESET_CALLBACK_PATH.test(pathname)
  ) {
    url.searchParams.set(
      "callbackURL",
      resolvePublicPasswordResetRedirect(
        env,
        url.searchParams.get("callbackURL"),
      ),
    );
    return new Request(url, request);
  }

  if (
    request.method !== "POST" || pathname !== PASSWORD_RESET_REQUEST_PATH
  ) {
    return request;
  }

  const contentType = ((request.headers.get("content-type") ?? "")
    .split(";", 1)[0] ?? "").trim().toLowerCase();

  if (contentType === "application/x-www-form-urlencoded") {
    const body = new URLSearchParams(await request.clone().text());
    body.set(
      "redirectTo",
      resolvePublicPasswordResetRedirect(env, body.get("redirectTo")),
    );
    return rebuildRequestWithBody(request, body.toString());
  }

  if (contentType === "application/json" || contentType?.endsWith("+json")) {
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      return badRequest();
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return badRequest();
    }
    const requested = (body as Record<string, unknown>).redirectTo;
    return rebuildRequestWithBody(
      request,
      JSON.stringify({
        ...body,
        redirectTo: resolvePublicPasswordResetRedirect(env, requested),
      }),
    );
  }

  return unsupportedContentType();
};
