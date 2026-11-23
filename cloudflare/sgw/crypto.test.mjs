import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorkspaceKeys, encryptPayload, decryptPayload, blindIndexes, unwrapWorkspaceKeys } from './crypto.mjs';

const workspace = 'd8b57c2b-c473-451e-9d0b-a0989ac8a8a4';
const record = 'e535bd49-df6a-4c94-8e77-f9497ab83e43';
const kek = crypto.getRandomValues(new Uint8Array(32));

test('wrapped workspace keys encrypt and authenticate payloads and their context', async () => {
  const wrapped = await generateWorkspaceKeys(kek, workspace);
  assert.equal(JSON.stringify(wrapped).includes('Alice'), false);
  const keys = await unwrapWorkspaceKeys(kek, workspace, wrapped);
  const encrypted = await encryptPayload(keys.dek, workspace, record, { name: 'Alice' });
  assert.deepEqual(await decryptPayload(keys.dek, workspace, record, encrypted), { name: 'Alice' });
  await assert.rejects(decryptPayload(keys.dek, workspace, crypto.randomUUID(), encrypted));
  await assert.rejects(unwrapWorkspaceKeys(kek, crypto.randomUUID(), wrapped));
  await assert.rejects(unwrapWorkspaceKeys(crypto.getRandomValues(new Uint8Array(32)), workspace, wrapped));
  const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0));
  ciphertext[0] ^= 1;
  await assert.rejects(decryptPayload(keys.dek, workspace, record, { ...encrypted, ciphertext: btoa(String.fromCharCode(...ciphertext)) }));
});

test('blind indexes normalize consistently, separate domains and workspaces', async () => {
  const keys = await unwrapWorkspaceKeys(kek, workspace, await generateWorkspaceKeys(kek, workspace));
  const a = await blindIndexes(keys.pepper, { borrower_id: ' ABC ', email: ' ABC ' });
  const b = await blindIndexes(keys.pepper, { borrower_id: 'abc', email: 'abc' });
  assert.deepEqual(a, b);
  assert.notEqual(a.borrower_id_hash, a.borrower_email_hash);
  const other = await unwrapWorkspaceKeys(kek, workspace, await generateWorkspaceKeys(kek, workspace));
  assert.notEqual(a.borrower_id_hash, (await blindIndexes(other.pepper, { borrower_id: 'abc' })).borrower_id_hash);
});

test('payload AAD prevents moving ciphertext to another workspace or borrower', async () => {
  const keys = await unwrapWorkspaceKeys(kek, workspace, await generateWorkspaceKeys(kek, workspace));
  const encrypted = await encryptPayload(keys.dek, workspace, record, { borrower_id: '123' });
  await assert.rejects(decryptPayload(keys.dek, crypto.randomUUID(), record, encrypted));
  await assert.rejects(decryptPayload(keys.dek, workspace, crypto.randomUUID(), encrypted));
});

test('different workspace peppers produce unrelated email blind indexes', async () => {
  const first = await unwrapWorkspaceKeys(kek, workspace, await generateWorkspaceKeys(kek, workspace));
  const otherWorkspace = crypto.randomUUID();
  const second = await unwrapWorkspaceKeys(kek, otherWorkspace, await generateWorkspaceKeys(kek, otherWorkspace));
  const left = await blindIndexes(first.pepper, { email: 'test@example.com' });
  const right = await blindIndexes(second.pepper, { email: 'test@example.com' });
  assert.notEqual(left.borrower_email_hash, right.borrower_email_hash);
});
