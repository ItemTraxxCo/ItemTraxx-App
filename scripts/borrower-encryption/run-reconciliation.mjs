import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reconcileWorkspace } from './reconcile.mjs';

// Staging-only read-only tool. Supply the restored DB URL and KEK via environment,
// never as command arguments. A separate writer freeze and restore hold are required.
const db = process.env.ITX_RESTORE_DATABASE_URL;
const encoded = process.env.ITX_STAGING_MASTER_KEK;
const internalSecret = process.env.ITX_STAGING_SGW_INTERNAL_SECRET;
const root = fileURLToPath(new URL('../../', import.meta.url));
const namespace = 'd5f35be5620148d89c68218cd4e8c520';
const report = (workspace_id, state, mismatch) => console.log(JSON.stringify({ workspace_id, state, mismatch }));
if (process.argv.length !== 3 || process.argv[2] !== '--staging' || !db || !encoded || !internalSecret || internalSecret.length < 32) throw new Error('Staging restore database, staging KEK and gateway secret required');
const parsed = new URL(db);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', 'db.nwuhjxicaopkmqydjlas.supabase.co'].includes(parsed.hostname)) throw new Error('Unapproved restore database');
const kek = Uint8Array.from(Buffer.from(encoded, 'base64'));
if (kek.length !== 32 || Buffer.from(kek).toString('base64') !== encoded) throw new Error('Invalid staging KEK');
const holdConfirmed = async () => {
  try {
    const hold = await fetch('https://itemtraxx-sgw-staging.itemtraxx-co.workers.dev/v1/crypto/hash-index', {
      method: 'POST', headers: { authorization: `Bearer ${internalSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: '00000000-0000-4000-8000-000000000000', values: { borrower_id: 'synthetic' } }),
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    return hold.status === 503 && (await hold.json())?.error === 'Gateway temporarily unavailable';
  } catch { return false; }
};
if (!await holdConfirmed()) throw new Error('Staging gateway hold is not confirmed');
if (!parsed.pathname || parsed.pathname === '/' || parsed.search || parsed.hash) throw new Error('Invalid restore database URL');
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && !key.startsWith('ITX_')));
const env = { ...safeEnv, PGHOST: parsed.hostname, PGPORT: parsed.port || '5432', PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)), PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000' };
const kvEnv = { ...safeEnv, CLOUDFLARE_ACCOUNT_ID: 'a818c04b9346dfe1667edef87876b934' };
if (parsed.hostname === 'db.nwuhjxicaopkmqydjlas.supabase.co') env.PGSSLMODE = 'verify-full';
const query = (sql) => {
  const p = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { cwd: root, env, input: sql, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 45000 });
  if (p.status !== 0) throw new Error('Restored database unavailable');
  return JSON.parse(p.stdout.trim());
};
const wrangler = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const kv = (args) => {
  const p = spawnSync(process.execPath, [wrangler, 'kv', 'key', ...args, '--remote', '--namespace-id', namespace], { cwd: root, env: kvEnv, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000 });
  if (p.status !== 0) throw new Error('KV unavailable');
  return p.stdout;
};
const rows = query(`select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select w.id::text as workspace_id, l.state as lifecycle, f.encrypted_only, f.frozen, f.freeze_epoch::text as freeze_epoch from public.workspaces w left join public.sgw_workspace_key_lifecycle l on l.workspace_id=w.id left join private.borrower_write_freezes f on f.workspace_id=w.id order by w.id) x;`);
let bad = false;
if (!rows.length) { report(null, 'unavailable', 'no_restored_workspaces'); bad = true; }
for (const row of rows) {
  const workspaceId = row.workspace_id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workspaceId)) throw new Error('Invalid restored workspace ID');
  if (!row.frozen || !row.freeze_epoch || typeof row.encrypted_only !== 'boolean') { report(workspaceId, 'unavailable', 'writer_freeze_missing'); bad = true; continue; }
  try {
    const items = query(`select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select id::text, workspace_id::text, encrypted_data, nonce, auth_tag, key_version from public.borrowers where workspace_id='${workspaceId}'::uuid and encrypted_data is not null order by id limit 10001) x;`);
    if (items.length > 10000) { report(workspaceId, 'unavailable', 'record_limit_exceeded'); bad = true; continue; }
    const result = await reconcileWorkspace({ workspaceId, lifecycle: row.lifecycle, encryptedOnly: row.encrypted_only, items, kek, readKey: async (id) => {
      const list = JSON.parse(kv(['list', '--prefix', id]));
      if (!Array.isArray(list)) throw new Error('Invalid KV listing');
      if (!list.some((entry) => entry.name === id)) return null;
      return kv(['get', id, '--text']);
    } });
    const check = query(`select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select frozen,freeze_epoch::text from private.borrower_write_freezes where workspace_id='${workspaceId}'::uuid) x;`);
    if (check.length !== 1 || !check[0].frozen || check[0].freeze_epoch !== row.freeze_epoch) { report(workspaceId, 'unavailable', 'writer_freeze_changed'); bad = true; continue; }
    if (!await holdConfirmed()) { report(workspaceId, 'unavailable', 'gateway_hold_unavailable'); bad = true; continue; }
    report(workspaceId, result.state, result.mismatch); bad = true; // All outcomes require independent history review.
  } catch { report(workspaceId, 'unavailable', 'database_or_reconciliation_error'); bad = true; }
}
// This tool cannot establish post-snapshot revocation history, including for
// an empty restored database. No result authorizes clearing the hold.
if (bad || rows.length === 0) process.exitCode = 1;
