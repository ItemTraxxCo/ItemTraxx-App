const allowedProtocols = new Set(["http:", "https:"]);

const baseOrigin = () =>
  typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const safeExternalUrl = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  try {
    const origin = baseOrigin();
    const url = new URL(trimmed, origin);
    if (!allowedProtocols.has(url.protocol)) return "";

    if (url.origin === origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }

    return url.toString();
  } catch {
    return "";
  }
};

export const safeSameOriginPath = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("/")) return "";

  try {
    const origin = baseOrigin();
    const url = new URL(trimmed, origin);
    if (url.origin !== origin) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
};
