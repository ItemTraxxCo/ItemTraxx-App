import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { borrowerEncryptionEnabled, borrowerEncryptionModes } from './borrowerEncryptionMode.ts';

Deno.test('workspace encryption mode is resolved from the server, scoped to the workspace', async () => {
  const calls: unknown[] = [];
  const client = { rpc: (name: string, args: unknown) => { calls.push({ name, args }); return Promise.resolve({ data: true, error: null }); } };
  assertEquals(await borrowerEncryptionEnabled(client, 'workspace-1', false), true);
  assertEquals(calls, [{ name: 'borrower_workspace_encryption_enabled', args: { p_workspace_id: 'workspace-1' } }]);
});
Deno.test('missing or failed workspace state fails closed', async () => {
  for (const response of [{ data: null, error: null }, { data: false, error: { message: 'unavailable' } }]) {
    await assertRejects(() => borrowerEncryptionEnabled({ rpc: () => Promise.resolve(response) }, 'workspace-1', false));
  }
});
Deno.test('local preview can explicitly enable encrypted mode', async () => {
  assertEquals(await borrowerEncryptionEnabled({ rpc: () => { throw new Error('unexpected'); } }, 'workspace-1', true), true);
});
Deno.test('mixed workspace modes reject missing and duplicate state', async () => {
  const client = (data: unknown) => ({ rpc: () => Promise.resolve({ data, error: null }) });
  const modes = await borrowerEncryptionModes(client([{ workspace_id: 'a', encrypted_only: true }, { workspace_id: 'b', encrypted_only: false }]), ['a', 'b'], false);
  assertEquals([...modes], [['a', true], ['b', false]]);
  await assertRejects(() => borrowerEncryptionModes(client([{ workspace_id: 'a', encrypted_only: true }]), ['a', 'b'], false));
  await assertRejects(() => borrowerEncryptionModes(client([{ workspace_id: 'a', encrypted_only: true }, { workspace_id: 'a', encrypted_only: false }]), ['a', 'b'], false));
});
