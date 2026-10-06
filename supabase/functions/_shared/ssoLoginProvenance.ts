export const SSO_LOGIN_PROOF_TTL_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 30;
const CALLBACK_SESSION_CLOCK_SKEW_MS = 30_000;
const MAX_PROOF_LENGTH = 2048;
const PROOF_DOMAIN = "itemtraxx:sso-login-provenance:v1";
const encoder = new TextEncoder();

export type SsoLoginProtocol = "SAML2.0" | "OpenID Connect (OIDC)";

export type SsoLoginProvenance = {
  providerId: string;
  protocol: SsoLoginProtocol;
};

type SsoLoginProofPayload = SsoLoginProvenance & {
  version: 1;
  betterAuthUserId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
};

type SsoLoginProofIdentity = {
  betterAuthUserId: string;
  sessionId: string;
};

export const isSessionCreatedDuringSsoCallback = (
  createdAt: Date | string | number,
  callbackStartedAtMs: number,
  nowMs = Date.now(),
  existingSessionId: string | null = null,
  callbackSessionId: string | null = null,
) => {
  const createdAtMs = createdAt instanceof Date
    ? createdAt.getTime()
    : typeof createdAt === "number"
    ? createdAt
    : Date.parse(createdAt);
  return Number.isFinite(createdAtMs) &&
    Number.isFinite(callbackStartedAtMs) &&
    Number.isFinite(nowMs) &&
    !(existingSessionId && existingSessionId === callbackSessionId) &&
    createdAtMs >= callbackStartedAtMs - CALLBACK_SESSION_CLOCK_SKEW_MS &&
    createdAtMs <= nowMs + CALLBACK_SESSION_CLOCK_SKEW_MS;
};

const isSsoProtocol = (value: unknown): value is SsoLoginProtocol =>
  value === "SAML2.0" || value === "OpenID Connect (OIDC)";

const isProviderId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9-]{1,128}$/i.test(value);

const encodeBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
};

const decodeBase64Url = (value: string) => {
  if (!/^[a-z0-9_-]+$/i.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const importSigningKey = (secret: string, usages: KeyUsage[]) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );

const hasIdentity = (identity: SsoLoginProofIdentity) =>
  typeof identity.betterAuthUserId === "string" &&
  identity.betterAuthUserId.length > 0 &&
  identity.betterAuthUserId.length <= 128 &&
  typeof identity.sessionId === "string" && identity.sessionId.length > 0 &&
  identity.sessionId.length <= 128;

export const createSsoLoginProof = async (
  secret: string | null | undefined,
  provenance: SsoLoginProvenance & SsoLoginProofIdentity,
  nowMs = Date.now(),
) => {
  const keySecret = secret?.trim();
  if (
    !keySecret || !hasIdentity(provenance) ||
    !isProviderId(provenance.providerId) ||
    !isSsoProtocol(provenance.protocol) ||
    !Number.isFinite(nowMs)
  ) {
    return null;
  }

  const issuedAt = Math.floor(nowMs / 1000);
  const payload: SsoLoginProofPayload = {
    version: 1,
    providerId: provenance.providerId,
    protocol: provenance.protocol,
    betterAuthUserId: provenance.betterAuthUserId,
    sessionId: provenance.sessionId,
    issuedAt,
    expiresAt: issuedAt + SSO_LOGIN_PROOF_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(
    encoder.encode(JSON.stringify(payload)),
  );
  const key = await importSigningKey(keySecret, ["sign"]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${PROOF_DOMAIN}.${encodedPayload}`),
  );
  const proof = `${encodedPayload}.${
    encodeBase64Url(new Uint8Array(signature))
  }`;
  return proof.length <= MAX_PROOF_LENGTH ? proof : null;
};

export const verifySsoLoginProof = async (
  proof: unknown,
  secret: string | null | undefined,
  identity: SsoLoginProofIdentity,
  nowMs = Date.now(),
): Promise<SsoLoginProvenance | null> => {
  const keySecret = secret?.trim();
  if (
    typeof proof !== "string" || proof.length === 0 ||
    proof.length > MAX_PROOF_LENGTH || !keySecret || !hasIdentity(identity) ||
    !Number.isFinite(nowMs)
  ) {
    return null;
  }

  const separator = proof.indexOf(".");
  if (separator <= 0 || separator !== proof.lastIndexOf(".")) return null;
  const encodedPayload = proof.slice(0, separator);
  const encodedSignature = proof.slice(separator + 1);
  const payloadBytes = decodeBase64Url(encodedPayload);
  const signatureBytes = decodeBase64Url(encodedSignature);
  if (!payloadBytes || !signatureBytes || signatureBytes.length !== 32) {
    return null;
  }

  const key = await importSigningKey(keySecret, ["verify"]);
  const signatureValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(`${PROOF_DOMAIN}.${encodedPayload}`),
  );
  if (!signatureValid) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Partial<SsoLoginProofPayload>;
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    record.version !== 1 || !isProviderId(record.providerId) ||
    !isSsoProtocol(record.protocol) ||
    record.betterAuthUserId !== identity.betterAuthUserId ||
    record.sessionId !== identity.sessionId ||
    typeof record.issuedAt !== "number" ||
    !Number.isSafeInteger(record.issuedAt) ||
    typeof record.expiresAt !== "number" ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt !== record.issuedAt + SSO_LOGIN_PROOF_TTL_SECONDS ||
    record.issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS ||
    nowSeconds >= record.expiresAt
  ) {
    return null;
  }

  return { providerId: record.providerId, protocol: record.protocol };
};
