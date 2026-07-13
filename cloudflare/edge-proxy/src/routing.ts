const ALLOWED_RPC_FUNCTIONS = new Set(["consume_rate_limit"]);

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

const isAnyRpcPath = (pathname: string) =>
  isRpcProxyPath(pathname) || pathname === "/rest/v1/rpc" || pathname.startsWith("/rest/v1/rpc/");

export const isBlockedRpcProxyPath = (pathname: string) =>
  isAnyRpcPath(pathname) && !isAllowedRpcProxyPath(pathname);

export const isUnauthorizedRpcProxyPath = (pathname: string, hasCallerAuth: boolean) =>
  isAnyRpcPath(pathname) && !hasCallerAuth;
