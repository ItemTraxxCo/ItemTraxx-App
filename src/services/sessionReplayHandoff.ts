/**
 * Legacy cleanup helper for the full-page login redirect from itemtraxx.com
 * to a workspace subdomain. Replay now requires both Analytics and Diagnostics
 * consent, and Analytics sessions use PostHog's shared cookie across ItemTraxx
 * subdomains. The helper remains only to clear handoff cookies issued by older
 * builds; it contains no authentication or user-identification data.
 */

export const SESSION_REPLAY_HANDOFF_COOKIE_NAME = "itemtraxx-replay-session-handoff";

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

const getCookieDomain = (): string | undefined => {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "itemtraxx.com" || hostname.endsWith(".itemtraxx.com")) return ".itemtraxx.com";
  return undefined;
};

const writeCookie = (value: string, maxAgeSeconds: number) => {
  const parts = [
    `${SESSION_REPLAY_HANDOFF_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "SameSite=Lax",
  ];
  const domain = getCookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  if (window.location.protocol === "https:") parts.push("Secure");
  document.cookie = parts.join("; ");
};

export const clearReplaySessionHandoff = () => {
  if (!isBrowser()) return;
  try {
    writeCookie("", 0);
  } catch {
    // Cookie cleanup is best-effort and must never interrupt auth or consent.
  }
};
