const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const CANONICAL_EMAIL_LOGO_URL = "https://assets.itemtraxx.com/brand/logo-light.png";

const normalizeEmailLogoUrl = (logoUrl?: string | null) => {
  const candidate = logoUrl?.trim() || CANONICAL_EMAIL_LOGO_URL;

  try {
    const parsed = new URL(candidate);
    const isAllowedHost = parsed.hostname === "assets.itemtraxx.com";
    const isAllowedLogo =
      parsed.pathname === "/brand/logo-light.png" ||
      parsed.pathname === "/brand/logo-dark.png" ||
      parsed.pathname === "/brand/logo-mark.png";

    if (parsed.protocol === "https:" && isAllowedHost && isAllowedLogo) {
      return parsed.toString();
    }
  } catch {
    return CANONICAL_EMAIL_LOGO_URL;
  }

  return CANONICAL_EMAIL_LOGO_URL;
};

export const buildEmailBrandHeaderHtml = (params: {
  logoUrl?: string | null;
  brandName?: string;
}) => {
  const brandName = params.brandName?.trim() || "ItemTraxx";
  const logoUrl = normalizeEmailLogoUrl(params.logoUrl);

  return `<img
                  src="${escapeHtmlAttribute(logoUrl)}"
                  alt="${escapeHtmlAttribute(brandName)}"
                  width="150"
                  height="50"
                  style="display:block;width:150px;height:50px;max-width:150px;border:0;outline:none;text-decoration:none;"
                />`;
};
