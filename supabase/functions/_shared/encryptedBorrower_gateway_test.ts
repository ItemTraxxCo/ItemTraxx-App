import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decryptBorrowers } from './encryptedBorrower.ts';
import { generateWorkspaceKeys } from '../../../cloudflare/sgw/crypto.mjs';
import { handleRequest } from '../../../cloudflare/sgw/worker.mjs';

Deno.test('offline batch decrypt uses real SGW cryptography and enforces record and workspace AAD', async () => {
  const workspace = crypto.randomUUID();
  const otherWorkspace = crypto.randomUUID();
  const kek = crypto.getRandomValues(new Uint8Array(32));
  const keys = new Map<string, string>([
    [workspace, JSON.stringify(await generateWorkspaceKeys(kek, workspace))],
    [otherWorkspace, JSON.stringify(await generateWorkspaceKeys(kek, otherWorkspace))],
  ]);
  const secret = 's'.repeat(64);
  const env = { MASTER_KEK: btoa(String.fromCharCode(...kek)), KMS_INTERNAL_SECRET: secret, KEYS: { get: async (key: string) => keys.get(key) ?? null } };
  const gateway = async (operation: string, body: Record<string, unknown>) => {
    const request = new Request(`https://sgw.example.test/v1/crypto/${operation}`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const response = await handleRequest(request, env, async () => true);
    if (!response.ok) throw new Error('Gateway unavailable');
    return await response.json();
  };
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const payloads = [{ first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'A-1' }, { first_name: 'Free Input', last_name: null, borrower_id: 'B-2' }];
  const rows = await Promise.all(ids.map(async (id, index) => {
    const encrypted = await gateway('encrypt', { workspace_id: workspace, id, payload: payloads[index], index_fields: { borrower_id: payloads[index].borrower_id } });
    return { id, encrypted_data: encrypted.ciphertext, nonce: encrypted.nonce, auth_tag: encrypted.auth_tag, key_version: 1 };
  }));
  assertEquals(await decryptBorrowers(workspace, rows, secret, gateway), [{ username: 'Ada Lovelace', borrower_id: 'A-1' }, { username: 'Free Input', borrower_id: 'B-2' }]);
  await assertRejects(() => decryptBorrowers(otherWorkspace, rows, secret, gateway));
  await assertRejects(() => decryptBorrowers(workspace, [{ ...rows[0], id: crypto.randomUUID() }], secret, gateway));
  keys.delete(workspace);
  await assertRejects(() => decryptBorrowers(workspace, rows, secret, gateway));
});
