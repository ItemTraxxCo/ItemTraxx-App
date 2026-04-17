const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const resolveSafeEmailLogoUrl = (candidate: string | null | undefined) => {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    // Keep email assets HTTPS-only to avoid mixed-content issues in mail clients.
    if (url.protocol !== "https:") return null;
    return escapeHtmlAttribute(url.toString());
  } catch {
    return null;
  }
};

export const buildEmailBrandHeaderHtml = (params: {
  logoUrl?: string | null;
  brandName?: string;
}) => {
  const brandName = params.brandName?.trim() || "ItemTraxx";
  const safeLogoUrl = resolveSafeEmailLogoUrl(params.logoUrl);

  if (!safeLogoUrl) {
    return `<h1 style="margin:0;font-size:20px;line-height:1.3;">${escapeHtmlAttribute(brandName)}</h1>`;
  }

  // A lot of email clients strip or rewrite CSS; keep this small and inline.
  return [
    `<img`,
    ` src="${safeLogoUrl}"`,
    ` alt="${escapeHtmlAttribute(brandName)}"`,
    ` height="24"`,
    ` style="display:block;height:24px;max-height:24px;width:auto;max-width:220px;"`,
    ` />`,
  ].join("");
};

