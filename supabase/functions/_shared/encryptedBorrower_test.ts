import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { hashBorrowerId, decryptBorrower } from './encryptedBorrower.ts';
Deno.test('encrypted checkout uses the caller workspace for hash and decrypt', async () => {
  const gateway = async (op: string, body: Record<string, unknown>) => {
    assertEquals(body.workspace_id, 'workspace-a');
    if (op === 'hash-index') return { borrower_id_hash: 'a'.repeat(64) };
    return { items: [{ id: 'record-a', payload: { username: 'Alice', borrower_id: 'AB' } }] };
  };
  assertEquals(await hashBorrowerId('workspace-a', 'AB', 's'.repeat(32), gateway), 'a'.repeat(64));
  assertEquals(await decryptBorrower('workspace-a', { id: 'record-a', encrypted_data: 'cipher', nonce: 'nonce', auth_tag: 'tag', key_version: 1 }, 's'.repeat(32), gateway), { username: 'Alice', borrower_id: 'AB' });
});
Deno.test('encrypted checkout fails closed for gateway errors and mismatched records', async () => {
  await assertRejects(() => hashBorrowerId('workspace-a', 'AB', 's'.repeat(32), async () => { throw new Error('down'); }));
  await assertRejects(() => decryptBorrower('workspace-a', { id: 'record-a', encrypted_data: 'cipher', nonce: 'nonce', auth_tag: 'tag', key_version: 1 }, 's'.repeat(32), async () => ({ items: [{ id: 'other', payload: {} }] })));
});
Deno.test('checkout displays encrypted first and optional last name', async () => {
  const row = { id: 'record-a', encrypted_data: 'cipher', nonce: 'nonce', auth_tag: 'tag', key_version: 1 };
  const gateway = async () => ({ items: [{ id: 'record-a', payload: { first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'AB' } }] });
  assertEquals(await decryptBorrower('workspace-a', row, 's'.repeat(32), gateway), { username: 'Ada Lovelace', borrower_id: 'AB' });
});
