const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const BROWSER_RULES: Array<[RegExp, string]> = [
  [/edg\//i, "Edge"],
  [/(?:opr|opera)\//i, "Opera"],
  [/(?:firefox|fxios)\//i, "Firefox"],
  [/(?:chrome|crios)\//i, "Chrome"],
  [/version\/.*safari\//i, "Safari"],
];

const formatLocationPart = (value: string) =>
  value.trim().toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

export const formatLoginEmailTime = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "Unavailable";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
};

export const formatLoginEmailPlatform = (userAgent: string | null | undefined) => {
  const normalizedUserAgent = userAgent?.trim() ?? "";
  const browser = BROWSER_RULES.find(([pattern]) => pattern.test(normalizedUserAgent))?.[1] ?? "Unknown browser";
  const device = /iphone/i.test(normalizedUserAgent)
    ? "iPhone"
    : /ipad/i.test(normalizedUserAgent)
    ? "iPad"
    : /android/i.test(normalizedUserAgent)
    ? "Android device"
    : /macintosh|mac os x/i.test(normalizedUserAgent)
    ? "Mac"
    : /windows/i.test(normalizedUserAgent)
    ? "Windows PC"
    : /linux/i.test(normalizedUserAgent)
    ? "Linux device"
    : "Unknown device";

  return `${browser} on ${device}`;
};

export const formatLoginEmailLocation = (location: string | null | undefined) => {
  const normalizedLocation = location?.trim();
  if (!normalizedLocation) return "Unavailable";

  return normalizedLocation.split(",").map(formatLocationPart).filter(Boolean).join(", ") || "Unavailable";
};
