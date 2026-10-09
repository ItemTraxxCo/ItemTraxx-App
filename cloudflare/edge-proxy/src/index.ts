import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_KILL_SWITCH_MESSAGE,
} from "./constants.ts";
import { isLocalhostOrigin, parseCsv, withCorsHeaders } from "./cors.ts";
import { proxyFunctionRequest } from "./functionProxy.ts";
import {
  maybeReportWorkerResponse,
  reportWorkerException,
  withWorkerRequestTelemetry,
} from "./observability.ts";
import { buildError } from "./responses.ts";
import {
  getFunctionName,
  isAllowedRestRequest,
  isAllowedRpcProxyPath,
  isBlockedRpcProxyPath,
  isRestProxyPath,
  isRpcProxyPath,
} from "./routing.ts";
import { proxySupabaseApiRequest } from "./supabaseApiProxy.ts";
import { isItemTraxxHostname } from "./url.ts";
import { enforcePublicRequestLimit } from "./publicRequestRateLimit.ts";
import { normalizeBetterAuthPathname } from "./authCaptcha.ts";
import { handleMtaStsRequest, isMtaStsRequest } from "./mtaSts.ts";
import {
  handleBetterAuthRequest,
  getBetterAuth,
  handleInternalAuthAdminRequest,
  handleOrganizationLogoRead,
  handleOrganizationLogoUpload,
  handleSsoManagementRequest,
} from "./auth.ts";
import {
  createSsoLoginProof,
  isSessionCreatedDuringSsoCallback,
} from "../../../supabase/functions/_shared/ssoLoginProvenance.ts";

const resolveKillSwitchMessage = (env: Env) =>
  env.ITX_ITEMTRAXX_KILLSWITCH_MESSAGE?.trim() || DEFAULT_KILL_SWITCH_MESSAGE;

const PUBLIC_AUTH_RATE_LIMIT_SCOPES = new Map([
  ["/api/auth/sign-in/email", "better-auth-email-sign-in"],
  ["/api/auth/request-password-reset", "better-auth-password-reset"],
]);

// `env` is fixed for the life of an isolate, but these two allowlists were
// rebuilt on every request: a CSV split plus a Set union for origins, and a
// second CSV split of ~24 entries for functions. Memoize per isolate, keyed on
// the raw string so a different env (tests, a config change) recomputes rather
// than serving a stale allowlist. Functions become a Set for O(1) membership.
let cachedOriginsKey: string | null = null;
let cachedOrigins: string[] = [];

const resolveAllowedOrigins = (env: Env) => {
  const raw = env.ALLOWED_ORIGINS ?? "";
  if (raw !== cachedOriginsKey) {
    cachedOriginsKey = raw;
    cachedOrigins = Array.from(
      new Set([...DEFAULT_ALLOWED_ORIGINS, ...parseCsv(raw)]),
    );
  }
  return cachedOrigins;
};

let cachedFunctionsKey: string | null = null;
let cachedFunctions: Set<string> = new Set();

const resolveAllowedFunctions = (env: Env) => {
  const raw = env.ALLOWED_FUNCTIONS ?? "";
  if (raw !== cachedFunctionsKey) {
    cachedFunctionsKey = raw;
    cachedFunctions = new Set(parseCsv(raw));
  }
  return cachedFunctions;
};

const isSamlIdpFormPost = (request: Request, url: URL) => {
  const samlCallbackPath =
    /^\/api\/auth\/sso\/saml2\/sp\/(?:acs|slo)\/[a-z0-9._~-]+$/i;
  const contentType = request.headers.get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();

  return request.method === "POST" &&
    Boolean(request.headers.get("Origin")) &&
    samlCallbackPath.test(url.pathname) &&
    contentType === "application/x-www-form-urlencoded";
};

export const resolveSsoCallbackContext = (request: Request) => {
  const pathname = new URL(request.url).pathname;
  const samlMatch = pathname.match(
    /^\/api\/auth\/sso\/saml2\/sp\/acs\/([a-z0-9-]+)$/i,
  );
  if (samlMatch?.[1] && request.method === "POST") {
    return { providerId: samlMatch[1], protocol: "SAML2.0" } as const;
  }

  const oidcMatch = pathname.match(
    /^\/api\/auth\/sso\/callback\/([a-z0-9-]+)$/i,
  );
  if (
    oidcMatch?.[1] && (request.method === "GET" || request.method === "POST")
  ) {
    return {
      providerId: oidcMatch[1],
      protocol: "OpenID Connect (OIDC)",
    } as const;
  }

  return null;
};

export const getCookieHeaderFromSetCookies = (headers: Headers) => {
  const maybeExtended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof maybeExtended.getSetCookie !== "function") return null;

  const cookies = new Map<string, string>();
  const setCookies = maybeExtended.getSetCookie();
  if (setCookies.length > 32) return null;
  for (const setCookie of setCookies) {
    const cookiePair = setCookie.split(";", 1)[0]?.trim();
    const separator = cookiePair?.indexOf("=") ?? -1;
    if (separator <= 0) continue;
    const name = cookiePair!.slice(0, separator).trim();
    if (!name) continue;
    cookies.set(name, cookiePair!.slice(separator + 1));
  }

  if (cookies.size === 0) return null;
  const cookieHeader = Array.from(
    cookies,
    ([name, value]) => `${name}=${value}`,
  ).join("; ");
  return cookieHeader.length <= 8192 ? cookieHeader : null;
};

const createSsoCallbackProof = async (
  response: Response,
  env: Env,
  context: {
    providerId: string;
    protocol: "SAML2.0" | "OpenID Connect (OIDC)";
  },
  callbackStartedAtMs: number,
  existingSessionId: string | null,
) => {
  const cookie = getCookieHeaderFromSetCookies(response.headers);
  if (!cookie || !env.ITX_INTERNAL_AUTH_SECRET?.trim()) return null;

  try {
    const session = await getBetterAuth(env).api.getSession({
      headers: new Headers({ cookie }),
    });
    const betterAuthUserId = session?.user?.id?.trim();
    const sessionId = session?.session?.id?.trim();
    if (
      !session || !betterAuthUserId || !sessionId ||
      !isSessionCreatedDuringSsoCallback(
        session.session.createdAt,
        callbackStartedAtMs,
        Date.now(),
        existingSessionId,
        sessionId,
      )
    ) return null;

    return await createSsoLoginProof(env.ITX_INTERNAL_AUTH_SECRET, {
      ...context,
      betterAuthUserId,
      sessionId,
    });
  } catch {
    // Provenance is best-effort metadata. A failure here must not interrupt a
    // successful SSO sign-in, and no unverified provider claim is forwarded.
    return null;
  }
};

export const attachSsoLoginProof = (
  response: Response,
  requestUrl: URL,
  proof: string | null,
) => {
  if (!proof) return response;
  const location = response.headers.get("Location");
  if (response.status < 300 || response.status >= 400 || !location) {
    return response;
  }

  try {
    const redirectUrl = new URL(location, requestUrl);
    const allowedDestination = (redirectUrl.protocol === "https:" &&
      isItemTraxxHostname(redirectUrl.hostname)) ||
      isLocalhostOrigin(redirectUrl.origin);
    if (
      !allowedDestination ||
      redirectUrl.searchParams.has("error") ||
      redirectUrl.searchParams.has("error_description")
    ) {
      return response;
    }
    redirectUrl.searchParams.delete("itx_sso_provider_id");
    redirectUrl.searchParams.delete("itx_sso_protocol");
    redirectUrl.searchParams.set("itx_sso_proof", proof);

    const headers = new Headers(response.headers);
    headers.set("Location", redirectUrl.toString());
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // MTA-STS policy retrieval is deliberately isolated from the API proxy's
    // CORS/auth/origin checks. Mail senders do not send a browser Origin, and
    // the policy host must serve a small unauthenticated HTTPS document.
    if (isMtaStsRequest(url)) {
      return handleMtaStsRequest(request, url);
    }

    return withWorkerRequestTelemetry(request, env, ctx, async ({
      requestId,
      trace,
      tracedRequest,
    }) => {
      const origin = request.headers.get("Origin");
      const allowedOrigins = resolveAllowedOrigins(env);
      const { originAllowed: corsOriginAllowed, headers } = withCorsHeaders(
        origin,
        allowedOrigins,
        env,
      );
      // SAML HTTP-POST binding is cross-origin by design. Better Auth validates
      // these assertions and skips origin checks on ACS/SLO callbacks. Accept
      // form posts from any IdP on those exact routes only; external IdPs stay
      // out of the general credentialed API origin allowlist.
      const originAllowed = corsOriginAllowed ||
        isSamlIdpFormPost(request, url);

      try {
        if (request.method === "OPTIONS") {
          if (!originAllowed) {
            return new Response("Origin not allowed", { status: 403, headers });
          }
          return new Response("ok", { headers });
        }

        if (!originAllowed) {
          return buildError(403, "Origin not allowed", headers, requestId);
        }

        // Keep the server-to-server Better Auth administration bridge under the
        // authenticated API namespace. Cloudflare's managed bot challenge can
        // challenge non-browser requests to otherwise-unrecognised `/api/*`
        // paths (including calls originating in Supabase Edge Functions). The
        // bridge still requires ITX_INTERNAL_AUTH_SECRET; this path placement
        // only makes the request routable and does not grant any access.
        if (url.pathname === "/api/auth/internal-admin") {
          return handleInternalAuthAdminRequest(tracedRequest, env);
        }

        const organizationLogoMatch = url.pathname.match(
          /^\/api\/organization\/([0-9a-f-]{36})\/logo(?:\/(logo-current|logo-[0-9a-f-]{36}\.(?:png|jpg|webp)))?$/i,
        );
        if (organizationLogoMatch) {
          const logoFileName = organizationLogoMatch[2];
          const logoResponse = logoFileName
            ? await handleOrganizationLogoRead(
              tracedRequest,
              env,
              organizationLogoMatch[1] ?? "",
              logoFileName,
            )
            : await handleOrganizationLogoUpload(
              tracedRequest,
              env,
              organizationLogoMatch[1] ?? "",
            );
          const responseHeaders = new Headers(logoResponse.headers);
          Object.entries(headers).forEach(([key, value]) =>
            responseHeaders.set(key, value)
          );
          responseHeaders.set("x-request-id", requestId);
          return new Response(logoResponse.body, {
            status: logoResponse.status,
            headers: responseHeaders,
          });
        }

        if (url.pathname.startsWith("/api/auth/")) {
          const authPathname = normalizeBetterAuthPathname(url.pathname);
          const rateLimitScope = request.method === "POST"
            ? PUBLIC_AUTH_RATE_LIMIT_SCOPES.get(authPathname)
            : undefined;
          if (rateLimitScope) {
            const admitted = await enforcePublicRequestLimit(
              env.PUBLIC_AUTH_RATE_LIMITER,
              tracedRequest,
              rateLimitScope,
            );
            if (!admitted.allowed) {
              const isPasswordReset =
                authPathname === "/api/auth/request-password-reset";
              return buildError(
                admitted.unavailable ? 503 : 429,
                admitted.unavailable
                  ? "Authentication admission is unavailable"
                  : isPasswordReset
                  ? "Too many password reset attempts"
                  : "Too many sign-in attempts",
                headers,
                requestId,
              );
            }
          }
          const ssoCallback = resolveSsoCallbackContext(tracedRequest);
          let existingSessionId: string | null = null;
          let existingSessionLookupFailed = false;
          if (ssoCallback) {
            try {
              const existingSession = await getBetterAuth(env).api.getSession({
                headers: tracedRequest.headers,
              });
              existingSessionId = existingSession?.session?.id?.trim() || null;
            } catch {
              existingSessionLookupFailed = true;
            }
          }
          const callbackStartedAtMs = Date.now();
          let authResponse = await handleBetterAuthRequest(
            tracedRequest,
            env,
          );
          if (ssoCallback && !existingSessionLookupFailed) {
            const proof = await createSsoCallbackProof(
              authResponse,
              env,
              ssoCallback,
              callbackStartedAtMs,
              existingSessionId,
            );
            authResponse = attachSsoLoginProof(authResponse, url, proof);
          }
          const responseHeaders = new Headers(authResponse.headers);
          Object.entries(headers).forEach(([key, value]) =>
            responseHeaders.set(key, value)
          );
          responseHeaders.set("x-request-id", requestId);
          return new Response(authResponse.body, {
            status: authResponse.status,
            headers: responseHeaders,
          });
        }

        if (url.pathname === "/api/itemtraxx/sso/providers") {
          const managementResponse = await handleSsoManagementRequest(
            tracedRequest,
            env,
          );
          const responseHeaders = new Headers(managementResponse.headers);
          Object.entries(headers).forEach(([key, value]) =>
            responseHeaders.set(key, value)
          );
          return new Response(managementResponse.body, {
            status: managementResponse.status,
            headers: responseHeaders,
          });
        }

        if (url.pathname === "/api/internal/auth-admin") {
          return handleInternalAuthAdminRequest(tracedRequest, env);
        }

        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
          const response = buildError(
            500,
            "Proxy misconfiguration",
            headers,
            requestId,
          );
          maybeReportWorkerResponse(env, request, requestId, response, ctx, {
            type: "proxy_misconfiguration",
          }, trace);
          return response;
        }

        const killSwitchEnabled =
          (env.ITX_ITEMTRAXX_KILLSWITCH_ENABLED ?? "").toLowerCase() === "true";
        const killSwitchBlocksRequest = killSwitchEnabled &&
          !isLocalhostOrigin(origin);
        const buildKillSwitchResponse = (extra: Record<string, unknown>) => {
          const response = buildError(
            503,
            resolveKillSwitchMessage(env),
            headers,
            requestId,
          );
          maybeReportWorkerResponse(env, request, requestId, response, ctx, {
            type: "kill_switch",
            ...extra,
          }, trace);
          return response;
        };

        // REST and RPC requests return from this branch, so they must be checked
        // before dispatch. Otherwise a kill-switch incident still permits table
        // reads and direct audit-log writes through the PostgREST pass-through.
        if (
          killSwitchBlocksRequest &&
          (isRestProxyPath(url.pathname) || isRpcProxyPath(url.pathname))
        ) {
          return buildKillSwitchResponse({ path: url.pathname });
        }

        if (isBlockedRpcProxyPath(url.pathname)) {
          return buildError(
            403,
            "RPC proxy access is not allowed",
            headers,
            requestId,
          );
        }

        if (isRestProxyPath(url.pathname) || isRpcProxyPath(url.pathname)) {
          if (
            request.method !== "GET" &&
            request.method !== "HEAD" &&
            request.headers.get("x-itx-data-request") !== "1"
          ) {
            return buildError(400, "Invalid data request", headers, requestId);
          }
          // Table/method allowlist for the PostgREST pass-through. RPC paths keep
          // their own allowlist (checked above); everything else must be a
          // relation the SPA actually uses, so schema-level privilege drift
          // cannot become a browser-reachable data path.
          const isRpcPath = isRpcProxyPath(url.pathname) ||
            isAllowedRpcProxyPath(url.pathname);
          if (
            !isRpcPath &&
            !isAllowedRestRequest(url.pathname, request.method, url.search)
          ) {
            return buildError(
              403,
              "Data request not allowed",
              headers,
              requestId,
            );
          }
          const response = await proxySupabaseApiRequest(
            tracedRequest,
            env,
            headers,
            requestId,
            url.pathname,
          );
          maybeReportWorkerResponse(env, request, requestId, response, ctx, {
            type: "rest",
            path: url.pathname,
          }, trace);
          return response;
        }

        const functionName = getFunctionName(url.pathname);
        if (!functionName) {
          return buildError(404, "Not found", headers, requestId);
        }

        if (
          killSwitchBlocksRequest && functionName !== "system-status"
        ) {
          return buildKillSwitchResponse({ functionName });
        }

        const allowedFunctions = resolveAllowedFunctions(env);
        if (
          allowedFunctions.size === 0 || !allowedFunctions.has(functionName)
        ) {
          return buildError(
            allowedFunctions.size === 0 ? 503 : 403,
            allowedFunctions.size === 0
              ? "Function allowlist unavailable"
              : "Function not allowed",
            headers,
            requestId,
          );
        }

        const response = await proxyFunctionRequest(
          tracedRequest,
          env,
          headers,
          requestId,
          functionName,
        );
        maybeReportWorkerResponse(env, request, requestId, response, ctx, {
          type: "function",
          functionName,
        }, trace);
        return response;
      } catch (error) {
        reportWorkerException(env, request, requestId, error, {
          trace_id: trace.traceId,
          span_id: trace.spanId,
        });
        return buildError(500, "Internal worker error", headers, requestId);
      }
    });
  },
} satisfies ExportedHandler<Env>;
