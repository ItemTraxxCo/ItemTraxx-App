const EDGE_PROXY_HEADER = "x-itx-edge-proxy";
const EDGE_PROXY_TIMESTAMP_HEADER = "x-itx-edge-proxy-ts";
const EDGE_PROXY_SIGNATURE_HEADER = "x-itx-edge-proxy-signature";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const timingSafeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
};

const sign = async (secret: string, message: string) => {
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

export const hasTrustedEdgeIngress = async (req: Request, target: string) => {
  const secret = Deno.env.get("ITX_EDGE_PROXY_SHARED_SECRET")?.trim();
  if (!secret) {
    throw new Error("Missing ITX_EDGE_PROXY_SHARED_SECRET");
  }

  if (req.headers.get(EDGE_PROXY_HEADER) !== "1") {
    return false;
  }

  const timestamp = req.headers.get(EDGE_PROXY_TIMESTAMP_HEADER)?.trim() ?? "";
  const signature = req.headers.get(EDGE_PROXY_SIGNATURE_HEADER)?.trim() ?? "";
  const timestampMs = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(timestampMs)) {
    return false;
  }

  if (Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return false;
  }

  const requestId = req.headers.get("x-request-id")?.trim() ?? "";
  const expected = await sign(secret, `${timestamp}.${requestId}.${target}`);
  return timingSafeEqual(signature, expected);
};

export const requireTrustedEdgeIngress = async (
  req: Request,
  target: string,
  jsonResponse: (status: number, body: Record<string, unknown>) => Response,
) => {
  try {
    const trusted = await hasTrustedEdgeIngress(req, target);
    if (!trusted) {
      return jsonResponse(403, { error: "Trusted edge ingress required." });
    }
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === "Missing ITX_EDGE_PROXY_SHARED_SECRET") {
      return jsonResponse(500, { error: "Server misconfiguration." });
    }
    throw error;
  }
};
