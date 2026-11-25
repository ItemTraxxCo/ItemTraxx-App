type ModeClient = {
  rpc: (name: 'borrower_workspace_encryption_enabled', args: { p_workspace_id: string }) => PromiseLike<{ data: unknown; error: unknown }>;
};
type ModesClient = {
  rpc: (name: 'borrower_workspace_encryption_modes', args: { p_workspace_ids: string[] }) => PromiseLike<{ data: unknown; error: unknown }>;
};

// A missing state is never interpreted as legacy mode. The override is only
// used by the existing local integration harness while cutover is developed.
export async function borrowerEncryptionEnabled(client: ModeClient, workspaceId: string, localPreview = false): Promise<boolean> {
  if (localPreview) return true;
  const { data, error } = await client.rpc('borrower_workspace_encryption_enabled', { p_workspace_id: workspaceId });
  if (error || typeof data !== 'boolean') throw new Error('Borrower encryption state unavailable');
  return data;
}

export async function borrowerEncryptionModes(client: ModesClient, workspaceIds: string[], localPreview = false): Promise<Map<string, boolean>> {
  const unique = [...new Set(workspaceIds)];
  if (unique.length > 500) throw new Error('Borrower encryption state unavailable');
  if (localPreview) return new Map(unique.map(id => [id, true]));
  if (!unique.length) return new Map();
  const { data, error } = await client.rpc('borrower_workspace_encryption_modes', { p_workspace_ids: unique });
  if (error || !Array.isArray(data) || data.length !== unique.length) throw new Error('Borrower encryption state unavailable');
  const result = new Map<string, boolean>();
  for (const row of data) {
    if (!row || typeof row.workspace_id !== 'string' || !unique.includes(row.workspace_id) || typeof row.encrypted_only !== 'boolean' || result.has(row.workspace_id)) throw new Error('Borrower encryption state unavailable');
    result.set(row.workspace_id, row.encrypted_only);
  }
  return result;
}
