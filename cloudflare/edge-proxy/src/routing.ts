const ALLOWED_RPC_FUNCTIONS = new Set(["consume_rate_limit"]);
// Four passes cover deliberately nested encodings while keeping request work linear and bounded.
const MAX_RPC_PATH_DECODE_PASSES = 4;

const readExactSegment = (pathname: string, prefix: string) => {
  if (!pathname.startsWith(prefix)) return "";
  const segment = pathname.slice(prefix.length);
  if (!segment || segment.includes("/") || segment.includes("%")) return "";
  return segment;
};

export const getFunctionName = (pathname: string) =>
  readExactSegment(pathname, "/functions/");

export const getSessionAction = (pathname: string) =>
  readExactSegment(pathname, "/auth/session/");

export const isRestProxyPath = (pathname: string) =>
  pathname.startsWith("/rest/v1/");

// The SPA reaches PostgREST through exactly one client
// (src/services/authenticatedDataClient.ts) and touches a small, fixed set of
// relations. Enumerating them here keeps the proxy from being a generic
// database gateway: a future over-broad GRANT or policy is no longer reachable
// from a browser just because it exists in the schema.
const READABLE_REST_TABLES = new Set([
  "items",
  "borrowers",
  "item_logs",
  "item_access_grants",
  "borrower_access_grants",
  "profiles",
  "workspaces",
]);

// admin_audit_logs is the one relation the browser writes directly
// (src/services/auditLogService.ts). Its INSERT policy pins actor_id to
// auth.uid() and the row's workspace, and no UPDATE/DELETE policy exists.
const WRITABLE_REST_TABLES = new Set(["admin_audit_logs"]);

export const getRestTableName = (pathname: string) =>
  readExactSegment(pathname, "/rest/v1/");

export const isAllowedRestRequest = (pathname: string, method: string) => {
  const table = getRestTableName(pathname);
  if (!table) return false;
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD") {
    return READABLE_REST_TABLES.has(table) || WRITABLE_REST_TABLES.has(table);
  }
  if (normalizedMethod === "POST") {
    return WRITABLE_REST_TABLES.has(table);
  }
  return false;
};

export const isRpcProxyPath = (pathname: string) =>
  pathname === "/rpc" || pathname.startsWith("/rpc/");

export const getRpcFunctionName = (pathname: string) => {
  const direct = readExactSegment(pathname, "/rpc/");
  if (direct) return direct;
  return readExactSegment(pathname, "/rest/v1/rpc/");
};

export const isAllowedRpcProxyPath = (pathname: string) => {
  const functionName = getRpcFunctionName(pathname);
  return Boolean(functionName) &&
    ALLOWED_RPC_FUNCTIONS.has(functionName.toLowerCase());
};

const normalizePathShape = (pathname: string) => {
  const segments: string[] = [];
  for (const segment of pathname.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
};

const canonicalizeForRpcDetection = (pathname: string) => {
  let value = pathname;
  let malformedEncoding = false;

  for (let index = 0; index < MAX_RPC_PATH_DECODE_PASSES; index += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      malformedEncoding = true;
      decoded = value.replace(
        /%([0-9a-f]{2})/gi,
        (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
    if (decoded === value) {
      return {
        pathname: normalizePathShape(value),
        malformedEncoding,
        decodeDepthExhausted: false,
      };
    }
    value = decoded;
  }

  return {
    pathname: normalizePathShape(value),
    malformedEncoding,
    decodeDepthExhausted: /%[0-9a-f]{2}/i.test(value),
  };
};

const isCanonicalRpcPath = (pathname: string) => {
  const normalized = pathname.toLowerCase();
  return normalized === "/rpc" || normalized.startsWith("/rpc/") ||
    normalized === "/rest/v1/rpc" || normalized.startsWith("/rest/v1/rpc/");
};

const hasMalformedRpcSegment = (pathname: string) => {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  const candidate = segments[0] === "rest" && segments[1] === "v1"
    ? segments[2]
    : segments[0];
  return candidate === "rpc" || candidate?.startsWith("rpc%") === true;
};

const isAnyRpcPath = (pathname: string) => {
  const canonical = canonicalizeForRpcDetection(pathname);
  if (isCanonicalRpcPath(canonical.pathname)) return true;
  if (canonical.decodeDepthExhausted && isRestProxyPath(pathname)) return true;
  return canonical.malformedEncoding &&
    hasMalformedRpcSegment(canonical.pathname);
};

export const isBlockedRpcProxyPath = (pathname: string) =>
  isAnyRpcPath(pathname) && !isAllowedRpcProxyPath(pathname);

export const isUnauthorizedRpcProxyPath = (
  pathname: string,
  hasCallerAuth: boolean,
) => isAnyRpcPath(pathname) && !hasCallerAuth;
