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

// Supabase Storage signed object URLs carry bearer material in their query
// string (for example `?token=...`). Keep the object path useful in replay
// metadata while removing the complete query/hash from this narrowly scoped
// signed-URL route. This also covers S3/GCS-style signatures issued by a
// storage-compatible endpoint without touching ordinary application links.
const SIGNED_STORAGE_OBJECT_PATH = /\/(?:storage\/v1\/)?object\/sign(?:\/|$)/i;

export const scrubSensitiveReplayUrlValue = (value: string) => {
  const recoverySafe = scrubSensitiveRecoveryUrlValue(value);
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(recoverySafe);
  const isProtocolRelative = recoverySafe.startsWith("//");

  try {
    const base = typeof window !== "undefined"
      ? window.location.origin
      : "https://www.itemtraxx.com";
    const url = new URL(recoverySafe, base);
    if (
      !SIGNED_STORAGE_OBJECT_PATH.test(url.pathname) ||
      (!url.search && !url.hash)
    ) {
      return recoverySafe;
    }

    url.search = "";
    url.hash = "";
    if (isAbsolute) return url.toString();
    if (isProtocolRelative) return `//${url.host}${url.pathname}`;
    return recoverySafe.startsWith("/")
      ? url.pathname
      : url.pathname.replace(/^\/+/, "");
  } catch {
    return recoverySafe;
  }
};

type ReplayRecordingEvent = {
  data?: unknown;
};

/**
 * Sentry stores PerformanceObserver entries as custom performance-span
 * events. Scrub their URL descriptions before they enter the replay buffer;
 * DOM blocking cannot remove a resource timing entry that was already
 * recorded by the browser.
 */
export const sanitizeSentryReplayEvent = <T extends ReplayRecordingEvent>(event: T): T => {
  if (!event.data || typeof event.data !== "object") return event;
  const data = event.data as Record<string, unknown>;
  if (data.tag !== "performanceSpan" || !data.payload || typeof data.payload !== "object") {
    return event;
  }

  const payload = data.payload as Record<string, unknown>;
  if (typeof payload.description !== "string") return event;
  const safeDescription = scrubSensitiveReplayUrlValue(payload.description);
  if (safeDescription === payload.description) return event;

  return {
    ...event,
    data: {
      ...data,
      payload: {
        ...payload,
        description: safeDescription,
      },
    },
  } as T;
};

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

  // Recovery and signed storage URLs can contain bearer tokens. Keep ordinary
  // URLs and strip only the sensitive query/hash material at those routes.
  if (normalizedName === "href") {
    if (element?.matches(SESSION_REPLAY_MASK_SELECTOR)) {
      // Marked links can carry bearer material in the href (for example a
      // storage signed URL for a support attachment). Mask it like marked
      // image sources.
      return maskValue(value);
    }
    return scrubSensitiveReplayUrlValue(value);
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
