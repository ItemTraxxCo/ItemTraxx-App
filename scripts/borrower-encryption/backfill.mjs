// This engine never deletes legacy columns or falls back when encryption fails.
export async function backfillWorkspace({ workspaceId, store, gateway, delayMs = 250, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!workspaceId || !Number.isFinite(delayMs) || delayMs < 1) throw new Error('Invalid backfill configuration');
  let migrated = 0;
  while (true) {
    await store.requireFreeze(workspaceId);
    const rows = await store.list(workspaceId, 50);
    if (!Array.isArray(rows) || rows.length > 50) throw new Error('Invalid backfill page');
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.workspace_id !== workspaceId || !row.id || typeof row.username !== 'string' || typeof row.borrower_id !== 'string' || !row.borrower_id.trim() || row.encrypted_data != null) throw new Error('Invalid or changed borrower row');
      const payload = { username: row.username, display_name: row.username, borrower_id: row.borrower_id };
      const encrypted = await gateway.encrypt(workspaceId, row.id, payload);
      if (!encrypted || !['ciphertext', 'nonce', 'auth_tag', 'borrower_id_hash'].every((key) => typeof encrypted[key] === 'string' && encrypted[key])) throw new Error('Invalid gateway response');
      const decoded = await gateway.decrypt(workspaceId, row.id, encrypted);
      if (JSON.stringify(decoded) !== JSON.stringify(payload)) throw new Error('Ciphertext verification failed');
      const matches = await store.findHash(workspaceId, encrypted.borrower_id_hash);
      if (!Array.isArray(matches) || matches.some((otherId) => otherId !== row.id)) throw new Error('Borrower index collision');
      const update = { encrypted_data: encrypted.ciphertext, nonce: encrypted.nonce, auth_tag: encrypted.auth_tag, key_version: 1, borrower_id_hash: encrypted.borrower_id_hash };
      if (!await store.save(row, update)) throw new Error('Borrower changed during backfill');
      const stored = await store.read(workspaceId, row.id);
      if (!stored || Object.entries(update).some(([key, value]) => stored[key] !== value)) throw new Error('Stored ciphertext verification failed');
      const check = await gateway.decrypt(workspaceId, row.id, { ciphertext: stored.encrypted_data, nonce: stored.nonce, auth_tag: stored.auth_tag });
      if (JSON.stringify(check) !== JSON.stringify(payload)) throw new Error('Stored plaintext verification failed');
      migrated++;
      await sleep(delayMs);
    }
  }
  let cursor = '';
  for (;;) {
    await store.requireFreeze(workspaceId);
    const rows = await store.listVerifiedPage(workspaceId, cursor, 50);
    if (!Array.isArray(rows) || rows.length > 50) throw new Error('Invalid verification page');
    if (!rows.length) break;
    for (const row of rows) {
      if (row.workspace_id !== workspaceId || !row.id || (cursor && row.id <= cursor) || !row.encrypted_data || !row.nonce || !row.auth_tag || row.key_version !== 1 || !row.borrower_id_hash) throw new Error('Invalid verification row');
      const expected = { username: row.username, display_name: row.username, borrower_id: row.borrower_id };
      const decrypted = await gateway.decrypt(workspaceId, row.id, { ciphertext: row.encrypted_data, nonce: row.nonce, auth_tag: row.auth_tag });
      if (JSON.stringify(decrypted) !== JSON.stringify(expected)) throw new Error('Full verification failed');
      if (await gateway.hash(workspaceId, row.borrower_id) !== row.borrower_id_hash) throw new Error('Blind index verification failed');
      const matches = await store.findHash(workspaceId, row.borrower_id_hash);
      if (!Array.isArray(matches) || matches.some((otherId) => otherId !== row.id)) throw new Error('Borrower index collision');
      cursor = row.id;
      await sleep(delayMs);
    }
  }
  await store.requireFreeze(workspaceId);
  return { migrated };
}
