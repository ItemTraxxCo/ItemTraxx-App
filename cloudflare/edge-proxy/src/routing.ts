const ALLOWED_RPC_FUNCTIONS = new Set(["consume_rate_limit"]);
// Four passes cover deliberately nested encodings while keeping request work linear and bounded.
const MAX_RPC_PATH_DECODE_PASSES = 4;

const readExactSegment = (pathname: string, prefix: string) => {
  if (!pathname.startsWith(prefix)) return "";
  const segment = pathname.slice(prefix.length);
  if (!segment || segment.includes("/") || segment.includes("%")) return "";
  return segment;
};

export const getFunctionName = (pathname: string) => readExactSegment(pathname, "/functions/");

export const getSessionAction = (pathname: string) => readExactSegment(pathname, "/auth/session/");

export const isRestProxyPath = (pathname: string) => pathname.startsWith("/rest/v1/");

export const isRpcProxyPath = (pathname: string) => pathname === "/rpc" || pathname.startsWith("/rpc/");

export const getRpcFunctionName = (pathname: string) => {
  const direct = readExactSegment(pathname, "/rpc/");
  if (direct) return direct;
  return readExactSegment(pathname, "/rest/v1/rpc/");
};

export const isAllowedRpcProxyPath = (pathname: string) => {
  const functionName = getRpcFunctionName(pathname);
  return Boolean(functionName) && ALLOWED_RPC_FUNCTIONS.has(functionName.toLowerCase());
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
      decoded = value.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
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
  return canonical.malformedEncoding && hasMalformedRpcSegment(canonical.pathname);
};

export const isBlockedRpcProxyPath = (pathname: string) =>
  isAnyRpcPath(pathname) && !isAllowedRpcProxyPath(pathname);

export const isUnauthorizedRpcProxyPath = (pathname: string, hasCallerAuth: boolean) =>
  isAnyRpcPath(pathname) && !hasCallerAuth;
