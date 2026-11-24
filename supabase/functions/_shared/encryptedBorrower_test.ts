import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { hashBorrowerId, decryptBorrower, decryptBorrowers } from './encryptedBorrower.ts';
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
Deno.test('offline borrower batches preserve record order and workspace', async () => {
  const rows = ['a', 'b'].map(id => ({ id, encrypted_data: 'cipher', nonce: 'nonce', auth_tag: 'tag', key_version: 1 }));
  const gateway = async (_op: string, body: Record<string, unknown>) => {
    assertEquals(body.workspace_id, 'workspace-a');
    assertEquals((body.items as { id: string }[]).map(item => item.id), ['a', 'b']);
    return { items: [{ id: 'a', payload: { first_name: 'Ada', last_name: 'Lovelace', borrower_id: '1' } }, { id: 'b', payload: { first_name: 'Free Name', borrower_id: '2' } }] };
  };
  assertEquals(await decryptBorrowers('workspace-a', rows, 's'.repeat(32), gateway), [{ username: 'Ada Lovelace', borrower_id: '1' }, { username: 'Free Name', borrower_id: '2' }]);
});
Deno.test('offline borrower batches fail closed on incomplete data, errors and mismatched results', async () => {
  const row = { id: 'a', encrypted_data: 'cipher', nonce: 'nonce', auth_tag: 'tag', key_version: 1 };
  await assertRejects(() => decryptBorrowers('workspace-a', [row, { ...row, id: 'b', nonce: null }], 'secret'));
  await assertRejects(() => decryptBorrowers('workspace-a', [row, row], 'secret'));
  await assertRejects(() => decryptBorrowers('workspace-a', [row], 'secret', async () => { throw new Error('unavailable'); }));
  await assertRejects(() => decryptBorrowers('workspace-a', [row], 'secret', async () => ({ items: [{ id: 'other', payload: { username: 'Name', borrower_id: '1' } }] })));
  await assertRejects(() => decryptBorrowers('workspace-a', [row], 'secret', async () => ({ items: [] })));
  assertEquals(await decryptBorrowers('workspace-a', [], 'secret', async () => { throw new Error('must not call gateway'); }), []);
});
