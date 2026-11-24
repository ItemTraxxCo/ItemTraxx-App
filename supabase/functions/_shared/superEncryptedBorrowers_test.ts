import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decryptSuperBorrowers } from './superEncryptedBorrowers.ts';

const row = (id: string, workspace_id: string) => ({ id, workspace_id, encrypted_data: 'cipher', nonce: 'nonce', auth_tag: 'tag', key_version: 1 });
Deno.test('super borrower decrypt groups by workspace and preserves identity', async () => {
  const calls: string[] = [];
  const gateway = async (_op: string, body: Record<string, unknown>) => {
    calls.push(String(body.workspace_id));
    return { items: (body.items as { id: string }[]).map(item => ({ id: item.id, payload: { first_name: item.id, borrower_id: 'ID' } })) };
  };
  const result = await decryptSuperBorrowers([row('a', 'w1'), row('b', 'w2')], 'secret', gateway);
  assertEquals(calls, ['w1', 'w2']);
  assertEquals(result.map(value => value.username), ['a', 'b']);
});
Deno.test('super borrower decrypt rejects mixed-up, missing, or unavailable ciphertext', async () => {
  const good = row('a', 'w1');
  await assertRejects(() => decryptSuperBorrowers([{ ...good, auth_tag: null }], 'secret'));
  await assertRejects(() => decryptSuperBorrowers([good], 'secret', async () => ({ items: [{ id: 'other', payload: { username: 'Name', borrower_id: 'ID' } }] })));
  await assertRejects(() => decryptSuperBorrowers([good], 'secret', async () => { throw new Error('down'); }));
});
Deno.test('super borrower batches use real workspace-isolated SGW encryption', async () => {
  const { generateWorkspaceKeys } = await import('../../../cloudflare/sgw/crypto.mjs');
  const { handleRequest } = await import('../../../cloudflare/sgw/worker.mjs');
  const kek = crypto.getRandomValues(new Uint8Array(32));
  const workspaces = [crypto.randomUUID(), crypto.randomUUID()];
  const keys = new Map<string, string>();
  for (const workspace of workspaces) keys.set(workspace, JSON.stringify(await generateWorkspaceKeys(kek, workspace)));
  const secret = 's'.repeat(64);
  const env = { MASTER_KEK: btoa(String.fromCharCode(...kek)), KMS_INTERNAL_SECRET: secret, KEYS: { get: async (id: string) => keys.get(id) ?? null } };
  const gateway = async (op: string, body: Record<string, unknown>) => {
    const response = await handleRequest(new Request(`https://sgw.example/v1/crypto/${op}`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, async () => true);
    if (!response.ok) throw new Error('Gateway unavailable');
    return await response.json();
  };
  const rows = await Promise.all(workspaces.map(async (workspace, index) => {
    const id = crypto.randomUUID();
    const encrypted = await gateway('encrypt', { workspace_id: workspace, id, payload: { first_name: `Person ${index}`, borrower_id: `ID${index}` } });
    return { id, workspace_id: workspace, encrypted_data: encrypted.ciphertext, nonce: encrypted.nonce, auth_tag: encrypted.auth_tag, key_version: 1 };
  }));
  assertEquals((await decryptSuperBorrowers(rows, secret, gateway)).map(value => value.username), ['Person 0', 'Person 1']);
  await assertRejects(() => decryptSuperBorrowers([{ ...rows[0], workspace_id: workspaces[1] }], secret, gateway));
});
