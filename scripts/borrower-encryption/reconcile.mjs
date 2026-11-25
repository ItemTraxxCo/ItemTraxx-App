import { decryptPayload, unwrapWorkspaceKeys } from '../../cloudflare/sgw/crypto.mjs';

// Read-only: neither the database nor KV adapter exposes mutation methods.
// A cryptographic match does not prove a key was not revoked after the snapshot.
export async function reconcileWorkspace({ workspaceId, lifecycle, encryptedOnly, items, readKey, kek }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) throw new Error('Invalid workspace ID');
  if (!(kek instanceof Uint8Array) || kek.length !== 32 || !Array.isArray(items)) throw new Error('Invalid reconciliation input');
  let stored;
  try { stored = await readKey(workspaceId); } catch { return { workspace_id: workspaceId, state: 'unavailable', mismatch: 'kv_unreachable' }; }
  const result = (state, mismatch) => ({ workspace_id: workspaceId, state, mismatch });
  const requiresKey = encryptedOnly || items.length > 0 || lifecycle === 'active';
  if (stored === null) return requiresKey ? result('orphan', 'required_key_missing') : result('unresolved', 'no_key_and_history_unverified');
  if (typeof stored !== 'string') return result('unavailable', 'invalid_kv_response');
  if (lifecycle !== 'active') return result('orphan', `key_present_lifecycle_${lifecycle ?? 'missing'}`);
  let keys;
  try { keys = await unwrapWorkspaceKeys(kek, workspaceId, JSON.parse(stored)); }
  catch { return result('orphan', 'key_envelope_or_master_kek_mismatch'); }
  for (const item of items) {
    try {
      if (item.workspace_id !== workspaceId || item.key_version !== 1) throw new Error();
      await decryptPayload(keys.dek, workspaceId, item.id, { ciphertext: item.encrypted_data, nonce: item.nonce, auth_tag: item.auth_tag });
    } catch { return result('orphan', 'ciphertext_or_record_binding_mismatch'); }
  }
  return result('unresolved', items.length ? 'key_and_ciphertext_match_history_unverified' : 'key_matches_no_ciphertext_history_unverified');
}
