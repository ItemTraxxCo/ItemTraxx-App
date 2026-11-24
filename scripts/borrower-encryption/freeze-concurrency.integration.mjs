// Explicit opt-in: this creates and removes synthetic rows in an existing local stack.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.ITX_LOCAL_FREEZE_TEST_DB_CONTAINER;
if (!container || !/^supabase_db_[a-z0-9_-]+local$/.test(container)) throw new Error('Set ITX_LOCAL_FREEZE_TEST_DB_CONTAINER to an isolated local Supabase database container');
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
const sql = (input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const sqlAsync = (input) => {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdout.resume(); child.stderr.on('data', (data) => { stderr += data; });
  child.stdin.end(input);
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })));
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
const workspace = randomUUID(), borrower = randomUUID();
let created = false;
try {
  sql(`begin; insert into public.workspaces(id,name,slug,status) values ('${workspace}','Freeze Test','freeze-test-${workspace}','active'); insert into public.borrowers(id,workspace_id,username,borrower_id) values ('${borrower}','${workspace}','Test','ID'); commit;`);
  created = true;
  for (const isolation of ['repeatable read', 'serializable']) {
    sql(`begin isolation level ${isolation}; update public.borrowers set username='unfrozen' where id='${borrower}'; select public.set_borrower_write_freeze('${workspace}',true); select public.set_borrower_write_freeze('${workspace}',false); commit;`);
  }
  const writer = sqlAsync(`begin; update public.borrowers set username='before' where id='${borrower}'; select pg_sleep(2); commit;`);
  await pause();
  const start = Date.now();
  const freeze = sqlAsync(`select public.set_borrower_write_freeze('${workspace}',true);`);
  assert.equal((await writer).code, 0); assert.equal((await freeze).code, 0);
  assert.ok(Date.now() - start > 900, 'freeze must wait for an in-flight writer');
  sql(`select public.set_borrower_write_freeze('${workspace}',false);`);
  const activating = sqlAsync(`begin; select public.set_borrower_write_freeze('${workspace}',true); select pg_sleep(2); commit;`);
  await pause();
  const late = sqlAsync(`update public.borrowers set username='late' where id='${borrower}';`);
  assert.equal((await activating).code, 0);
  const lateResult = await late;
  assert.notEqual(lateResult.code, 0); assert.match(lateResult.stderr, /Borrower writes temporarily paused/);
  for (const isolation of ['repeatable read', 'serializable']) {
    const result = sql(`begin isolation level ${isolation}; select public.backfill_encrypted_borrower('${workspace}','${borrower}','before','ID','cipher','nonce','tag',repeat('a',64),null); rollback;`);
    assert.match(result, /t/);
  }
  sql(`select public.set_borrower_write_freeze('${workspace}',false);`);
  for (const isolation of ['repeatable read', 'serializable']) {
    sql(`select public.set_borrower_write_freeze('${workspace}',false);`);
    const snapshot = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; snapshot.stdout.resume(); snapshot.stderr.on('data', (data) => { stderr += data; });
    snapshot.stdin.write(`\\set VERBOSITY verbose\nbegin isolation level ${isolation}; select count(*) from public.borrowers;\n`);
    await pause();
    sql(`select public.set_borrower_write_freeze('${workspace}',true);`);
    snapshot.stdin.end(`update public.borrowers set username='stale' where id='${borrower}'; commit;`);
    const code = await new Promise((resolve) => snapshot.on('close', resolve));
    assert.notEqual(code, 0); assert.match(stderr, /40001/);
  }
  for (const isolation of ['repeatable read', 'serializable']) {
    sql(`select public.set_borrower_write_freeze('${workspace}',true);`);
    const snapshot = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; snapshot.stdout.resume(); snapshot.stderr.on('data', (data) => { stderr += data; });
    snapshot.stdin.write(`\\set VERBOSITY verbose\nbegin isolation level ${isolation}; select public.borrower_write_freeze_is_active('${workspace}');\n`);
    await pause();
    sql(`select public.set_borrower_write_freeze('${workspace}',false);`);
    snapshot.stdin.end(`select public.backfill_encrypted_borrower('${workspace}','${borrower}','before','ID','cipher','nonce','tag',repeat('a',64),null); commit;`);
    const code = await new Promise((resolve) => snapshot.on('close', resolve));
    assert.notEqual(code, 0); assert.match(stderr, /40001/);
  }
  console.log('Freeze concurrency checks passed.');
} finally {
  if (created) sql(`select public.set_borrower_write_freeze('${workspace}',false); delete from public.borrowers where workspace_id='${workspace}'; delete from public.workspaces where id='${workspace}';`);
}
