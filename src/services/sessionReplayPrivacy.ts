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

// Signed storage URLs can carry vendor-specific credentials, so scrub their
// full query/hash. Other URLs keep ordinary navigation state while sensitive
// credential parameters (including the SSO proof) are removed wherever they occur.
const SIGNED_STORAGE_OBJECT_PATH = /\/(?:storage\/v1\/)?object\/sign(?:\/|$)/i;
const SENSITIVE_URL_PARAMETER = /^(?:access_token|refresh_token|id_token|token|secret|signature|code|api[_-]?key|itx_sso_proof)$/i;
const isSensitiveUrlParameter = (key: string) => SENSITIVE_URL_PARAMETER.test(key);

const scrubSensitiveHash = (hash: string) => {
  if (!hash) return hash;

  const hashBody = hash.slice(1);
  const queryIndex = hashBody.indexOf("?");
  const prefix = queryIndex >= 0 ? hashBody.slice(0, queryIndex + 1) : "";
  const parameterText = queryIndex >= 0 ? hashBody.slice(queryIndex + 1) : hashBody;
  const parameters = new URLSearchParams(parameterText);
  let changed = false;
  for (const key of [...parameters.keys()]) {
    if (!isSensitiveUrlParameter(key)) continue;
    parameters.delete(key);
    changed = true;
  }
  if (!changed) return hash;
  const remaining = parameters.toString();
  return remaining ? `#${prefix}${remaining}` : "";
};

export const scrubSensitiveReplayUrlValue = (value: string) => {
  const recoverySafe = scrubSensitiveRecoveryUrlValue(value);
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(recoverySafe);
  const isProtocolRelative = recoverySafe.startsWith("//");

  try {
    const base = typeof window !== "undefined"
      ? window.location.origin
      : "https://www.itemtraxx.com";
    const url = new URL(recoverySafe, base);
    let changed = recoverySafe !== value;
    if (SIGNED_STORAGE_OBJECT_PATH.test(url.pathname) && (url.search || url.hash)) {
      // Signed storage URLs can carry vendor-specific credential parameters,
      // so remove the complete query and fragment for this narrowly scoped path.
      url.search = "";
      url.hash = "";
      changed = true;
    } else {
      for (const key of [...url.searchParams.keys()]) {
        if (!isSensitiveUrlParameter(key)) continue;
        url.searchParams.delete(key);
        changed = true;
      }
      const safeHash = scrubSensitiveHash(url.hash);
      if (safeHash !== url.hash) {
        url.hash = safeHash;
        changed = true;
      }
    }
    if (!changed) return recoverySafe;
    if (isAbsolute) return url.toString();
    if (isProtocolRelative) return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    return recoverySafe.startsWith("/")
      ? `${url.pathname}${url.search}${url.hash}`
      : `${url.pathname.replace(/^\/+/, "")}${url.search}${url.hash}`;
  } catch {
    return recoverySafe;
  }
};

type ReplayRecordingEvent = {
  data?: unknown;
};

/**
 * Replay recorders store PerformanceObserver entries as custom performance
 * events. Scrub their URL descriptions before they enter the replay buffer;
 * DOM masking cannot remove a resource timing entry already recorded by the
 * browser.
 */
export const sanitizeReplayPerformanceEvent = <T extends ReplayRecordingEvent>(event: T): T => {
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
  // URL state while stripping sensitive parameters on any route.
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
