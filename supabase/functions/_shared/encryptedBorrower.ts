import { callGateway } from '../crypto-broker/gateway.ts';
type Gateway = (op: 'hash-index' | 'decrypt', body: Record<string, unknown>, secret: string) => Promise<Record<string, unknown>>;
type EncryptedRow = { id: string; encrypted_data: string | null; nonce: string | null; auth_tag: string | null; key_version: number | null };
export async function hashBorrowerId(workspaceId: string, borrowerId: string, secret: string, gateway: Gateway = callGateway) {
  const result = await gateway('hash-index', { workspace_id: workspaceId, values: { borrower_id: borrowerId } }, secret);
  if (typeof result.borrower_id_hash !== 'string' || !/^[a-f0-9]{64}$/.test(result.borrower_id_hash)) throw new Error('Encrypted borrower lookup unavailable');
  return result.borrower_id_hash;
}
export async function decryptBorrower(workspaceId: string, row: EncryptedRow, secret: string, gateway: Gateway = callGateway) {
  return (await decryptBorrowers(workspaceId, [row], secret, gateway))[0];
}
export async function decryptBorrowers(workspaceId: string, rows: EncryptedRow[], secret: string, gateway: Gateway = callGateway) {
  if (rows.length > 100 || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => !row.encrypted_data || !row.nonce || !row.auth_tag || row.key_version !== 1)) throw new Error('Encrypted borrower unavailable');
  if (!rows.length) return [];
  const result = await gateway('decrypt', { workspace_id: workspaceId, items: rows.map(row => ({ id: row.id, ciphertext: row.encrypted_data, nonce: row.nonce, auth_tag: row.auth_tag })) }, secret);
  if (!Array.isArray(result.items) || result.items.length !== rows.length) throw new Error('Encrypted borrower unavailable');
  const items = result.items;
  return rows.map((row, index) => {
  if (items[index]?.id !== row.id) throw new Error('Encrypted borrower unavailable');
  const payload = items[index]?.payload;
  if (!payload || typeof payload.borrower_id !== 'string' || !payload.borrower_id.trim()) throw new Error('Encrypted borrower unavailable');
  const first = typeof payload.first_name === 'string' ? payload.first_name.trim() : '';
  const last = typeof payload.last_name === 'string' ? payload.last_name.trim() : '';
  const username = first ? [first, last].filter(Boolean).join(' ') : typeof payload.username === 'string' ? payload.username.trim() : '';
  if (!username) throw new Error('Encrypted borrower unavailable');
  return { username, borrower_id: payload.borrower_id as string };
  });
}
