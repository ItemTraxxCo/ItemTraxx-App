export type EmailPurpose =
  | "support"
  | "sales"
  | "privacy"
  | "security"
  | "legal"
  | "notifications"
  | "noreply";

const PURPOSE_ENV_KEYS: Record<EmailPurpose, string> = {
  support: "ITX_EMAIL_SUPPORT",
  sales: "ITX_EMAIL_SALES",
  privacy: "ITX_EMAIL_PRIVACY",
  security: "ITX_EMAIL_SECURITY",
  legal: "ITX_EMAIL_LEGAL",
  notifications: "ITX_EMAIL_NOTIFICATIONS",
  noreply: "ITX_EMAIL_NOREPLY",
};

const DEFAULT_FROM = "ItemTraxx Support <support@itemtraxx.com>";
const DISPLAY_ADDRESS_PATTERN = /<\s*([^<>@\s]+@[^<>@\s]+)\s*>/;

const envValue = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  return value || null;
};

/**
 * Resolve a complete RFC 5322-style From value for one application purpose.
 * Purpose-specific values win; the shared sender and legacy Resend sender are
 * retained as compatibility fallbacks during migration.
 */
export const resolveEmailFrom = (purpose: EmailPurpose): string =>
  envValue(PURPOSE_ENV_KEYS[purpose]) ??
    envValue("ITX_EMAIL_FROM") ??
    envValue("ITX_RESEND_FROM") ??
    DEFAULT_FROM;

/** Extract a bare mailbox address from a display-name address value. */
export const extractEmailAddress = (value: string): string => {
  const trimmed = value.trim();
  const displayMatch = trimmed.match(DISPLAY_ADDRESS_PATTERN);
  return displayMatch?.[1]?.trim() || trimmed;
};

/**
 * Resolve the bare destination mailbox for a purpose. A legacy environment
 * override remains a compatibility fallback while purpose-specific secrets
 * are rolled out.
 */
export const resolveEmailAddress = (
  purpose: EmailPurpose,
  legacyEnvName?: string,
): string => {
  // A purpose-specific identity must control both the visible sender and the
  // destination derived from that identity.
  const purposeValue = envValue(PURPOSE_ENV_KEYS[purpose]);
  if (purposeValue) return extractEmailAddress(purposeValue);

  const legacyValue = legacyEnvName ? envValue(legacyEnvName) : null;
  if (legacyValue) return extractEmailAddress(legacyValue);

  return extractEmailAddress(resolveEmailFrom(purpose));
};

export const emailPurposeFromSupportCategory = (
  category:
    | "general"
    | "bug"
    | "billing"
    | "access"
    | "feature"
    | "privacy"
    | "security"
    | "other",
): "support" | "privacy" | "security" => {
  if (category === "privacy") return "privacy";
  if (category === "security") return "security";
  return "support";
};
