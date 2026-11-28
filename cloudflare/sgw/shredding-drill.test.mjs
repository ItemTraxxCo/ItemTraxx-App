import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.mjs';

// End-to-end ITX-103 cryptographic shredding & isolated KMS backup drill:
//   1. Provision tenant keys -> mirrored to isolated KMS_BACKUPS R2 bucket
//   2. Encrypt borrower record -> snapshot ciphertext into a simulated DB backup
//   3. Prove restoring DB backup WITHOUT KMS backup yields zero plaintext (404)
//   4. Prove restoring KMS backup from R2 into empty KV recovers plaintext (200)
//   5. Shred tenant key via /v1/kms/revoke-tenant-keys -> deleted from KV AND R2 + tombstone written
//   6. Prove shredding blocks decryption of BOTH live rows and historical DB backups (404)
//   7. Prove stale DB snapshot restore cannot resurrect or reprovision a shredded tenant (409)
test('ITX-103 drill: isolated KMS backup, DB restore without KMS, DR recovery, and permanent cryptographic shredding', async () => {
  const workspaceId = 'c3a7e1f2-84b9-4e11-9c2a-7f1234567890';
  const borrowerId = '9f10b2c4-5d6e-4a7b-8c9d-0e1f2a3b4c5d';
  const masterKekBytes = crypto.getRandomValues(new Uint8Array(32));
  const masterKek = btoa(String.fromCharCode(...masterKekBytes));

  const kv = new Map();
  const r2 = new Map();
  const dbLifecycle = new Map();

  const coordinator = async (action, ws) => {
    const state = dbLifecycle.get(ws);
    if (action === 'claim_provision') {
      if (state !== undefined) return false;
      dbLifecycle.set(ws, 'provisioning');
      return true;
    }
    if (action === 'finish_provision' && state === 'provisioning') { dbLifecycle.set(ws, 'active'); return true; }
    if (action === 'is_active') return state === 'active';
    if (action === 'claim_revoke' && state === 'active') { dbLifecycle.set(ws, 'revoking'); return true; }
    if (action === 'is_revoking') return state === 'revoking';
    if (action === 'is_revoked') return state === 'revoked';
    if (action === 'finish_revoke' && state === 'revoking') { dbLifecycle.set(ws, 'revoked'); return true; }
    return false;
  };

  const env = {
    MASTER_KEK: masterKek,
    KMS_INTERNAL_SECRET: 'i'.repeat(64),
    KMS_LIFECYCLE_SECRET: 'l'.repeat(64),
    SGW_PROVISIONING_ENABLED: 'true',
    SGW_REQUIRE_KMS_BACKUP: 'true',
    KEYS: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
    },
    KMS_BACKUPS: {
      head: async (k) => (r2.has(k) ? { key: k } : null),
      get: async (k) => (r2.has(k) ? { text: async () => r2.get(k) } : null),
      put: async (k, v) => { r2.set(k, v); },
      delete: async (k) => { r2.delete(k); },
    },
  };

  const post = (path, body, secret) =>
    handleRequest(
      new Request(`https://sgw.itemtraxx.com${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      coordinator,
      undefined,
      1_795_800_000_000,
    );

  // 1. Provision tenant keys
  const prov = await post('/v1/kms/generate-tenant-keys', { workspace_id: workspaceId }, env.KMS_LIFECYCLE_SECRET);
  assert.equal(prov.status, 200);
  const backupKey = `kms/v1/${workspaceId}.json`;
  const tombstoneKey = `kms/revoked/${workspaceId}.json`;
  assert.equal(kv.has(workspaceId), true);
  assert.equal(r2.has(backupKey), true);
  assert.equal(r2.get(backupKey), kv.get(workspaceId));

  // 2. Encrypt borrower PII and capture a simulated DB dump snapshot (ciphertext only)
  const enc = await post(
    '/v1/crypto/encrypt',
    { workspace_id: workspaceId, id: borrowerId, payload: { display_name: 'Jordan Rivera', borrower_id: 'STU-9001' } },
    env.KMS_INTERNAL_SECRET,
  );
  assert.equal(enc.status, 200);
  const dbBackupRow = await enc.json();
  const dbDumpText = JSON.stringify({ borrowers: [{ id: borrowerId, workspace_id: workspaceId, ...dbBackupRow }], lifecycle: Object.fromEntries(dbLifecycle) });
  assert.equal(dbDumpText.includes('Jordan Rivera'), false);
  assert.equal(dbDumpText.includes('STU-9001'), false);
  assert.equal(dbDumpText.includes(masterKek), false);
  assert.equal(dbDumpText.includes(r2.get(backupKey)), false);

  // 3. Simulate DB restore WITHOUT KMS backup (empty KV) -> yields zero plaintext
  kv.clear();
  const withoutKms = await post(
    '/v1/crypto/decrypt',
    { workspace_id: workspaceId, items: [{ id: borrowerId, ...dbBackupRow }] },
    env.KMS_INTERNAL_SECRET,
  );
  assert.equal(withoutKms.status, 404);

  // 4. Simulate DR recovery: restore wrapped key from isolated KMS_BACKUPS R2 into KV -> decrypt succeeds
  kv.set(workspaceId, r2.get(backupKey));
  const withKms = await post(
    '/v1/crypto/decrypt',
    { workspace_id: workspaceId, items: [{ id: borrowerId, ...dbBackupRow }] },
    env.KMS_INTERNAL_SECRET,
  );
  assert.equal(withKms.status, 200);
  assert.deepEqual((await withKms.json()).items[0].payload, { display_name: 'Jordan Rivera', borrower_id: 'STU-9001' });

  // 5. Cryptographic shredding: revoke tenant key -> destroyed in BOTH KV and isolated R2 backup + tombstone written
  const rev = await post('/v1/kms/revoke-tenant-keys', { workspace_id: workspaceId }, env.KMS_LIFECYCLE_SECRET);
  assert.equal(rev.status, 200);
  assert.equal(kv.has(workspaceId), false);
  assert.equal(r2.has(backupKey), false);
  assert.equal(r2.has(tombstoneKey), true);
  assert.equal(JSON.parse(r2.get(tombstoneKey)).status, 'revoked');

  // 6. Attempt decrypting the historical DB backup row after shredding -> permanently blocked (404)
  const afterShred = await post(
    '/v1/crypto/decrypt',
    { workspace_id: workspaceId, items: [{ id: borrowerId, ...dbBackupRow }] },
    env.KMS_INTERNAL_SECRET,
  );
  assert.equal(afterShred.status, 404);

  // 7. Simulate restoring a stale pre-revocation DB snapshot (lifecycle rolled back to active or empty)
  dbLifecycle.set(workspaceId, 'active');
  const afterStaleDbRestore = await post(
    '/v1/crypto/decrypt',
    { workspace_id: workspaceId, items: [{ id: borrowerId, ...dbBackupRow }] },
    env.KMS_INTERNAL_SECRET,
  );
  assert.equal(afterStaleDbRestore.status, 404);
  assert.equal(r2.has(backupKey), false);

  dbLifecycle.delete(workspaceId);
  const reprovBlocked = await post('/v1/kms/generate-tenant-keys', { workspace_id: workspaceId }, env.KMS_LIFECYCLE_SECRET);
  assert.equal(reprovBlocked.status, 409);
  assert.equal(kv.has(workspaceId), false);
  assert.equal(r2.has(backupKey), false);
});
