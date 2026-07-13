const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const getEdgeFunctionsBaseUrl = (): string => {
  const proxyUrl = import.meta.env.VITE_EDGE_PROXY_URL as string | undefined;
  const trimmedProxyUrl = proxyUrl?.trim();
  if (trimmedProxyUrl) {
    return `${trimTrailingSlash(trimmedProxyUrl)}/functions`;
  }
  return "/functions";
};
