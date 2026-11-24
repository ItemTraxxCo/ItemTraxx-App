import { readBoundedBodyBytes } from "./requestBody.ts";

const EDGE_PROXY_HEADER = "x-itx-edge-proxy";
const EDGE_PROXY_TIMESTAMP_HEADER = "x-itx-edge-proxy-ts";
const EDGE_PROXY_SIGNATURE_HEADER = "x-itx-edge-proxy-signature";
const EDGE_PROXY_BODY_HASH_HEADER = "x-itx-edge-proxy-body-sha256";
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const TRUSTED_INGRESS_REPLAY_TTL_MS = 60 * 1000;
const TRUSTED_INGRESS_REPLAY_SWEEP_INTERVAL_MS = 10 * 1000;
const TRUSTED_INGRESS_SHARED_CLAIM_TIMEOUT_MS = 3 * 1000;
const MAX_TRUSTED_INGRESS_BODY_BYTES = 1024 * 1024;
const MAX_SUPPORT_REQUEST_BODY_BYTES = 12 * 1024 * 1024;

const trustedIngressReplayCache = new Map<string, number>();
let lastTrustedIngressReplaySweepAt = 0;

const sweepExpiredTrustedIngressRequests = (now: number) => {
  if (
    now - lastTrustedIngressReplaySweepAt <
      TRUSTED_INGRESS_REPLAY_SWEEP_INTERVAL_MS
  ) {
    return;
  }

  for (const [key, expiresAt] of trustedIngressReplayCache) {
    if (expiresAt < now) trustedIngressReplayCache.delete(key);
  }
  lastTrustedIngressReplaySweepAt = now;
};

const claimLocalTrustedIngressRequest = (
  cacheKey: string,
  now: number,
) => {
  sweepExpiredTrustedIngressRequests(now);

  const expiresAt = trustedIngressReplayCache.get(cacheKey);
  if (expiresAt !== undefined && expiresAt >= now) return false;

  // This lookup and write contain no await, so concurrent requests handled by
  // this isolate cannot both claim the same signed envelope.
  trustedIngressReplayCache.set(cacheKey, now + TRUSTED_INGRESS_REPLAY_TTL_MS);
  return true;
};

type ReplayClaim = "claimed" | "replay" | "unavailable";

const sharedReplayStoreEnabled = () =>
  Deno.env.get("ITX_TRUSTED_INGRESS_REPLAY_STORE")?.trim() === "database";

// The in-memory cache only sees one isolate. With the shared store enabled,
// a first-seen envelope must also win the database claim, so a replay routed
// to another isolate inside the signature window is rejected. Fails closed.
const claimSharedTrustedIngressRequest = async (
  cacheKey: string,
): Promise<ReplayClaim> => {
  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ??
    Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return "unavailable";

  const claimKey = toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheKey)),
    ),
  );
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/claim_trusted_ingress_request`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          ...(serviceKey.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${serviceKey}` }),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_claim_key: claimKey,
          p_ttl_seconds: TRUSTED_INGRESS_REPLAY_TTL_MS / 1000,
        }),
        signal: AbortSignal.timeout(TRUSTED_INGRESS_SHARED_CLAIM_TIMEOUT_MS),
      },
    );
    if (!response.ok) return "unavailable";
    const claimed = await response.json();
    if (claimed === true) return "claimed";
    if (claimed === false) return "replay";
    return "unavailable";
  } catch {
    return "unavailable";
  }
};

const claimTrustedIngressRequest = async (
  requestId: string,
  signature: string,
  now: number,
): Promise<ReplayClaim> => {
  // One Worker request ID can identify several internal audit batches. The
  // signed HMAC distinguishes those legitimate payloads while an exact replay
  // of any signed envelope retains the same request ID and signature.
  const cacheKey = `${requestId}\u0000${signature}`;
  if (!claimLocalTrustedIngressRequest(cacheKey, now)) return "replay";
  if (!sharedReplayStoreEnabled()) return "claimed";
  return await claimSharedTrustedIngressRequest(cacheKey);
};

type VerifiedTrustedIngress = {
  bodyHash: string;
  requestId: string;
  signature: string;
  target: string;
  timestampMs: number;
  verifiedAt: number;
};

export const getTrustedIngressBodyLimit = (target: string) =>
  target === "contact-support-submit"
    ? MAX_SUPPORT_REQUEST_BODY_BYTES
    : MAX_TRUSTED_INGRESS_BODY_BYTES;

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
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toHex(new Uint8Array(signature));
};

const hashRequestBody = async (req: Request, target: string) => {
  if (req.method === "GET" || req.method === "HEAD") {
    return "no-body";
  }

  const body = await readBoundedBodyBytes(
    req.clone(),
    getTrustedIngressBodyLimit(target),
  );
  const digest = await crypto.subtle.digest("SHA-256", body);
  return toHex(new Uint8Array(digest));
};

const verifyTrustedEdgeIngress = async (
  req: Request,
  target: string,
): Promise<VerifiedTrustedIngress | null> => {
  const secret = Deno.env.get("ITX_EDGE_PROXY_SHARED_SECRET")?.trim();
  if (!secret) {
    throw new Error("Missing ITX_EDGE_PROXY_SHARED_SECRET");
  }

  if (req.headers.get(EDGE_PROXY_HEADER) !== "1") {
    return null;
  }

  const timestamp = req.headers.get(EDGE_PROXY_TIMESTAMP_HEADER)?.trim() ?? "";
  const signature = req.headers.get(EDGE_PROXY_SIGNATURE_HEADER)?.trim() ?? "";
  const timestampMs = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(timestampMs)) {
    return null;
  }

  if (Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return null;
  }

  const requestId = req.headers.get("x-request-id")?.trim() ?? "";
  if (!requestId) {
    return null;
  }
  const bodyHash = req.headers.get(EDGE_PROXY_BODY_HASH_HEADER)?.trim() ?? "";
  if (
    !(bodyHash === "no-body" || /^[0-9a-f]{64}$/.test(bodyHash)) ||
    ((req.method === "GET" || req.method === "HEAD") !==
      (bodyHash === "no-body"))
  ) {
    return null;
  }
  const expected = await sign(
    secret,
    `${timestamp}.${requestId}.${req.method.toUpperCase()}.${target}.${bodyHash}`,
  );
  if (!timingSafeEqual(signature, expected)) return null;

  // Recheck after signature verification so a request that aged out while
  // being verified cannot claim a replay slot.
  const verifiedAt = Date.now();
  if (Math.abs(verifiedAt - timestampMs) > MAX_CLOCK_SKEW_MS) return null;

  return { bodyHash, requestId, signature, target, timestampMs, verifiedAt };
};

const claimAndVerifyTrustedIngressBody = async (
  req: Request,
  verified: VerifiedTrustedIngress,
): Promise<ReplayClaim | "body-mismatch" | "expired"> => {
  const actualBodyHash = await hashRequestBody(req, verified.target);
  if (!timingSafeEqual(actualBodyHash, verified.bodyHash)) {
    return "body-mismatch";
  }
  if (Math.abs(Date.now() - verified.timestampMs) > MAX_CLOCK_SKEW_MS) {
    return "expired";
  }

  const claim = await claimTrustedIngressRequest(
    verified.requestId,
    verified.signature,
    verified.verifiedAt,
  );
  return claim;
};

export const hasTrustedEdgeIngress = async (req: Request, target: string) => {
  const verified = await verifyTrustedEdgeIngress(req, target);
  if (verified === null) return false;

  // Authenticate the small signed digest before reading the body, so invalid
  // direct calls cannot trigger full-body hashing.
  const claim = await claimAndVerifyTrustedIngressBody(req, verified);
  if (claim === "claimed") return true;

  if (claim !== "body-mismatch" && claim !== "expired") {
    logReplayClaimFailure(claim, verified);
  }
  return false;
};

const logReplayClaimFailure = (
  claim: Exclude<ReplayClaim, "claimed">,
  verified: VerifiedTrustedIngress,
) => {
  console.error(
    claim === "replay"
      ? "trusted_ingress.replay_detected"
      : "trusted_ingress.replay_store_unavailable",
    {
      request_id: verified.requestId.slice(0, 128),
      target: verified.target.slice(0, 64),
    },
  );
};

export const requireTrustedEdgeIngress = async (
  req: Request,
  target: string,
  jsonResponse: (status: number, body: Record<string, unknown>) => Response,
) => {
  try {
    const verified = await verifyTrustedEdgeIngress(req, target);
    if (verified === null) {
      return jsonResponse(403, { error: "Trusted edge ingress required." });
    }
    const claim = await claimAndVerifyTrustedIngressBody(req, verified);
    if (claim === "claimed") return null;
    if (claim === "body-mismatch" || claim === "expired") {
      return jsonResponse(403, { error: "Trusted edge ingress required." });
    }

    logReplayClaimFailure(claim, verified);
    return claim === "replay"
      ? jsonResponse(409, { error: "Trusted edge request replay detected." })
      : jsonResponse(503, { error: "Trusted edge replay protection unavailable." });
  } catch (error) {
    if (
      error instanceof Error &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
    ) {
      return jsonResponse(
        (error as { status: number }).status,
        { error: error.message },
      );
    }
    if (
      error instanceof Error &&
      error.message === "Missing ITX_EDGE_PROXY_SHARED_SECRET"
    ) {
      return jsonResponse(500, { error: "Server misconfiguration." });
    }
    throw error;
  }
};
