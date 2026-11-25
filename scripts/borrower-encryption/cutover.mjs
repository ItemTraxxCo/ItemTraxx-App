import { backfillWorkspace } from './backfill.mjs';

// The caller must have deployed workspace-aware readers before invoking this.
// An ambiguous commit failure must be reconciled against database state.
export async function verifiedCutover({ workspaceId, store, gateway, verifyBackfill = backfillWorkspace }) {
  const epoch = await store.requireFreeze(workspaceId);
  if (typeof epoch !== 'string' || !epoch) throw new Error('Workspace writer freeze required');
  await verifyBackfill({ workspaceId, store, gateway });
  if (await store.requireFreeze(workspaceId) !== epoch) throw new Error('Workspace writer freeze changed');
  return await store.commitCutover(workspaceId, epoch);
}
