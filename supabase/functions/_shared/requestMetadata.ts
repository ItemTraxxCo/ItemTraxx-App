const TITLE_CASE_SKIP_WORDS = new Set(["and", "or", "of", "the", "in"]);
const MAX_GEO_HEADER_LENGTH = 80;

const toTitleCase = (value: string) =>
  value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => {
      if (part.length <= 3) return part.toUpperCase();
      if (index > 0 && TITLE_CASE_SKIP_WORDS.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");

const sanitizeGeoHeader = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_GEO_HEADER_LENGTH);
};

// Callers must establish trusted edge ingress before consuming proxy-set headers.
export const resolveTrustedGeneralLocation = (req: Request) => {
  const city = sanitizeGeoHeader(req.headers.get("x-itx-geo-city"));
  const region = sanitizeGeoHeader(req.headers.get("x-itx-geo-region"));
  const country = sanitizeGeoHeader(req.headers.get("x-itx-geo-country"));

  if (!city && !region && !country) return null;

  const locationParts = city && region
    ? [city, region]
    : city && country
    ? [city, country]
    : region && country
    ? [region, country]
    : [city ?? region ?? country ?? ""];

  const formatted = locationParts
    .map((part) => toTitleCase(part))
    .filter(Boolean)
    .join(", ");

  return formatted || null;
};
