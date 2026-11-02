import {
  appendSetCookies,
  clearLegacySessionCookies,
  parseCookies,
} from "./cookies.ts";
import { hasRpcCallerAuth, sanitizeUpstreamHeaders } from "./requestHeaders.ts";
import {
  MAX_PROXY_REQUEST_BODY_BYTES,
  readBoundedRequestBody,
  RequestBodyLimitError,
} from "./requestBody.ts";
import { buildError, buildSessionRateLimitError } from "./responses.ts";
import {
  isBlockedRpcProxyPath,
  isRpcProxyPath,
  isUnauthorizedRpcProxyPath,
} from "./routing.ts";
import { getSupabaseAccessToken } from "./auth.ts";
import { applyTrustedIngressHeaders } from "./trustedIngress.ts";
import { getRestTableName } from "./routing.ts";
import { trimTrailingSlash } from "./url.ts";

const MAX_AUDIT_RESPONSE_BYTES = 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDITABLE_ITEM_TABLES = new Set([
  "items",
  "item_access_grants",
  "item_logs",
  "item_status_history",
]);

const readAuditRows = async (response: Response) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIT_RESPONSE_BYTES) return [];
  const reader = response.clone().body?.getReader();
  if (!reader) return [];
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_AUDIT_RESPONSE_BYTES) {
        await reader.cancel();
        return [];
      }
      chunks.push(value);
    }
  } catch {
    return [];
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
};

const idsFromPostgrestFilter = (value: string | null) => {
  if (!value) return [];
  const equality = value.match(/^eq\.([0-9a-f-]+)$/i);
  const inList = value.match(/^in\.\(([^()]*)\)$/i);
  const candidates = equality?.[1]
    ? [equality[1]]
    : inList?.[1]
    ? inList[1].split(",")
    : [];
  return candidates.filter((candidate) => UUID_RE.test(candidate));
};

/** Persist IDs returned by sensitive PostgREST reads through the signed Edge Function path. */
export const auditSuccessfulSupabaseRead = async (
  request: Request,
  env: Env,
  requestId: string,
  upstreamPath: string,
  sessionToken: string,
  upstreamResponse: Response,
) => {
  if (upstreamResponse.status < 200 || upstreamResponse.status >= 300) return;
  const table = getRestTableName(upstreamPath);
  if (!AUDITABLE_ITEM_TABLES.has(table)) return;
  const url = new URL(request.url);
  const rows = await readAuditRows(upstreamResponse);
  const targetIds = rows.flatMap((row) => {
    const value = table === "items" ? row.id : row.item_id;
    return typeof value === "string" && UUID_RE.test(value) ? [value] : [];
  });
  const targetFilter = table === "items" ? "id" : "item_id";
  const targetIdFilters = idsFromPostgrestFilter(url.searchParams.get(targetFilter));
  const itemIds = [...new Set([...targetIds, ...targetIdFilters])].slice(0, 5_000);
  if (!itemIds.length) return;

  const action = targetIdFilters.length > 0
    ? "read_item_target"
    : table === "items"
    ? "read_items"
    : table === "item_access_grants"
    ? "read_access_grants"
    : table === "item_status_history"
    ? "read_status_history"
    : "read_item_activity";
  const supabaseUrl = trimTrailingSlash(env.SUPABASE_URL ?? "");
  if (!supabaseUrl || !env.SUPABASE_ANON_KEY || !env.ITX_EDGE_PROXY_SHARED_SECRET?.trim()) {
    console.error(JSON.stringify({
      event: "security_audit.proxy_misconfigured",
      request_id: requestId,
      table,
    }));
    return;
  }

  for (let offset = 0; offset < itemIds.length; offset += 500) {
    const body = new TextEncoder().encode(JSON.stringify({
      action,
      item_ids: itemIds.slice(offset, offset + 500),
    }));
    const auditRequestId = requestId;
    const headers = new Headers({
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
      "x-request-id": auditRequestId,
    });
    const origin = request.headers.get("origin");
    if (origin) headers.set("origin", origin);
    const traceparent = request.headers.get("traceparent");
    if (traceparent) headers.set("traceparent", traceparent);
    await applyTrustedIngressHeaders(headers, env, auditRequestId, "security-audit", "POST", body);
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/security-audit`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        console.error(JSON.stringify({
          event: "security_audit.proxy_write_failed",
          request_id: auditRequestId,
          status: response.status,
          table,
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "security_audit.proxy_write_failed",
        request_id: auditRequestId,
        error_code: "audit_endpoint_unavailable",
        error_type: error instanceof Error ? error.name.slice(0, 64) : "UnknownError",
        table,
      }));
    }
  }
};

export const proxySupabaseApiRequest = async (
  request: Request,
  env: Env,
  headers: Record<string, string>,
  requestId: string,
  upstreamPath: string,
  ctx?: Pick<ExecutionContext, "waitUntil">,
) => {
  const cookies = parseCookies(request);
  if (isBlockedRpcProxyPath(upstreamPath)) {
    return buildError(
      403,
      "RPC proxy access is not allowed",
      headers,
      requestId,
    );
  }
  if (
    isUnauthorizedRpcProxyPath(upstreamPath, hasRpcCallerAuth(request, cookies))
  ) {
    return buildError(401, "Unauthorized", headers, requestId);
  }
  const normalizedUpstreamPath = isRpcProxyPath(upstreamPath)
    ? `/rest/v1${upstreamPath}`
    : upstreamPath;
  const upstreamUrl = `${
    trimTrailingSlash(env.SUPABASE_URL)
  }${normalizedUpstreamPath}${new URL(request.url).search}`;
  let requestBody: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      const bytes = await readBoundedRequestBody(
        request,
        MAX_PROXY_REQUEST_BODY_BYTES,
      );
      requestBody = new TextDecoder().decode(bytes);
    } catch (error) {
      if (error instanceof RequestBodyLimitError) {
        return buildError(error.status, error.message, headers, requestId);
      }
      throw error;
    }
  }
  const invoke = async (sessionAccessToken?: string | null) => {
    const proxiedHeaders = sanitizeUpstreamHeaders(
      request,
      env.SUPABASE_ANON_KEY,
      requestId,
      sessionAccessToken,
    );
    return fetch(upstreamUrl, {
      method: request.method,
      headers: proxiedHeaders,
      body: requestBody,
    });
  };

  const betterAuthToken = await getSupabaseAccessToken(request, env).catch(() => null);
  if (!betterAuthToken) return buildError(401, "Unauthorized", headers, requestId);
  const upstreamResponse = await invoke(betterAuthToken);
  if (request.method === "GET" || request.method === "HEAD") {
    const audit = auditSuccessfulSupabaseRead(
      request,
      env,
      requestId,
      upstreamPath,
      betterAuthToken,
      upstreamResponse,
    );
    // The Worker response remains independent from the audit writer. Cloudflare
    // keeps this task alive after the client response is returned.
    if (ctx) ctx.waitUntil(audit);
    else void audit.catch(() => undefined);
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  Object.entries(headers).forEach(([key, value]) =>
    responseHeaders.set(key, value)
  );
  responseHeaders.set("x-request-id", requestId);
  if (cookies.legacyCookiePresent) {
    const migrationHeaders = new Headers();
    clearLegacySessionCookies(migrationHeaders, env);
    appendSetCookies(responseHeaders, migrationHeaders);
  }
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
};
