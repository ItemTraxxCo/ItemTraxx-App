import { blindIndexes, decryptPayload, encryptPayload, generateWorkspaceKeys, unwrapWorkspaceKeys } from './crypto.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

async function equalSecret(actual, expected) {
  const [a, b] = await Promise.all([actual, expected].map((v) => crypto.subtle.digest('SHA-256', encoder.encode(v))));
  let mismatch = 0;
  const left = new Uint8Array(a), right = new Uint8Array(b);
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function readBody(request) {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new Error('Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function rpcUrl(env, rpcName) {
  const base = new URL(env.SUPABASE_URL);
  const local = env.SGW_LOCAL_DEV === 'true' && base.protocol === 'http:' && base.hostname === '127.0.0.1' && !!base.port;
  if ((base.protocol !== 'https:' && !local) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid coordinator URL');
  return new URL(`/rest/v1/rpc/${rpcName}`, base).toString();
}

export function coordinatorUrl(env) {
  return rpcUrl(env, 'sgw_key_lifecycle_transition');
}

async function coordinate(action, workspaceId, env) {
  const response = await fetch(coordinatorUrl(env), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ p_workspace_id: workspaceId, p_action: action }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Coordinator unavailable');
  const result = await response.json();
  if (typeof result !== 'boolean') throw new Error('Invalid coordinator response');
  return result;
}

async function verifyJitTicketWithCoordinator(claims, requiredScope, env) {
  const response = await fetch(rpcUrl(env, 'verify_jit_support_ticket'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({
      p_ticket_id: claims.tid,
      p_token_jti: claims.jti,
      p_admin_user_id: claims.sub,
      p_workspace_id: claims.ws,
      p_required_scope: requiredScope,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result === true;
}

async function verifyJitTicketToken(token, workspaceId, requiredScope, env, verifyJitDb, nowMs) {
  if (typeof token !== 'string' || !token.trim() || token.length > 4096) return false;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  let header;
  let claims;
  let signature;
  try {
    header = JSON.parse(decoder.decode(fromBase64Url(parts[0])));
    claims = JSON.parse(decoder.decode(fromBase64Url(parts[1])));
    signature = fromBase64Url(parts[2]);
  } catch {
    return false;
  }
  if (!object(header) || !object(claims) || header.typ !== 'itx-jit+jwt') return false;
  const signingInput = encoder.encode(`${parts[0]}.${parts[1]}`);
  if (header.alg === 'ES256') {
    if (typeof env.ITX_JIT_TICKET_PUBLIC_JWK !== 'string' || !env.ITX_JIT_TICKET_PUBLIC_JWK.trim()) return false;
    try {
      const parsed = JSON.parse(env.ITX_JIT_TICKET_PUBLIC_JWK);
      if (!object(parsed) || parsed.kty !== 'EC' || parsed.crv !== 'P-256') return false;
      const { d: _privatePart, ...publicOnly } = parsed;
      const key = await crypto.subtle.importKey('jwk', publicOnly, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signingInput)) return false;
    } catch {
      return false;
    }
  } else if (header.alg === 'HS256') {
    if (typeof env.ITX_JIT_TICKET_SIGNING_SECRET !== 'string' || env.ITX_JIT_TICKET_SIGNING_SECRET.length < 32) return false;
    try {
      const key = await crypto.subtle.importKey('raw', encoder.encode(env.ITX_JIT_TICKET_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, signingInput));
      if (!equalBytes(signature, expected)) return false;
    } catch {
      return false;
    }
  } else {
    return false;
  }

  if (
    claims.iss !== 'itemtraxx-jit' ||
    claims.aud !== 'itemtraxx-sgw' ||
    typeof claims.jti !== 'string' || !UUID.test(claims.jti) ||
    typeof claims.tid !== 'string' || !UUID.test(claims.tid) ||
    typeof claims.sub !== 'string' || !UUID.test(claims.sub) ||
    typeof claims.ws !== 'string' || !UUID.test(claims.ws) ||
    (claims.scope !== 'read_only' && claims.scope !== 'break_glass') ||
    typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) ||
    typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)
  ) {
    return false;
  }

  if (claims.ws.toLowerCase() !== workspaceId) return false;
  if (claims.exp <= claims.iat || claims.exp - claims.iat > 3600) return false;
  if (nowMs >= claims.exp * 1000) return false;
  if (requiredScope === 'break_glass' && claims.scope !== 'break_glass') return false;

  try {
    return await verifyJitDb(
      {
        jti: claims.jti.toLowerCase(),
        tid: claims.tid.toLowerCase(),
        sub: claims.sub.toLowerCase(),
        ws: claims.ws.toLowerCase(),
        scope: claims.scope,
      },
      requiredScope,
      env,
    );
  } catch {
    return false;
  }
}

export async function handleRequest(
  request,
  env,
  transition = coordinate,
  verifyJitDb = verifyJitTicketWithCoordinator,
  nowMs = Date.now(),
) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const supplied = request.headers.get('authorization') ?? '';
  const path = new URL(request.url).pathname;
  const isJitPath = path === '/v1/crypto/jit/decrypt' || path === '/v1/crypto/jit/encrypt';
  const secret = path.startsWith('/v1/kms/')
    ? env.KMS_LIFECYCLE_SECRET
    : isJitPath
    ? env.KMS_JIT_SECRET
    : env.KMS_INTERNAL_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || !await equalSecret(supplied, `Bearer ${secret}`)) return json(401, { error: 'Unauthorized' });
  if (!['/v1/crypto/encrypt', '/v1/crypto/decrypt', '/v1/crypto/hash-index', '/v1/crypto/jit/encrypt', '/v1/crypto/jit/decrypt', '/v1/kms/generate-tenant-keys', '/v1/kms/revoke-tenant-keys'].includes(path)) return json(404, { error: 'Not found' });
  if (env.SGW_RESTORE_HOLD === 'true') return json(503, { error: 'Gateway temporarily unavailable' });
  let body;
  try { body = await readBody(request); } catch { return json(400, { error: 'Invalid request' }); }
  if (!object(body) || typeof body.workspace_id !== 'string' || !UUID.test(body.workspace_id)) return json(400, { error: 'Invalid request' });
  body.workspace_id = body.workspace_id.toLowerCase();
  if (path.startsWith('/v1/kms/')) {
    const provision = path.endsWith('/generate-tenant-keys');
    if (provision && env.SGW_PROVISIONING_ENABLED !== 'true') return json(503, { error: 'Key provisioning disabled' });
    if (provision && env.SGW_PROVISIONING_WORKSPACE !== undefined &&
        (typeof env.SGW_PROVISIONING_WORKSPACE !== 'string' || !UUID.test(env.SGW_PROVISIONING_WORKSPACE) || env.SGW_PROVISIONING_WORKSPACE.toLowerCase() !== body.workspace_id)) {
      return json(503, { error: 'Key provisioning disabled' });
    }
    try {
      if (!await transition(provision ? 'claim_provision' : 'claim_revoke', body.workspace_id, env)) {
        if (provision) return json(409, { error: 'Lifecycle transition unavailable' });
        if (await transition('is_revoked', body.workspace_id, env)) return json(200, { status: 'revoked' });
        if (!await transition('is_revoking', body.workspace_id, env)) return json(409, { error: 'Lifecycle transition unavailable' });
      }
      if (provision) {
        if (await env.KEYS.get(body.workspace_id) !== null) return json(409, { error: 'Key already exists; reconciliation required' });
        const kek = Uint8Array.from(atob(env.MASTER_KEK), (char) => char.charCodeAt(0));
        const wrapped = await generateWorkspaceKeys(kek, body.workspace_id);
        await env.KEYS.put(body.workspace_id, JSON.stringify(wrapped));
      } else {
        await env.KEYS.delete(body.workspace_id);
      }
      if (!await transition(provision ? 'finish_provision' : 'finish_revoke', body.workspace_id, env)) {
        if (provision || !await transition('is_revoked', body.workspace_id, env)) throw new Error('Incomplete transition');
      }
      return json(200, { status: provision ? 'active' : 'revoked' });
    } catch { return json(503, { error: 'Lifecycle operation incomplete; reconciliation required' }); }
  }
  const cryptoOp = path === '/v1/crypto/jit/encrypt'
    ? 'encrypt'
    : path === '/v1/crypto/jit/decrypt'
    ? 'decrypt'
    : path.replace('/v1/crypto/', '');
  if (cryptoOp === 'encrypt' && (!UUID.test(body.id ?? '') || !object(body.payload) || (body.index_fields !== undefined && !object(body.index_fields)))) return json(400, { error: 'Invalid request' });
  if (cryptoOp === 'hash-index' && !object(body.values)) return json(400, { error: 'Invalid request' });
  if (cryptoOp === 'decrypt' && (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100 || body.items.some((item) => !object(item) || !UUID.test(item.id ?? '') || typeof item.ciphertext !== 'string' || typeof item.nonce !== 'string' || typeof item.auth_tag !== 'string'))) return json(400, { error: 'Invalid request' });
  if (isJitPath) {
    const requiredScope = cryptoOp === 'encrypt' ? 'break_glass' : 'read_only';
    const jitToken = request.headers.get('x-itx-jit-ticket') ?? '';
    const jitValid = await verifyJitTicketToken(jitToken, body.workspace_id, requiredScope, env, verifyJitDb, nowMs);
    if (!jitValid) return json(403, { error: 'Valid JIT support ticket required' });
  }
  if (cryptoOp === 'encrypt') body.id = body.id.toLowerCase();
  if (cryptoOp === 'decrypt') body.items = body.items.map((item) => ({ ...item, id: item.id.toLowerCase() }));
  try {
    if (!await transition('is_active', body.workspace_id, env)) return json(404, { error: 'Workspace key unavailable' });
    const wrapped = await env.KEYS.get(body.workspace_id);
    if (wrapped === null) return json(404, { error: 'Workspace key unavailable' });
    const kek = Uint8Array.from(atob(env.MASTER_KEK), (char) => char.charCodeAt(0));
    const keys = await unwrapWorkspaceKeys(kek, body.workspace_id, JSON.parse(wrapped));
    if (cryptoOp === 'encrypt') return json(200, { ...await encryptPayload(keys.dek, body.workspace_id, body.id, body.payload), ...await blindIndexes(keys.pepper, body.index_fields ?? {}) });
    if (cryptoOp === 'hash-index') return json(200, await blindIndexes(keys.pepper, body.values));
    const items = await Promise.all(body.items.map(async (item) => ({ id: item.id, payload: await decryptPayload(keys.dek, body.workspace_id, item.id, item) })));
    return json(200, { items });
  } catch { return json(500, { error: 'Cryptographic operation failed' }); }
}
export default { fetch: (request, env) => handleRequest(request, env) };
