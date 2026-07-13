import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_KILL_SWITCH_MESSAGE,
} from "./constants.ts";
import { isLocalhostOrigin, parseCsv, withCorsHeaders } from "./cors.ts";
import { proxyFunctionRequest } from "./functionProxy.ts";
import {
  maybeReportWorkerResponse,
  reportWorkerException,
} from "./observability.ts";
import { buildError, buildJson } from "./responses.ts";
import {
  getFunctionName,
  getSessionAction,
  isBlockedRpcProxyPath,
  isRestProxyPath,
  isRpcProxyPath,
} from "./routing.ts";
import { handleSessionRequest } from "./session.ts";
import { proxySupabaseApiRequest } from "./supabaseApiProxy.ts";

export { checkSessionRateLimit } from "./session.ts";

const resolveKillSwitchMessage = (env: Env) =>
  env.ITX_ITEMTRAXX_KILLSWITCH_MESSAGE?.trim() || DEFAULT_KILL_SWITCH_MESSAGE;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const requestId = request.headers.get("x-request-id") ??
      (typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : "itx-edge-request");
    const allowedOrigins = Array.from(
      new Set([...DEFAULT_ALLOWED_ORIGINS, ...parseCsv(env.ALLOWED_ORIGINS)]),
    );
    const { originAllowed, headers } = withCorsHeaders(
      origin,
      allowedOrigins,
      env,
    );

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

      if (url.pathname === "/turnstile-policy" && request.method === "GET") {
        return buildJson(200, { bypass_turnstile: false }, headers, requestId);
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
        });
        return response;
      }

      const sessionAction = getSessionAction(url.pathname);
      if (sessionAction) {
        const response = await handleSessionRequest(
          request,
          env,
          headers,
          requestId,
          sessionAction,
          allowedOrigins,
        );
        maybeReportWorkerResponse(env, request, requestId, response, ctx, {
          type: "session",
          action: sessionAction,
        });
        return response;
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
        const response = await proxySupabaseApiRequest(
          request,
          env,
          headers,
          requestId,
          url.pathname,
        );
        maybeReportWorkerResponse(env, request, requestId, response, ctx, {
          type: "rest",
          path: url.pathname,
        });
        return response;
      }

      const functionName = getFunctionName(url.pathname);
      if (!functionName) {
        return buildError(404, "Not found", headers, requestId);
      }

      const killSwitchEnabled =
        (env.ITX_ITEMTRAXX_KILLSWITCH_ENABLED ?? "").toLowerCase() === "true";
      if (
        killSwitchEnabled && functionName !== "system-status" &&
        !isLocalhostOrigin(origin)
      ) {
        const response = buildError(
          503,
          resolveKillSwitchMessage(env),
          headers,
          requestId,
        );
        maybeReportWorkerResponse(env, request, requestId, response, ctx, {
          type: "kill_switch",
          functionName,
        });
        return response;
      }

      const allowedFunctions = parseCsv(env.ALLOWED_FUNCTIONS);
      if (
        allowedFunctions.length > 0 && !allowedFunctions.includes(functionName)
      ) {
        return buildError(403, "Function not allowed", headers, requestId);
      }

      const response = await proxyFunctionRequest(
        request,
        env,
        headers,
        requestId,
        functionName,
      );
      maybeReportWorkerResponse(env, request, requestId, response, ctx, {
        type: "function",
        functionName,
      });
      return response;
    } catch (error) {
      ctx.waitUntil(reportWorkerException(env, request, requestId, error));
      return buildError(500, "Internal worker error", headers, requestId);
    }
  },
} satisfies ExportedHandler<Env>;
