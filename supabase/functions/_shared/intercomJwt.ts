export type IntercomJwtUser = {
  id: string;
  email?: string | null;
};

export const INTERCOM_JWT_TTL_SECONDS = 15 * 60;

const base64UrlEncode = (value: Uint8Array | string) => {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const signHs256 = async (message: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return base64UrlEncode(new Uint8Array(signature));
};

export const createIntercomJwt = async (
  user: IntercomJwtUser,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  const normalizedId = user.id.trim();
  if (!normalizedId) throw new Error("Missing Intercom user ID.");

  const normalizedEmail = user.email?.trim();
  const payload = {
    user_id: normalizedId,
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    iat: nowSeconds,
    exp: nowSeconds + INTERCOM_JWT_TTL_SECONDS,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await signHs256(signingInput, secret);
  return `${signingInput}.${signature}`;
};
