import { createClient } from '@supabase/supabase-js';
import { backfillWorkspace } from './backfill.mjs';
import { verifiedCutover } from './cutover.mjs';

// A service-only database freeze must already be active. Secrets are env-only.
const args = process.argv.slice(2);
const workspaceId = args[0];
const cutover = args.length === 5 && args[3] === '--cutover' && args[4] === '--readers-ready';
if ((!cutover && args.length !== 3) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId ?? '') || args[1] !== '--execute' || args[2] !== '--writers-paused') {
  console.error('Usage: node scripts/borrower-encryption/run-backfill.mjs WORKSPACE_UUID --execute --writers-paused [--cutover --readers-ready]');
  process.exit(2);
}
const url = process.env.ITX_SUPABASE_URL;
const serviceKey = process.env.ITX_SECRET_KEY;
const secret = process.env.ITX_SGW_INTERNAL_SECRET;
let cutoverAttempted = false;
try {
  if (!url || new URL(url).protocol !== 'https:' || !serviceKey || !secret || secret.length < 32) throw new Error('Missing configuration');
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const columns = 'id,workspace_id,username,borrower_id,encrypted_data,nonce,auth_tag,key_version,borrower_id_hash';
  const dataOrFail = ({ data, error }) => { if (error || !data) throw new Error('Database operation failed'); return data; };
  const store = {
    requireFreeze: async (workspace) => {
      const { data, error } = await db.rpc('borrower_write_freeze_epoch', { p_workspace_id: workspace });
      if (error || typeof data !== 'string' || !/^[0-9a-f-]{36}$/i.test(data)) throw new Error('Workspace writer freeze required');
      return data;
    },
    listPreflightPage: async (workspace, cursor, limit) => {
      let query = db.from('borrowers').select('id,workspace_id,borrower_id').eq('workspace_id', workspace).order('id').limit(limit);
      if (cursor) query = query.gt('id', cursor);
      return dataOrFail(await query);
    },
    list: async (workspace, limit) => dataOrFail(await db.from('borrowers').select(columns).eq('workspace_id', workspace).is('encrypted_data', null).order('id').limit(limit)),
    listVerifiedPage: async (workspace, cursor, limit) => {
      let query = db.from('borrowers').select(columns).eq('workspace_id', workspace).not('encrypted_data', 'is', null).order('id').limit(limit);
      if (cursor) query = query.gt('id', cursor);
      return dataOrFail(await query);
    },
    findHash: async (workspace, hash) => dataOrFail(await db.from('borrowers').select('id').eq('workspace_id', workspace).eq('borrower_id_hash', hash).limit(2)).map((row) => row.id),
    save: async (row, update, freezeEpoch) => {
      const { data, error } = await db.rpc('backfill_encrypted_borrower_v2', {
        p_workspace_id: row.workspace_id, p_id: row.id, p_expected_username: row.username,
        p_expected_borrower_id: row.borrower_id, p_ciphertext: update.encrypted_data,
        p_nonce: update.nonce, p_auth_tag: update.auth_tag, p_borrower_id_hash: update.borrower_id_hash,
        p_email_hash: null, p_freeze_epoch: freezeEpoch,
      });
      if (error || typeof data !== 'boolean') throw new Error('Database operation failed');
      return data;
    },
    read: async (workspace, id) => dataOrFail(await db.from('borrowers').select(columns).eq('workspace_id', workspace).eq('id', id)).at(0),
    commitCutover: async (workspace, epoch) => {
      cutoverAttempted = true;
      const { data, error } = await db.rpc('commit_borrower_encryption_cutover', { p_workspace_id: workspace, p_freeze_epoch: epoch });
      if (error || !data || typeof data.borrowers !== 'number') throw new Error('Cutover result unavailable');
      return data;
    },
  };
  const call = async (operation, body) => {
    const response = await fetch(`https://sgw.itemtraxx.com/v1/crypto/${operation}`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Gateway operation failed');
    return await response.json();
  };
  const gateway = {
    encrypt: (workspace, id, payload) => call('encrypt', { workspace_id: workspace, id, payload, index_fields: { borrower_id: payload.borrower_id } }),
    decrypt: async (workspace, id, envelope) => {
      const result = await call('decrypt', { workspace_id: workspace, items: [{ id, ...envelope }] });
      if (!Array.isArray(result.items) || result.items.length !== 1 || result.items[0].id !== id) throw new Error('Invalid gateway response');
      return result.items[0].payload;
    },
    hash: async (workspace, borrowerId) => (await call('hash-index', { workspace_id: workspace, values: { borrower_id: borrowerId } })).borrower_id_hash,
  };
  if (cutover) {
    const result = await verifiedCutover({ workspaceId: workspaceId.toLowerCase(), store, gateway });
    console.log(`Cutover completed for ${result.borrowers} borrowers. The workspace remains frozen.`);
  } else {
    const result = await backfillWorkspace({ workspaceId: workspaceId.toLowerCase(), store, gateway });
    console.log(`Backfill completed and verified: ${result.migrated} records migrated.`);
  }
} catch {
  console.error(cutoverAttempted ? 'Cutover outcome is uncertain. Keep the workspace frozen and inspect its encryption state before retrying.' : 'Backfill stopped. Inspect configuration and reconcile the workspace before retrying. No plaintext columns were removed.');
  process.exitCode = 1;
}
