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
 * Preserve normal DOM attributes (especially image src and link href values)
 * while removing sensitive metadata from replay snapshots.
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

  // If an explicitly marked node carries an alternate label or serialized
  // value, redact that metadata without touching classes, styles, src, or href.
  if (
    element?.matches(SESSION_REPLAY_MASK_SELECTOR) &&
    (normalizedName === "alt" || normalizedName === "value")
  ) {
    return maskValue(value);
  }

  return value;
};
