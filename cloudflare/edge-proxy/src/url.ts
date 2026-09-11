/**
 * Remove only slash characters at the end of a URL base.
 *
 * Scan backwards once instead of using a regex so the operation remains
 * linear even when the configured value is unexpectedly large.
 */
export const trimTrailingSlash = (value: string) => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
};

/**
 * Return true only for the ItemTraxx apex domain and its real subdomains.
 *
 * The label boundary is intentional: `evilitemtraxx.com` and
 * `itemtraxx.com.attacker.example` must never be treated as ItemTraxx hosts.
 */
export const isItemTraxxHostname = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase();
  const root = "itemtraxx.com";
  return normalized === root ||
    (normalized.length > root.length + 1 && normalized.endsWith(`.${root}`));
};
