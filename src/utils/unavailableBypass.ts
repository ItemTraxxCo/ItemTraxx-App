const UNAVAILABLE_BYPASS_HOSTS = new Set([
  "dennis.dev.itemtraxx.com",
  "leo.dev.itemtraxx.com",
  "dev.itemtraxx.com",
  "preview.itemtraxx.com",
  "staging.itemtraxx.com",
]);

export const isUnavailableBypassHost = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase();
  if (UNAVAILABLE_BYPASS_HOSTS.has(normalized)) return true;
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(normalized)) return true;
  if (normalized.endsWith(".localhost")) return true;
  if (normalized.startsWith("192.168.") || normalized.startsWith("10.")) return true;

  const secondOctet = Number(normalized.match(/^172\.(\d{1,3})\./)?.[1]);
  return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
};
