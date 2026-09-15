import { scrubSensitiveRecoveryUrlValue } from "../utils/passwordResetRedirect";

/**
 * Add this attribute to DOM elements whose rendered text contains borrower
 * names, borrower IDs, or another value that must not appear in replay.
 *
 * The attribute is deliberately inert in the application UI. It is consumed
 * only by the replay recorders.
 */
export const SESSION_REPLAY_MASK_SELECTOR = "[data-session-replay-mask]";

const maskValue = (value: string) => "*".repeat(value.length);

/**
 * Preserve normal DOM attributes (especially ordinary image src and link href
 * values) while removing sensitive metadata from replay snapshots.
 */
export const maskSessionReplayAttribute = (
  name: string,
  value: string,
  element?: Element,
) => {
  const normalizedName = name.toLowerCase();

  // Recovery URLs can contain bearer tokens. Keep ordinary URLs and strip only
  // query/hash material on the password-reset path.
  if (normalizedName === "href") {
    return scrubSensitiveRecoveryUrlValue(value);
  }

  // Accessible labels and tooltips are not visible in the page, but they can
  // contain borrower names/IDs (for example a row-selection aria-label).
  if (normalizedName === "aria-label" || normalizedName === "title") {
    return maskValue(value);
  }

  if (element?.matches(SESSION_REPLAY_MASK_SELECTOR)) {
    // A marked image can encode a secret in a data URL (for example, a TOTP
    // enrollment QR). Mask the source itself while leaving ordinary images
    // untouched when they are not marked.
    if (normalizedName === "src" && element.localName === "img") {
      return maskValue(value);
    }

    // Marked alternate labels and serialized values can contain the same
    // sensitive text as the visible node.
    if (normalizedName === "alt" || normalizedName === "value") {
      return maskValue(value);
    }
  }

  return value;
};
