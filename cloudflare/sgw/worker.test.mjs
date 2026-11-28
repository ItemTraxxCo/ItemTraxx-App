import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from './worker.mjs';
import { generateWorkspaceKeys } from './crypto.mjs';

const workspace = 'd8b57c2b-c473-451e-9d0b-a0989ac8a8a4';
const id = 'e535bd49-df6a-4c94-8e77-f9497ab83e43';
const key = crypto.getRandomValues(new Uint8Array(32));
const store = new Map();
const env = { MASTER_KEK: btoa(String.fromCharCode(...key)), KMS_INTERNAL_SECRET: 'a'.repeat(64), KMS_LIFECYCLE_SECRET: 'b'.repeat(64), SGW_PROVISIONING_ENABLED: 'true', KEYS: { get: async (k) => store.get(k) ?? null } };
const request = (path, body, secret = env.KMS_INTERNAL_SECRET) => new Request(`https://sgw.itemtraxx.com${path}`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const call = (path, body, secret) => handleRequest(request(path, body, secret), env, async () => true);

test('provisioning is disabled by default and does not touch the coordinator or KV', async () => {
  let touched = false;
  const custom = { ...env, SGW_PROVISIONING_ENABLED: undefined, KEYS: { get: async () => { touched = true; return null; } } };
  const response = await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, async () => { touched = true; return true; });
  assert.equal(response.status, 503);
  assert.equal(touched, false);
});

test('a configured provisioning workspace allows only that workspace', async () => {
  let claims = 0;
  const custom = { ...env, SGW_PROVISIONING_WORKSPACE: workspace, KEYS: { get: async () => null, put: async () => {} } };
  const transition = async () => { claims++; return true; };
  const wrong = await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: crypto.randomUUID() }, env.KMS_LIFECYCLE_SECRET), custom, transition);
  assert.equal(wrong.status, 503);
  assert.equal(claims, 0);
  const allowed = await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace.toUpperCase() }, env.KMS_LIFECYCLE_SECRET), custom, transition);
  assert.equal(allowed.status, 200);
  assert.equal(claims, 2);
  const invalid = { ...custom, SGW_PROVISIONING_WORKSPACE: 'not-a-uuid' };
  assert.equal((await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), invalid, transition)).status, 503);
  assert.equal(claims, 2);
});

test('closing the provisioning gate does not prevent revocation', async () => {
  let state = 'active';
  const coordinator = async (action) => {
    if (action === 'claim_revoke' && state === 'active') { state = 'revoking'; return true; }
    if (action === 'finish_revoke' && state === 'revoking') { state = 'revoked'; return true; }
    return false;
  };
  const custom = { ...env, SGW_PROVISIONING_ENABLED: 'false', KEYS: { delete: async () => {} } };
  const response = await handleRequest(request('/v1/kms/revoke-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator);
  assert.equal(response.status, 200);
  assert.equal(state, 'revoked');
});

test('restore hold blocks key provisioning and all crypto before touching database or KV', async () => {
  let touched = false;
  const custom = { ...env, SGW_RESTORE_HOLD: 'true', KEYS: { get: async () => { touched = true; return null; } } };
  for (const [path, body, secret] of [
    ['/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET],
    ['/v1/kms/revoke-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET],
    ['/v1/crypto/hash-index', { workspace_id: workspace, values: { borrower_id: 'x' } }, env.KMS_INTERNAL_SECRET],
    ['/v1/crypto/encrypt', { workspace_id: workspace, id, payload: {} }, env.KMS_INTERNAL_SECRET],
    ['/v1/crypto/decrypt', { workspace_id: workspace, items: [{ id, ciphertext: '', nonce: '', auth_tag: '' }] }, env.KMS_INTERNAL_SECRET],
  ]) {
    const response = await handleRequest(request(path, body, secret), custom, async () => { touched = true; return true; });
    assert.equal(response.status, 503);
  }
  assert.equal(touched, false);
});

test('gateway denies unauthorized requests and fails closed for missing keys', async () => {
  assert.equal((await call('/v1/crypto/hash-index', { workspace_id: workspace, values: { borrower_id: 'a' } }, 'wrong')).status, 401);
  assert.equal((await call('/v1/crypto/hash-index', { workspace_id: workspace, values: { borrower_id: 'a' } })).status, 404);
});

test('gateway encrypts and decrypts using workspace keys without exposing them', async () => {
  store.set(workspace, JSON.stringify(await generateWorkspaceKeys(key, workspace)));
  const encryptedResponse = await call('/v1/crypto/encrypt', { workspace_id: workspace, id, payload: { name: 'Alice' }, index_fields: { borrower_id: 'ID 1' } });
  assert.equal(encryptedResponse.status, 200);
  const encrypted = await encryptedResponse.json();
  assert.equal(JSON.stringify(encrypted).includes('Alice'), false);
  const response = await call('/v1/crypto/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] });
  assert.deepEqual(await response.json(), { items: [{ id, payload: { name: 'Alice' } }] });
  const hashResponse = await call('/v1/crypto/hash-index', { workspace_id: workspace, values: { borrower_id: ' id 1 ' } });
  assert.equal((await hashResponse.json()).borrower_id_hash, encrypted.borrower_id_hash);
  store.delete(workspace);
  assert.equal((await call('/v1/crypto/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] })).status, 404);
});

test('gateway rejects malformed and tampered batch without returning plaintext', async () => {
  store.set(workspace, JSON.stringify(await generateWorkspaceKeys(key, workspace)));
  const valid = await (await call('/v1/crypto/encrypt', { workspace_id: workspace, id, payload: { name: 'Alice' } })).json();
  const response = await call('/v1/crypto/decrypt', { workspace_id: workspace, items: [{ id, ...valid }, { id: crypto.randomUUID(), ...valid }] });
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('Alice'), false);
  assert.equal((await call('/v1/crypto/decrypt', { workspace_id: workspace, items: [] })).status, 400);
  assert.equal((await call('/v1/crypto/encrypt', { workspace_id: workspace, id, payload: [] })).status, 400);
});

test('provisioning claims workspace once and does not overwrite on concurrent requests', async () => {
  const state = new Map();
  const kv = new Map();
  const coordinator = async (action, workspaceId) => {
    if (action === 'claim_provision') {
      if (state.has(workspaceId)) return false;
      state.set(workspaceId, 'provisioning'); return true;
    }
    if (action === 'finish_provision' && state.get(workspaceId) === 'provisioning') { state.set(workspaceId, 'active'); return true; }
    return false;
  };
  const custom = { ...env, COORDINATOR: coordinator, KEYS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { await new Promise((resolve) => setTimeout(resolve, 5)); kv.set(k, v); } } };
  const provision = () => handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator);
  const responses = await Promise.all([provision(), provision()]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(kv.size, 1);
  assert.equal(state.get(workspace), 'active');
});

test('ambiguous provisioning remains locked and revocation is terminal', async () => {
  let state;
  let value;
  const coordinator = async (action) => {
    if (action === 'claim_provision' && !state) { state = 'provisioning'; return true; }
    if (action === 'finish_provision' && state === 'provisioning') { state = 'active'; return true; }
    if (action === 'claim_revoke' && state === 'active') { state = 'revoking'; return true; }
    if (action === 'finish_revoke' && state === 'revoking') { state = 'revoked'; return true; }
    return false;
  };
  const custom = { ...env, COORDINATOR: coordinator, KEYS: { get: async () => value ?? null, put: async (_k, v) => { value = v; throw new Error('ambiguous'); }, delete: async () => { value = undefined; } } };
  const callCustom = (path) => handleRequest(request(path, { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator);
  assert.equal((await callCustom('/v1/kms/generate-tenant-keys')).status, 503);
  const first = value;
  assert.equal((await callCustom('/v1/kms/generate-tenant-keys')).status, 409);
  assert.equal(value, first);
  assert.equal(state, 'provisioning');
  state = 'active'; // Simulate an audited reconciliation after verifying the stored key.
  assert.equal((await callCustom('/v1/kms/revoke-tenant-keys')).status, 200);
  assert.equal(state, 'revoked');
  assert.equal(value, undefined);
  assert.equal((await callCustom('/v1/kms/generate-tenant-keys')).status, 409);
});

test('revocation blocks crypto even when KV deletion fails', async () => {
  let state = 'active';
  const value = JSON.stringify(await generateWorkspaceKeys(key, workspace));
  const coordinator = async (action) => {
    if (action === 'is_active') return state === 'active';
    if (action === 'claim_revoke' && state === 'active') { state = 'revoking'; return true; }
    return false;
  };
  const custom = { ...env, KEYS: { get: async () => value, delete: async () => { throw new Error('unavailable'); } } };
  const callCustom = (path, body) => handleRequest(request(path, body, path.startsWith('/v1/kms/') ? env.KMS_LIFECYCLE_SECRET : env.KMS_INTERNAL_SECRET), custom, coordinator);
  assert.equal((await callCustom('/v1/kms/revoke-tenant-keys', { workspace_id: workspace })).status, 503);
  assert.equal(state, 'revoking');
  assert.equal((await callCustom('/v1/crypto/hash-index', { workspace_id: workspace, values: { borrower_id: 'x' } })).status, 404);
});

test('interrupted revocation can retry safely and completed revocation is idempotent', async () => {
  let state = 'active';
  let deletes = 0;
  const coordinator = async (action) => {
    if (action === 'claim_revoke' && state === 'active') { state = 'revoking'; return true; }
    if (action === 'is_revoking') return state === 'revoking';
    if (action === 'is_revoked') return state === 'revoked';
    if (action === 'finish_revoke' && state === 'revoking') { state = 'revoked'; return true; }
    return false;
  };
  const custom = { ...env, KEYS: { delete: async () => { if (++deletes === 1) throw new Error('temporary failure'); } } };
  const revoke = () => handleRequest(request('/v1/kms/revoke-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator);
  assert.equal((await revoke()).status, 503);
  assert.equal(state, 'revoking');
  assert.equal((await revoke()).status, 200);
  assert.equal(state, 'revoked');
  assert.equal((await revoke()).status, 200);
  assert.equal(deletes, 2);
});

test('concurrent revocations both finish without reactivating the workspace', async () => {
  let state = 'active';
  const coordinator = async (action) => {
    if (action === 'claim_revoke' && state === 'active') { state = 'revoking'; return true; }
    if (action === 'is_revoking') return state === 'revoking';
    if (action === 'is_revoked') return state === 'revoked';
    if (action === 'finish_revoke' && state === 'revoking') { state = 'revoked'; return true; }
    return false;
  };
  const custom = { ...env, KEYS: { delete: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); } } };
  const revoke = () => handleRequest(request('/v1/kms/revoke-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator);
  const responses = await Promise.all([revoke(), revoke()]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(state, 'revoked');
});

test('an existing KV entry is not overwritten by provisioning', async () => {
  let state;
  let writes = 0;
  const coordinator = async (action) => {
    if (action === 'claim_provision' && !state) { state = 'provisioning'; return true; }
    return false;
  };
  const custom = { ...env, KEYS: { get: async () => 'existing', put: async () => { writes++; } } };
  const response = await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator);
  assert.equal(response.status, 409);
  assert.equal(writes, 0);
  assert.equal(state, 'provisioning');
});

test('ordinary crypto bearer cannot perform key lifecycle operations', async () => {
  const custom = { ...env, KMS_LIFECYCLE_SECRET: 'b'.repeat(64) };
  const response = await handleRequest(request('/v1/kms/revoke-tenant-keys', { workspace_id: workspace }), custom, async () => true);
  assert.equal(response.status, 401);
});

test('production coordinator sends the secret API key without a bearer token', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ url: String(url), body: JSON.parse(options.body), headers: options.headers });
    return new Response(JSON.stringify(false), { status: 200 });
  };
  try {
    const custom = { ...env, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_key' };
    const response = await worker.fetch(request('/v1/crypto/hash-index', { workspace_id: workspace, values: { borrower_id: 'a' } }), custom);
    assert.equal(response.status, 404);
    assert.deepEqual(seen, [{ url: 'https://example.supabase.co/rest/v1/rpc/sgw_key_lifecycle_transition', body: { p_workspace_id: workspace, p_action: 'is_active' }, headers: { 'content-type': 'application/json', apikey: 'sb_secret_test_key' } }]);
  } finally { globalThis.fetch = original; }
});

test('UUID case does not change key lookup or ciphertext context', async () => {
  store.set(workspace, JSON.stringify(await generateWorkspaceKeys(key, workspace)));
  const encrypted = await (await call('/v1/crypto/encrypt', { workspace_id: workspace.toUpperCase(), id: id.toUpperCase(), payload: { name: 'Case' } })).json();
  const response = await call('/v1/crypto/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].payload.name, 'Case');
});

test('coordinator local HTTP override is restricted to explicit loopback development', async () => {
  const { coordinatorUrl } = await import('./worker.mjs');
  assert.equal(coordinatorUrl({ SUPABASE_URL: 'https://example.supabase.co' }), 'https://example.supabase.co/rest/v1/rpc/sgw_key_lifecycle_transition');
  assert.throws(() => coordinatorUrl({ SUPABASE_URL: 'http://127.0.0.1:54321' }));
  assert.equal(coordinatorUrl({ SUPABASE_URL: 'http://127.0.0.1:54321', SGW_LOCAL_DEV: 'true' }), 'http://127.0.0.1:54321/rest/v1/rpc/sgw_key_lifecycle_transition');
  assert.throws(() => coordinatorUrl({ SUPABASE_URL: 'http://evil.test', SGW_LOCAL_DEV: 'true' }));
});

async function signTestJitToken(claims, privateKey) {
  const encodeB64Url = (obj) => btoa(JSON.stringify(obj)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const header = encodeB64Url({ alg: 'ES256', typ: 'itx-jit+jwt' });
  const payload = encodeB64Url({ iss: 'itemtraxx-jit', aud: 'itemtraxx-sgw', ...claims });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(`${header}.${payload}`)));
  const sigB64 = btoa(String.fromCharCode(...sig)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `${header}.${payload}.${sigB64}`;
}

test('JIT gateway routes enforce signed ticket, expiry at T+1s, workspace binding, scope, and DB revocation', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey));
  const jitSecret = 'c'.repeat(64);
  store.set(workspace, JSON.stringify(await generateWorkspaceKeys(key, workspace)));
  const jitEnv = { ...env, KMS_JIT_SECRET: jitSecret, ITX_JIT_TICKET_PUBLIC_JWK: publicJwk };

  const encrypted = await (await call('/v1/crypto/encrypt', { workspace_id: workspace, id, payload: { first_name: 'Maya', borrower_id: 'B100' } })).json();
  const iat = 1_700_000_000;
  const exp = iat + 900;
  const baseClaims = {
    jti: crypto.randomUUID(),
    tid: crypto.randomUUID(),
    sub: crypto.randomUUID(),
    ws: workspace,
    rsn: 'SUP-77',
    iat,
    exp,
  };
  const readOnlyToken = await signTestJitToken({ ...baseClaims, scope: 'read_only' }, pair.privateKey);
  const breakGlassToken = await signTestJitToken({ ...baseClaims, jti: crypto.randomUUID(), tid: crypto.randomUUID(), scope: 'break_glass' }, pair.privateKey);

  const jitReq = (path, body, token) => new Request(`https://sgw.itemtraxx.com${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jitSecret}`,
      'content-type': 'application/json',
      ...(token ? { 'x-itx-jit-ticket': token } : {}),
    },
    body: JSON.stringify(body),
  });

  // Missing ticket -> 403 before touching KV
  let kvTouched = false;
  const noTouchEnv = { ...jitEnv, KEYS: { get: async () => { kvTouched = true; return null; } } };
  const missing = await handleRequest(jitReq('/v1/crypto/jit/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] }, null), noTouchEnv, async () => true, async () => true, (iat + 10) * 1000);
  assert.equal(missing.status, 403);
  assert.equal(kvTouched, false);

  // Valid read_only ticket decrypts before expiry
  const decrypted = await handleRequest(jitReq('/v1/crypto/jit/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] }, readOnlyToken), jitEnv, async () => true, async () => true, (exp - 1) * 1000);
  assert.equal(decrypted.status, 200);
  assert.deepEqual((await decrypted.json()).items[0].payload, { first_name: 'Maya', borrower_id: 'B100' });

  // Expired at T and T+1s -> 403
  const atExpiry = await handleRequest(jitReq('/v1/crypto/jit/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] }, readOnlyToken), jitEnv, async () => true, async () => true, exp * 1000);
  assert.equal(atExpiry.status, 403);
  const afterExpiry = await handleRequest(jitReq('/v1/crypto/jit/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] }, readOnlyToken), jitEnv, async () => true, async () => true, (exp + 1) * 1000);
  assert.equal(afterExpiry.status, 403);

  // Scope enforcement: read_only ticket blocked on /v1/crypto/jit/encrypt
  const readOnlyEncrypt = await handleRequest(jitReq('/v1/crypto/jit/encrypt', { workspace_id: workspace, id, payload: { first_name: 'New' } }, readOnlyToken), jitEnv, async () => true, async () => true, (iat + 10) * 1000);
  assert.equal(readOnlyEncrypt.status, 403);

  // Revoked ticket (DB coordinator returns false) -> 403
  const revoked = await handleRequest(jitReq('/v1/crypto/jit/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] }, readOnlyToken), jitEnv, async () => true, async () => false, (iat + 10) * 1000);
  assert.equal(revoked.status, 403);

  // Wrong workspace -> 403
  const wrongWs = await handleRequest(jitReq('/v1/crypto/jit/decrypt', { workspace_id: crypto.randomUUID(), items: [{ id, ...encrypted }] }, readOnlyToken), jitEnv, async () => true, async () => true, (iat + 10) * 1000);
  assert.equal(wrongWs.status, 403);

  // Valid break_glass ticket encrypts
  const bgEncrypt = await handleRequest(jitReq('/v1/crypto/jit/encrypt', { workspace_id: workspace, id, payload: { first_name: 'Emergency', borrower_id: 'BG1' }, index_fields: { borrower_id: 'BG1' } }, breakGlassToken), jitEnv, async () => true, async () => true, (iat + 10) * 1000);
  assert.equal(bgEncrypt.status, 200);
});

test('isolated R2 KMS backup mirrors wrapped keys on provision and shreds them with tombstone on revoke (ITX-103)', async () => {
  const kv = new Map();
  const r2 = new Map();
  let state;
  const coordinator = async (action) => {
    if (action === 'claim_provision' && !state) { state = 'provisioning'; return true; }
    if (action === 'finish_provision' && state === 'provisioning') { state = 'active'; return true; }
    if (action === 'is_active') return state === 'active';
    if (action === 'claim_revoke' && state === 'active') { state = 'revoking'; return true; }
    if (action === 'is_revoking') return state === 'revoking';
    if (action === 'is_revoked') return state === 'revoked';
    if (action === 'finish_revoke' && state === 'revoking') { state = 'revoked'; return true; }
    return false;
  };
  const r2Binding = {
    head: async (k) => (r2.has(k) ? { key: k } : null),
    put: async (k, v) => { r2.set(k, v); },
    delete: async (k) => { r2.delete(k); },
  };
  const custom = {
    ...env,
    SGW_REQUIRE_KMS_BACKUP: 'true',
    KEYS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
    KMS_BACKUPS: r2Binding,
  };

  // Provision writes wrapped key to both KV and isolated R2 bucket
  const prov = await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator, undefined, 1_700_000_000_000);
  assert.equal(prov.status, 200);
  assert.equal(state, 'active');
  const backupKey = `kms/v1/${workspace}.json`;
  const tombstoneKey = `kms/revoked/${workspace}.json`;
  assert.equal(r2.get(backupKey), kv.get(workspace));
  assert.equal(r2.has(tombstoneKey), false);
  // Confirm wrapped key backup never exposes MASTER_KEK
  assert.equal(r2.get(backupKey).includes(env.MASTER_KEK), false);

  // Encrypt works while active
  const encRes = await handleRequest(request('/v1/crypto/encrypt', { workspace_id: workspace, id, payload: { name: 'Student A' } }, env.KMS_INTERNAL_SECRET), custom, coordinator);
  assert.equal(encRes.status, 200);
  const encrypted = await encRes.json();

  // Revoke shreds key from BOTH KV and isolated R2 backup and writes tombstone
  const rev = await handleRequest(request('/v1/kms/revoke-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator, undefined, 1_700_000_060_000);
  assert.equal(rev.status, 200);
  assert.equal(state, 'revoked');
  assert.equal(kv.has(workspace), false);
  assert.equal(r2.has(backupKey), false);
  assert.equal(r2.has(tombstoneKey), true);
  assert.equal(JSON.parse(r2.get(tombstoneKey)).status, 'revoked');

  // Decryption fails closed after shredding
  const decRes = await handleRequest(request('/v1/crypto/decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] }, env.KMS_INTERNAL_SECRET), custom, coordinator);
  assert.equal(decRes.status, 404);

  // Even if DB lifecycle state were rolled back from an old snapshot, tombstone blocks reprovisioning
  state = undefined;
  const reprov = await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator);
  assert.equal(reprov.status, 409);
  assert.equal(kv.has(workspace), false);
  assert.equal(r2.has(backupKey), false);
});

test('SGW_REQUIRE_KMS_BACKUP=true fails closed when KMS_BACKUPS binding is missing', async () => {
  const custom = { ...env, SGW_REQUIRE_KMS_BACKUP: 'true', KEYS: { get: async () => null, put: async () => {}, delete: async () => {} } };
  const prov = await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, async () => true);
  assert.equal(prov.status, 503);
  const rev = await handleRequest(request('/v1/kms/revoke-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, async () => true);
  assert.equal(rev.status, 503);
});

test('failed R2 backup write during provisioning leaves workspace in provisioning state', async () => {
  let state;
  const kv = new Map();
  const coordinator = async (action) => {
    if (action === 'claim_provision' && !state) { state = 'provisioning'; return true; }
    if (action === 'finish_provision' && state === 'provisioning') { state = 'active'; return true; }
    return false;
  };
  const custom = {
    ...env,
    SGW_REQUIRE_KMS_BACKUP: 'true',
    KEYS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } },
    KMS_BACKUPS: { head: async () => null, put: async () => { throw new Error('r2 down'); } },
  };
  const prov = await handleRequest(request('/v1/kms/generate-tenant-keys', { workspace_id: workspace }, env.KMS_LIFECYCLE_SECRET), custom, coordinator);
  assert.equal(prov.status, 503);
  assert.equal(state, 'provisioning');
});
