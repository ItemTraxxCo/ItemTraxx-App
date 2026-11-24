import { blindIndexes, decryptPayload, encryptPayload, generateWorkspaceKeys, unwrapWorkspaceKeys } from './crypto.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
async function equalSecret(actual, expected) {
  const [a, b] = await Promise.all([actual, expected].map((v) => crypto.subtle.digest('SHA-256', encoder.encode(v))));
  let mismatch = 0;
  const left = new Uint8Array(a), right = new Uint8Array(b);
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
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
export function coordinatorUrl(env) {
  const base = new URL(env.SUPABASE_URL);
  const local = env.SGW_LOCAL_DEV === 'true' && base.protocol === 'http:' && base.hostname === '127.0.0.1' && !!base.port;
  if ((base.protocol !== 'https:' && !local) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid coordinator URL');
  return new URL('/rest/v1/rpc/sgw_key_lifecycle_transition', base).toString();
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

export async function handleRequest(request, env, transition = coordinate) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    const supplied = request.headers.get('authorization') ?? '';
    const path = new URL(request.url).pathname;
    const secret = path.startsWith('/v1/kms/') ? env.KMS_LIFECYCLE_SECRET : env.KMS_INTERNAL_SECRET;
    if (typeof secret !== 'string' || secret.length < 32 || !await equalSecret(supplied, `Bearer ${secret}`)) return json(401, { error: 'Unauthorized' });
    if (!['/v1/crypto/encrypt', '/v1/crypto/decrypt', '/v1/crypto/hash-index', '/v1/kms/generate-tenant-keys', '/v1/kms/revoke-tenant-keys'].includes(path)) return json(404, { error: 'Not found' });
    if (env.SGW_RESTORE_HOLD === 'true') return json(503, { error: 'Gateway temporarily unavailable' });
    let body;
    try { body = await readBody(request); } catch { return json(400, { error: 'Invalid request' }); }
    if (!object(body) || typeof body.workspace_id !== 'string' || !UUID.test(body.workspace_id)) return json(400, { error: 'Invalid request' });
    body.workspace_id = body.workspace_id.toLowerCase();
    if (path.startsWith('/v1/kms/')) {
      const provision = path.endsWith('/generate-tenant-keys');
      if (provision && env.SGW_PROVISIONING_ENABLED !== 'true') return json(503, { error: 'Key provisioning disabled' });
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
    if (path === '/v1/crypto/encrypt' && (!UUID.test(body.id ?? '') || !object(body.payload) || (body.index_fields !== undefined && !object(body.index_fields)))) return json(400, { error: 'Invalid request' });
    if (path === '/v1/crypto/hash-index' && !object(body.values)) return json(400, { error: 'Invalid request' });
    if (path === '/v1/crypto/decrypt' && (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100 || body.items.some((item) => !object(item) || !UUID.test(item.id ?? '') || typeof item.ciphertext !== 'string' || typeof item.nonce !== 'string' || typeof item.auth_tag !== 'string'))) return json(400, { error: 'Invalid request' });
    if (path === '/v1/crypto/encrypt') body.id = body.id.toLowerCase();
    if (path === '/v1/crypto/decrypt') body.items = body.items.map((item) => ({ ...item, id: item.id.toLowerCase() }));
    try {
      if (!await transition('is_active', body.workspace_id, env)) return json(404, { error: 'Workspace key unavailable' });
      const wrapped = await env.KEYS.get(body.workspace_id);
      if (wrapped === null) return json(404, { error: 'Workspace key unavailable' });
      const kek = Uint8Array.from(atob(env.MASTER_KEK), (char) => char.charCodeAt(0));
      const keys = await unwrapWorkspaceKeys(kek, body.workspace_id, JSON.parse(wrapped));
      if (path === '/v1/crypto/encrypt') return json(200, { ...await encryptPayload(keys.dek, body.workspace_id, body.id, body.payload), ...await blindIndexes(keys.pepper, body.index_fields ?? {}) });
      if (path === '/v1/crypto/hash-index') return json(200, await blindIndexes(keys.pepper, body.values));
      const items = await Promise.all(body.items.map(async (item) => ({ id: item.id, payload: await decryptPayload(keys.dek, body.workspace_id, item.id, item) })));
      return json(200, { items });
    } catch { return json(500, { error: 'Cryptographic operation failed' }); }
}
export default { fetch: (request, env) => handleRequest(request, env) };
