import { decryptBorrowers } from './encryptedBorrower.ts';
import { callGateway, callJitGateway } from '../crypto-broker/gateway.ts';

type Row = { id: string; workspace_id: string; encrypted_data: string | null; nonce: string | null; auth_tag: string | null; key_version: number | null };
type Gateway = (op: 'hash-index' | 'decrypt', body: Record<string, unknown>, secret: string) => Promise<Record<string, unknown>>;
type JitGateway = (op: 'encrypt' | 'decrypt', body: Record<string, unknown>, secret: string, jitToken: string) => Promise<Record<string, unknown>>;
type Legacy = { id: string; workspace_id: string; username: string | null; borrower_id: string | null };

// Read old identity columns only when a workspace still requires them.
export async function loadLegacyBorrowerFields<T extends Row>(rows: T[], modes: Map<string, boolean>, load: (ids: string[]) => Promise<Legacy[]>) {
  if (rows.some(row => !modes.has(row.workspace_id))) throw new Error('Borrower data unavailable');
  const legacy = rows.filter(row => !modes.get(row.workspace_id));
  const values = legacy.length ? await load(legacy.map(row => row.id)) : [];
  const byId = new Map(values.map(row => [row.id, row]));
  if (byId.size !== legacy.length || legacy.some(row => byId.get(row.id)?.workspace_id !== row.workspace_id)) throw new Error('Borrower data unavailable');
  return rows.map(row => ({ ...row, username: byId.get(row.id)?.username ?? null, borrower_id: byId.get(row.id)?.borrower_id ?? null }));
}

// Call only after super-admin authorization. Never mix workspace keys or return
// a partial result if any workspace or record fails authentication.
export async function decryptSuperBorrowers(rows: Row[], secret: string, gateway: Gateway = callGateway) {
  if (rows.length > 500 || rows.some(row => !row.workspace_id || !row.id) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Borrower data unavailable');
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(row.workspace_id, [...(groups.get(row.workspace_id) ?? []), row]);
  const decrypted = new Map<string, { username: string; borrower_id: string }>();
  for (const [workspace, group] of groups) {
    for (let offset = 0; offset < group.length; offset += 100) {
      const batch = group.slice(offset, offset + 100);
      const payloads = await decryptBorrowers(workspace, batch, secret, gateway);
      batch.forEach((item, index) => decrypted.set(item.id, payloads[index]));
    }
  }
  return rows.map(row => ({ id: row.id, workspace_id: row.workspace_id, ...decrypted.get(row.id)! }));
}

// The mode is authoritative per workspace: missing state or malformed data
// fails the entire response, and encrypted records never fall back to columns.
export async function resolveMixedSuperBorrowers(rows: Array<Row & { username: string | null; borrower_id: string | null }>, modes: Map<string, boolean>, secret: string, gateway: Gateway = callGateway) {
  if (rows.length > 500 || rows.some(row => !modes.has(row.workspace_id))) throw new Error('Borrower data unavailable');
  const encrypted = rows.filter(row => modes.get(row.workspace_id));
  const decrypted = new Map((await decryptSuperBorrowers(encrypted, secret, gateway)).map(row => [row.id, row]));
  return rows.map(row => {
    if (modes.get(row.workspace_id)) {
      const result = decrypted.get(row.id);
      if (!result) throw new Error('Borrower data unavailable');
      return result;
    }
    if (typeof row.username !== 'string' || typeof row.borrower_id !== 'string') throw new Error('Borrower data unavailable');
    return { id: row.id, workspace_id: row.workspace_id, username: row.username, borrower_id: row.borrower_id };
  });
}

// Single-workspace super-admin decryption bound to an active signed JIT ticket.
export async function decryptSuperBorrowersWithJit(
  workspaceId: string,
  rows: Row[],
  jitSecret: string,
  jitToken: string,
  gateway: JitGateway = callJitGateway,
) {
  if (!workspaceId || !jitToken.trim() || rows.length > 500 || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('Borrower data unavailable');
  }
  const normalizedWs = workspaceId.toLowerCase();
  if (rows.some(row => !row.id || row.workspace_id.toLowerCase() !== normalizedWs)) {
    throw new Error('Cross-workspace borrower decryption is not permitted');
  }
  const boundGateway: Gateway = (op, body, secret) => {
    if (op !== 'decrypt') throw new Error('Unsupported JIT gateway operation');
    return gateway('decrypt', body, secret, jitToken);
  };
  const decrypted = new Map<string, { username: string; borrower_id: string }>();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const payloads = await decryptBorrowers(normalizedWs, batch, jitSecret, boundGateway);
    batch.forEach((item, index) => decrypted.set(item.id, payloads[index]));
  }
  return rows.map(row => ({ id: row.id, workspace_id: row.workspace_id, ...decrypted.get(row.id)! }));
}
