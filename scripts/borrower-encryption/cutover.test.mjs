import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedCutover } from './cutover.mjs';

test('cutover follows full verification and retains the same freeze generation', async () => {
  const calls = [];
  const store = { requireFreeze: async () => { calls.push('freeze'); return 'generation'; }, commitCutover: async (_workspace, epoch) => { calls.push('cutover'); assert.equal(epoch, 'generation'); return { borrowers: 1 }; } };
  const result = await verifiedCutover({ workspaceId: 'workspace', store, gateway: {}, verifyBackfill: async () => { calls.push('verify'); return { migrated: 1 }; } });
  assert.deepEqual(calls, ['freeze', 'verify', 'freeze', 'cutover']);
  assert.equal(result.borrowers, 1);
});
test('verification failure or changed freeze prevents cutover', async () => {
  let calls = 0;
  const store = { requireFreeze: async () => ++calls === 1 ? 'old' : 'new', commitCutover: async () => { throw new Error('must not commit'); } };
  await assert.rejects(() => verifiedCutover({ workspaceId: 'workspace', store, gateway: {}, verifyBackfill: async () => ({ migrated: 0 }) }), /freeze changed/i);
  await assert.rejects(() => verifiedCutover({ workspaceId: 'workspace', store, gateway: {}, verifyBackfill: async () => { throw new Error('verification failed'); } }), /verification failed/i);
});
