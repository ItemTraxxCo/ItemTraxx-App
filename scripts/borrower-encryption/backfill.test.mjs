import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillWorkspace } from './backfill.mjs';

const ws = 'd8b57c2b-c473-451e-9d0b-a0989ac8a8a4';
const id = 'e535bd49-df6a-4c94-8e77-f9497ab83e43';
function fixture() {
  const row = { id, workspace_id: ws, username: 'Alice', borrower_id: ' 123 ', encrypted_data: null };
  let writes = 0; let decrypts = 0; let sleeps = 0;
  const store = {
    requireFreeze: async () => 'epoch-1',
    listPreflightPage: async (_ws, cursor) => cursor ? [] : [{ ...row }],
    list: async () => row.encrypted_data ? [] : [{ ...row }],
    save: async (_row, envelope) => { if (row.encrypted_data) return false; Object.assign(row, envelope); writes++; return true; },
    read: async () => ({ ...row }),
    findHash: async () => [],
    listVerifiedPage: async (_ws, cursor) => row.encrypted_data && !cursor ? [{ ...row }] : [],
  };
  const gateway = {
    hash: async () => 'a'.repeat(64),
    encrypt: async (_ws, _id, payload) => ({ ciphertext: JSON.stringify(payload), nonce: 'n', auth_tag: 't', borrower_id_hash: 'a'.repeat(64) }),
    decrypt: async (_ws, _id, envelope) => { decrypts++; return JSON.parse(envelope.ciphertext); },
  };
  return { row, store, gateway, sleep: async () => { sleeps++; }, counts: () => ({ writes, decrypts, sleeps }) };
}
test('backfill refuses to read or write when the database freeze is absent', async () => {
  const f = fixture();
  f.store.requireFreeze = async () => { throw new Error('Freeze required'); };
  f.store.list = async () => { throw new Error('Unexpected database read'); };
  await assert.rejects(backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }), /Freeze required/);
  assert.equal(f.counts().writes, 0);
});
test('backfill detects a freeze that was removed and reactivated', async () => {
  const f = fixture();
  let calls = 0;
  f.store.requireFreeze = async () => ++calls === 1 ? 'epoch-1' : 'epoch-2';
  await assert.rejects(backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }), /freeze.*changed/i);
  assert.equal(f.counts().writes, 0);
});
test('backfill detects normalized borrower ID collisions before any write', async () => {
  const f = fixture();
  f.store.listPreflightPage = async (_workspace, cursor) => cursor ? [] : [
    { ...f.row, borrower_id: 'ABC' },
    { ...f.row, id: 'f535bd49-df6a-4c94-8e77-f9497ab83e43', borrower_id: ' abc ' },
  ];
  f.gateway.hash = async (_workspace, value) => value.trim().toLowerCase() === 'abc' ? 'a'.repeat(64) : 'b'.repeat(64);
  await assert.rejects(backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }), /collision/);
  assert.equal(f.counts().writes, 0);
});
test('backfill rejects malformed and out-of-order preflight pages before writing', async () => {
  for (const mode of ['missing-id', 'wrong-workspace', 'out-of-order', 'oversize', 'gateway-down', 'invalid-hash']) {
    const f = fixture();
    if (mode === 'missing-id') f.store.listPreflightPage = async () => [{ ...f.row, borrower_id: ' ' }];
    if (mode === 'wrong-workspace') f.store.listPreflightPage = async () => [{ ...f.row, workspace_id: 'other' }];
    if (mode === 'out-of-order') f.store.listPreflightPage = async () => [{ ...f.row }, { ...f.row, id: 'a' }];
    if (mode === 'oversize') f.store.listPreflightPage = async () => Array(51).fill(f.row);
    if (mode === 'gateway-down') f.gateway.hash = async () => { throw new Error('Gateway unavailable'); };
    if (mode === 'invalid-hash') f.gateway.hash = async () => 'invalid';
    await assert.rejects(backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }));
    assert.equal(f.counts().writes, 0);
  }
});
test('backfill stops when the database freeze is removed before verification', async () => {
  const f = fixture();
  let calls = 0;
  f.store.requireFreeze = async () => { if (++calls > 4) throw new Error('Freeze required'); return 'epoch-1'; };
  await assert.rejects(backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }), /Freeze required/);
  assert.equal(f.counts().writes, 1);
});
test('backfill verifies ciphertext before and after conditional write and resumes without rewriting', async () => {
  const f = fixture();
  assert.deepEqual(await backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }), { migrated: 1 });
  assert.deepEqual(f.counts(), { writes: 1, decrypts: 3, sleeps: 3 });
  assert.deepEqual(await backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }), { migrated: 0 });
  assert.equal(f.counts().writes, 1);
});
test('backfill fails closed on mismatched decryption, hash collision, and concurrent changes', async () => {
  for (const mode of ['decrypt', 'collision', 'race']) {
    const f = fixture();
    if (mode === 'decrypt') f.gateway.decrypt = async () => ({ username: 'wrong' });
    if (mode === 'collision') f.store.findHash = async () => ['another-id'];
    if (mode === 'race') f.store.save = async () => false;
    await assert.rejects(backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }));
    assert.equal(f.counts().writes, 0);
  }
});

test('a resumed run re-verifies rows written before an interruption', async () => {
  const f = fixture();
  f.row.encrypted_data = JSON.stringify({ username: 'wrong' });
  f.row.nonce = 'n'; f.row.auth_tag = 't'; f.row.key_version = 1; f.row.borrower_id_hash = 'a'.repeat(64);
  f.store.listVerifiedPage = async (_ws, cursor) => cursor ? [] : [{ ...f.row }];
  await assert.rejects(backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }), /verification/);
});

test('full verification rejects an incorrect blind index', async () => {
  const f = fixture();
  f.gateway.hash = async () => 'b'.repeat(64);
  await assert.rejects(backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 }), /index verification/);
});

test('backfill encrypts and verifies through the actual local SGW crypto', async () => {
  const { generateWorkspaceKeys, unwrapWorkspaceKeys, encryptPayload, decryptPayload, blindIndexes } = await import('../../cloudflare/sgw/crypto.mjs');
  const key = crypto.getRandomValues(new Uint8Array(32));
  const keys = await unwrapWorkspaceKeys(key, ws, await generateWorkspaceKeys(key, ws));
  const f = fixture();
  f.gateway = {
    encrypt: async (workspace, record, payload) => ({ ...await encryptPayload(keys.dek, workspace, record, payload), ...await blindIndexes(keys.pepper, { borrower_id: payload.borrower_id }) }),
    decrypt: (workspace, record, encrypted) => decryptPayload(keys.dek, workspace, record, encrypted),
    hash: async (_workspace, borrowerId) => (await blindIndexes(keys.pepper, { borrower_id: borrowerId })).borrower_id_hash,
  };
  await backfillWorkspace({ workspaceId: ws, ...f, delayMs: 1 });
  assert.equal(f.row.encrypted_data.includes('Alice'), false);
  assert.equal(f.row.encrypted_data.includes('123'), false);
});
