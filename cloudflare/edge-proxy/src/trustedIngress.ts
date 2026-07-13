import {
  EDGE_PROXY_HEADER,
  EDGE_PROXY_SIGNATURE_HEADER,
  EDGE_PROXY_TIMESTAMP_HEADER,
} from "./constants.ts";

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const signTrustedIngress = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(signature));
};

export const hashTrustedIngressBody = async (body: Uint8Array | null) => {
  if (!body) {
    return "no-body";
  }

  const bytes = new Uint8Array(body.byteLength);
  bytes.set(body);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return toHex(new Uint8Array(digest));
};

export const applyTrustedIngressHeaders = async (
  headers: Headers,
  env: Env,
  requestId: string,
  target: string,
  method: string,
  body: Uint8Array | null,
) => {
  const secret = env.ITX_EDGE_PROXY_SHARED_SECRET?.trim();
  if (!secret) return;

  const timestamp = Date.now().toString();
  const bodyHash = await hashTrustedIngressBody(body);
  headers.set(EDGE_PROXY_HEADER, "1");
  headers.set(EDGE_PROXY_TIMESTAMP_HEADER, timestamp);
  headers.set(
    EDGE_PROXY_SIGNATURE_HEADER,
    await signTrustedIngress(
      secret,
      `${timestamp}.${requestId}.${method.toUpperCase()}.${target}.${bodyHash}`,
    ),
  );
};
