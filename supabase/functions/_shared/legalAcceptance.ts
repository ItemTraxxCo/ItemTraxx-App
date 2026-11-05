export const LEGAL_DOCUMENT_TYPES = [
  "terms_of_service",
  "privacy_policy",
  "student_privacy_notice",
  "dpa",
] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

export type AcceptLegalDocumentRequest = {
  documentType: LegalDocumentType;
  documentVersion: string;
  documentHash: string;
};

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-f:]{2,45}$/i;

/**
 * Validates an `accept` request body. Returns null for anything malformed so
 * the caller can answer with a generic 400 without echoing input.
 */
export const parseAcceptLegalDocumentRequest = (
  body: unknown,
): AcceptLegalDocumentRequest | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const documentType = record.document_type;
  const documentVersion = record.document_version;
  const documentHash = record.document_hash;
  if (
    typeof documentType !== "string" ||
    !(LEGAL_DOCUMENT_TYPES as readonly string[]).includes(documentType) ||
    typeof documentVersion !== "string" ||
    !VERSION_PATTERN.test(documentVersion) ||
    typeof documentHash !== "string" ||
    !SHA256_PATTERN.test(documentHash)
  ) {
    return null;
  }
  return {
    documentType: documentType as LegalDocumentType,
    documentVersion,
    documentHash: documentHash.toLowerCase(),
  };
};

/**
 * Normalizes the Cloudflare-supplied client IP. Only a syntactically plausible
 * IPv4/IPv6 literal is kept; anything else is dropped rather than stored.
 */
export const normalizeClientIp = (value: string | null | undefined): string | null => {
  const candidate = value?.trim() ?? "";
  if (!candidate) return null;
  if (IPV4_PATTERN.test(candidate)) {
    return candidate.split(".").every((part) => Number(part) <= 255) ? candidate : null;
  }
  return IPV6_PATTERN.test(candidate) && candidate.includes(":") ? candidate.toLowerCase() : null;
};

export const normalizeUserAgent = (value: string | null | undefined): string | null => {
  const candidate = value?.replace(/[\u0000-\u001f\u007f]/g, " ").trim() ?? "";
  return candidate ? candidate.slice(0, 500) : null;
};
