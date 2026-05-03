const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const CANONICAL_EMAIL_LOGO_URL = "https://itemtraxx.com/brand/logo-light.png";
const CANONICAL_EMAIL_LOGO_PATHS = new Set([
  "/brand/logo-light.png",
  "/brand/logo-dark.png",
  "/brand/logo-mark.png",
]);

const resolveSafeEmailLogoUrl = (candidate: string | null | undefined) => {
  if (!candidate) return escapeHtmlAttribute(CANONICAL_EMAIL_LOGO_URL);
  const trimmed = candidate.trim();
  if (!trimmed) return escapeHtmlAttribute(CANONICAL_EMAIL_LOGO_URL);

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return escapeHtmlAttribute(CANONICAL_EMAIL_LOGO_URL);
    if (
      (url.hostname === "itemtraxx.com" || url.hostname === "www.itemtraxx.com") &&
      CANONICAL_EMAIL_LOGO_PATHS.has(url.pathname)
    ) {
      return escapeHtmlAttribute(url.toString());
    }
    return escapeHtmlAttribute(CANONICAL_EMAIL_LOGO_URL);
  } catch {
    return escapeHtmlAttribute(CANONICAL_EMAIL_LOGO_URL);
  }
};

export const buildEmailBrandHeaderHtml = (params: {
  logoUrl?: string | null;
  brandName?: string;
}) => {
  const brandName = params.brandName?.trim() || "ItemTraxx";
  const safeLogoUrl = resolveSafeEmailLogoUrl(params.logoUrl);

  return [
    `<img`,
    ` src="${safeLogoUrl}"`,
    ` alt="${escapeHtmlAttribute(brandName)}"`,
    ` width="126"`,
    ` height="42"`,
    ` style="display:block;width:126px;height:42px;max-width:126px;border:0;outline:none;text-decoration:none;"`,
    ` />`,
  ].join("");
};
