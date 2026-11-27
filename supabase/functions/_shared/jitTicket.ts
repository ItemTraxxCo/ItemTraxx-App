export const JIT_TICKET_HEADER = "x-itx-jit-ticket";
export const JIT_TICKET_ISSUER = "itemtraxx-jit";
export const JIT_TICKET_AUDIENCE = "itemtraxx-sgw";

export type JitScope = "read_only" | "break_glass";

export type JitTicketClaims = {
  iss: typeof JIT_TICKET_ISSUER;
  aud: typeof JIT_TICKET_AUDIENCE;
  jti: string;
  tid: string;
  sub: string;
  ws: string;
  scope: JitScope;
  rsn: string;
  iat: number;
  exp: number;
};

export type JitSigningConfig = {
  privateJwk?: string | null;
  hmacSecret?: string | null;
};

export type JitVerificationConfig = {
  publicJwk?: string | null;
  hmacSecret?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64Url = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url encoding");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
};

const timingSafeEqualBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
};

const parseJwk = (raw: string): JsonWebKey => {
  const parsed = JSON.parse(raw) as JsonWebKey;
  if (!parsed || typeof parsed !== "object" || parsed.kty !== "EC" || parsed.crv !== "P-256") {
    throw new Error("JIT JWK must be an EC P-256 key");
  }
  return parsed;
};

export const resolveJitSigningConfig = (
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): JitSigningConfig => ({
  privateJwk: getEnv("ITX_JIT_TICKET_PRIVATE_JWK")?.trim() || null,
  hmacSecret: getEnv("ITX_JIT_TICKET_SIGNING_SECRET")?.trim() || null,
});

export const resolveJitVerificationConfig = (
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): JitVerificationConfig => ({
  publicJwk: getEnv("ITX_JIT_TICKET_PUBLIC_JWK")?.trim() || null,
  hmacSecret: getEnv("ITX_JIT_TICKET_SIGNING_SECRET")?.trim() || null,
});

export const resolveJitTtlConfig = (
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
) => {
  const rawMax = Number(getEnv("ITX_JIT_MAX_TTL_MINUTES") ?? "60");
  const maxMinutes = Number.isInteger(rawMax) && rawMax >= 1 && rawMax <= 60 ? rawMax : 60;
  const rawDefault = Number(getEnv("ITX_JIT_DEFAULT_TTL_MINUTES") ?? "15");
  const defaultMinutes = Number.isInteger(rawDefault) && rawDefault >= 1 && rawDefault <= maxMinutes
    ? rawDefault
    : Math.min(15, maxMinutes);
  return { defaultMinutes, maxMinutes };
};

export const signJitTicket = async (
  input: Omit<JitTicketClaims, "iss" | "aud">,
  config: JitSigningConfig = resolveJitSigningConfig(),
): Promise<string> => {
  const claims: JitTicketClaims = {
    iss: JIT_TICKET_ISSUER,
    aud: JIT_TICKET_AUDIENCE,
    jti: input.jti.toLowerCase(),
    tid: input.tid.toLowerCase(),
    sub: input.sub.toLowerCase(),
    ws: input.ws.toLowerCase(),
    scope: input.scope,
    rsn: input.rsn.slice(0, 128),
    iat: Math.floor(input.iat),
    exp: Math.floor(input.exp),
  };

  if (config.privateJwk) {
    const jwk = parseJwk(config.privateJwk);
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const header = toBase64Url(
      encoder.encode(JSON.stringify({ alg: "ES256", typ: "itx-jit+jwt" })),
    );
    const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
    const signingInput = `${header}.${payload}`;
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        encoder.encode(signingInput),
      ),
    );
    return `${signingInput}.${toBase64Url(signature)}`;
  }

  if (config.hmacSecret && config.hmacSecret.length >= 32) {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(config.hmacSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const header = toBase64Url(
      encoder.encode(JSON.stringify({ alg: "HS256", typ: "itx-jit+jwt" })),
    );
    const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
    const signingInput = `${header}.${payload}`;
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)),
    );
    return `${signingInput}.${toBase64Url(signature)}`;
  }

  throw new Error("JIT ticket signing key is not configured.");
};

export type VerifyJitSignatureResult =
  | { ok: true; claims: JitTicketClaims }
  | { ok: false; reason: string };

export const verifyJitTicketSignature = async (
  token: string,
  config: JitVerificationConfig = resolveJitVerificationConfig(),
  nowMs: number = Date.now(),
): Promise<VerifyJitSignatureResult> => {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 4096) {
    return { ok: false, reason: "malformed_token" };
  }
  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed_token" };
  }
  const [headerB64, payloadB64, sigB64] = parts;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  let signatureBytes: Uint8Array;
  try {
    header = JSON.parse(decoder.decode(fromBase64Url(headerB64)));
    payload = JSON.parse(decoder.decode(fromBase64Url(payloadB64)));
    signatureBytes = fromBase64Url(sigB64);
  } catch {
    return { ok: false, reason: "malformed_token" };
  }

  if (header?.typ !== "itx-jit+jwt") {
    return { ok: false, reason: "invalid_type" };
  }

  const signingInput = encoder.encode(`${headerB64}.${payloadB64}`);
  if (header.alg === "ES256") {
    if (!config.publicJwk) return { ok: false, reason: "verifier_unconfigured" };
    try {
      const jwk = parseJwk(config.publicJwk);
      const { d: _privatePart, ...publicOnly } = jwk;
      const key = await crypto.subtle.importKey(
        "jwk",
        publicOnly,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signatureBytes as unknown as BufferSource,
        signingInput,
      );
      if (!valid) return { ok: false, reason: "invalid_signature" };
    } catch {
      return { ok: false, reason: "invalid_signature" };
    }
  } else if (header.alg === "HS256") {
    if (!config.hmacSecret || config.hmacSecret.length < 32) {
      return { ok: false, reason: "verifier_unconfigured" };
    }
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(config.hmacSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const expected = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, signingInput),
      );
      if (!timingSafeEqualBytes(signatureBytes, expected)) {
        return { ok: false, reason: "invalid_signature" };
      }
    } catch {
      return { ok: false, reason: "invalid_signature" };
    }
  } else {
    return { ok: false, reason: "unsupported_algorithm" };
  }

  if (
    payload.iss !== JIT_TICKET_ISSUER ||
    payload.aud !== JIT_TICKET_AUDIENCE ||
    typeof payload.jti !== "string" || !UUID_RE.test(payload.jti) ||
    typeof payload.tid !== "string" || !UUID_RE.test(payload.tid) ||
    typeof payload.sub !== "string" || !UUID_RE.test(payload.sub) ||
    typeof payload.ws !== "string" || !UUID_RE.test(payload.ws) ||
    (payload.scope !== "read_only" && payload.scope !== "break_glass") ||
    typeof payload.rsn !== "string" ||
    typeof payload.iat !== "number" || !Number.isFinite(payload.iat) ||
    typeof payload.exp !== "number" || !Number.isFinite(payload.exp)
  ) {
    return { ok: false, reason: "invalid_claims" };
  }

  // Strict expiry check with zero grace window: T and T+1s are rejected.
  if (nowMs >= payload.exp * 1000) {
    return { ok: false, reason: "expired" };
  }
  if (payload.exp <= payload.iat || payload.exp - payload.iat > 3600) {
    return { ok: false, reason: "invalid_ttl" };
  }

  return {
    ok: true,
    claims: {
      iss: JIT_TICKET_ISSUER,
      aud: JIT_TICKET_AUDIENCE,
      jti: payload.jti.toLowerCase(),
      tid: payload.tid.toLowerCase(),
      sub: payload.sub.toLowerCase(),
      ws: payload.ws.toLowerCase(),
      scope: payload.scope,
      rsn: payload.rsn,
      iat: payload.iat,
      exp: payload.exp,
    },
  };
};

export const extractJitTicketToken = (req: Request): string | null => {
  const value = req.headers.get(JIT_TICKET_HEADER)?.trim();
  return value && value.length <= 4096 ? value : null;
};

export const scopeSatisfies = (granted: JitScope, required: JitScope): boolean =>
  required === "read_only" || granted === "break_glass";

export const hashClientIp = async (
  req: Request,
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): Promise<string | null> => {
  const ip = req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  const secret = getEnv("ITX_EDGE_PROXY_SHARED_SECRET")?.trim() ||
    getEnv("ITX_AUDIT_WEBHOOK_SIGNING_SECRET")?.trim() ||
    "";
  if (!ip || !secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(ip)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type RequireJitOptions = {
  req: Request;
  adminClient: RpcClient;
  actorId: string;
  actorEmail?: string | null;
  workspaceId: string;
  requiredScope: JitScope;
  action: string;
  requestId?: string | null;
  verificationConfig?: JitVerificationConfig;
  nowMs?: number;
};

export type RequireJitResult =
  | { ok: true; claims: JitTicketClaims; token: string }
  | { ok: false; status: 403 | 503; error: string; reason: string };

const recordDeniedAccess = async (
  options: RequireJitOptions,
  reason: string,
  ticketId: string | null = null,
  grantedScope: JitScope | null = null,
) => {
  try {
    const ipHash = await hashClientIp(options.req);
    await options.adminClient.rpc("append_jit_audit_log", {
      p_event_type: "jit.access.denied",
      p_actor_id: options.actorId,
      p_actor_email: options.actorEmail ?? null,
      p_target_workspace_id: UUID_RE.test(options.workspaceId) ? options.workspaceId : null,
      p_ticket_id: ticketId,
      p_scope: grantedScope,
      p_action: options.action,
      p_reason: reason,
      p_client_ip_hash: ipHash,
      p_user_agent: options.req.headers.get("user-agent")?.slice(0, 512) ?? null,
      p_request_id: options.requestId ?? options.req.headers.get("x-request-id")?.slice(0, 128) ?? null,
      p_metadata: {
        required_scope: options.requiredScope,
        denial_reason: reason,
      },
      p_event_signature: "",
    });
  } catch {
    // Best-effort audit of denied access; never turn a 403 denial into a 500 leak.
  }
};

export const requireValidJitTicket = async (
  options: RequireJitOptions,
): Promise<RequireJitResult> => {
  const token = extractJitTicketToken(options.req);
  if (!token) {
    await recordDeniedAccess(options, "missing_ticket");
    return {
      ok: false,
      status: 403,
      error: "Valid JIT support ticket required.",
      reason: "missing_ticket",
    };
  }

  const verified = await verifyJitTicketSignature(
    token,
    options.verificationConfig ?? resolveJitVerificationConfig(),
    options.nowMs ?? Date.now(),
  );
  if (!verified.ok) {
    await recordDeniedAccess(options, verified.reason);
    return {
      ok: false,
      status: 403,
      error: verified.reason === "expired"
        ? "JIT support ticket has expired."
        : "Valid JIT support ticket required.",
      reason: verified.reason,
    };
  }

  const { claims } = verified;
  if (claims.sub !== options.actorId.toLowerCase()) {
    await recordDeniedAccess(options, "actor_mismatch", claims.tid, claims.scope);
    return {
      ok: false,
      status: 403,
      error: "JIT support ticket is not valid for this actor.",
      reason: "actor_mismatch",
    };
  }

  if (claims.ws !== options.workspaceId.toLowerCase()) {
    await recordDeniedAccess(options, "workspace_mismatch", claims.tid, claims.scope);
    return {
      ok: false,
      status: 403,
      error: "JIT support ticket is not valid for this workspace.",
      reason: "workspace_mismatch",
    };
  }

  if (!scopeSatisfies(claims.scope, options.requiredScope)) {
    await recordDeniedAccess(options, "insufficient_scope", claims.tid, claims.scope);
    return {
      ok: false,
      status: 403,
      error: "Break-glass JIT ticket required for this operation.",
      reason: "insufficient_scope",
    };
  }

  const { data: activeInDb, error: dbError } = await options.adminClient.rpc(
    "verify_jit_support_ticket",
    {
      p_ticket_id: claims.tid,
      p_token_jti: claims.jti,
      p_admin_user_id: claims.sub,
      p_workspace_id: claims.ws,
      p_required_scope: options.requiredScope,
      ...(options.nowMs !== undefined
        ? { p_at: new Date(options.nowMs).toISOString() }
        : {}),
    },
  );

  if (dbError) {
    return {
      ok: false,
      status: 503,
      error: "JIT ticket verification unavailable.",
      reason: "verification_unavailable",
    };
  }

  if (activeInDb !== true) {
    await recordDeniedAccess(options, "revoked_or_expired", claims.tid, claims.scope);
    return {
      ok: false,
      status: 403,
      error: "JIT support ticket is inactive, revoked, or expired.",
      reason: "revoked_or_expired",
    };
  }

  return { ok: true, claims, token };
};

export const recordJitTicketUse = async (
  options: {
    req: Request;
    adminClient: RpcClient;
    claims: JitTicketClaims;
    actorEmail?: string | null;
    action: string;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  },
) => {
  const ipHash = await hashClientIp(options.req);
  const { error } = await options.adminClient.rpc("append_jit_audit_log", {
    p_event_type: "jit.ticket.used",
    p_actor_id: options.claims.sub,
    p_actor_email: options.actorEmail ?? null,
    p_target_workspace_id: options.claims.ws,
    p_ticket_id: options.claims.tid,
    p_scope: options.claims.scope,
    p_action: options.action,
    p_reason: options.claims.rsn,
    p_client_ip_hash: ipHash,
    p_user_agent: options.req.headers.get("user-agent")?.slice(0, 512) ?? null,
    p_request_id: options.requestId ?? options.req.headers.get("x-request-id")?.slice(0, 128) ?? null,
    p_metadata: options.metadata ?? {},
    p_event_signature: "",
  });
  if (error) {
    throw new Error("Unable to record JIT audit entry.");
  }
};
