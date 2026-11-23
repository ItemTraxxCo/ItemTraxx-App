import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from './worker.mjs';
import { generateWorkspaceKeys } from './crypto.mjs';

const workspace = 'd8b57c2b-c473-451e-9d0b-a0989ac8a8a4';
const id = 'e535bd49-df6a-4c94-8e77-f9497ab83e43';
const key = crypto.getRandomValues(new Uint8Array(32));
const store = new Map();
const env = { MASTER_KEK: btoa(String.fromCharCode(...key)), KMS_INTERNAL_SECRET: 'a'.repeat(64), KMS_LIFECYCLE_SECRET: 'b'.repeat(64), KEYS: { get: async (k) => store.get(k) ?? null } };
const request = (path, body, secret = env.KMS_INTERNAL_SECRET) => new Request(`https://sgw.itemtraxx.com${path}`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const call = (path, body, secret) => handleRequest(request(path, body, secret), env, async () => true);

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
