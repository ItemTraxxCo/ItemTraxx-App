import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { generateWorkspaceKeys, unwrapWorkspaceKeys, encryptPayload } from '../../cloudflare/sgw/crypto.mjs';
import { reconcileWorkspace } from './reconcile.mjs';

test('read-only reconciliation detects missing and incorrect keys and validates AAD', async () => {
  const workspaceId = crypto.randomUUID(), id = crypto.randomUUID();
  const kek = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await generateWorkspaceKeys(kek, workspaceId);
  const { dek } = await unwrapWorkspaceKeys(kek, workspaceId, wrapped);
  const ciphertext = await encryptPayload(dek, workspaceId, id, { name: 'Synthetic' });
  const item = { workspace_id: workspaceId, id, key_version: 1, encrypted_data: ciphertext.ciphertext, nonce: ciphertext.nonce, auth_tag: ciphertext.auth_tag };
  const input = { workspaceId, lifecycle: 'active', encryptedOnly: true, items: [item], kek };
  assert.equal((await reconcileWorkspace({ ...input, readKey: async () => null })).mismatch, 'required_key_missing');
  assert.equal((await reconcileWorkspace({ ...input, readKey: async () => JSON.stringify(wrapped), kek: crypto.getRandomValues(new Uint8Array(32)) })).mismatch, 'key_envelope_or_master_kek_mismatch');
  assert.equal((await reconcileWorkspace({ ...input, items: [{ ...item, id: crypto.randomUUID() }], readKey: async () => JSON.stringify(wrapped) })).mismatch, 'ciphertext_or_record_binding_mismatch');
  assert.equal((await reconcileWorkspace({ ...input, readKey: async () => JSON.stringify(wrapped) })).mismatch, 'key_and_ciphertext_match_history_unverified');
  assert.equal((await reconcileWorkspace({ ...input, readKey: async () => { throw Error('offline'); } })).state, 'unavailable');
  assert.equal((await reconcileWorkspace({ ...input, lifecycle: 'revoked', readKey: async () => JSON.stringify(wrapped) })).mismatch, 'key_present_lifecycle_revoked');
  assert.equal((await reconcileWorkspace({ ...input, lifecycle: null, readKey: async () => JSON.stringify(wrapped) })).mismatch, 'key_present_lifecycle_missing');
  assert.equal((await reconcileWorkspace({ ...input, items: [{ ...item, workspace_id: crypto.randomUUID() }], readKey: async () => JSON.stringify(wrapped) })).mismatch, 'ciphertext_or_record_binding_mismatch');
  assert.equal((await reconcileWorkspace({ ...input, encryptedOnly: false, lifecycle: null, items: [], readKey: async () => null })).state, 'unresolved');
  assert.equal(item.encrypted_data, ciphertext.ciphertext);
});
