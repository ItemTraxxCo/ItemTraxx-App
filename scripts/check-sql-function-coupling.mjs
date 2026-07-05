import { execFileSync } from 'node:child_process';

function getChangedFiles(base, head) {
  if (!base) return [];
  const diffRange = head ? `${base}...${head}` : `${base}...HEAD`;
  const output = execFileSync('git', ['diff', '--name-only', diffRange], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const base = process.env.ITX_DIFF_BASE || process.argv[2] || 'HEAD~1';
const head = process.env.ITX_DIFF_HEAD || process.argv[3] || 'HEAD';
const changedFiles = getChangedFiles(base, head);

if (changedFiles.length === 0) {
  console.log(`No changed files detected for ${base}...${head}; skipping SQL/function coupling check.`);
  process.exit(0);
}

const sqlFiles = changedFiles.filter((file) => file.startsWith('supabase/sql/'));
if (sqlFiles.length === 0) {
  console.log('No SQL files changed; SQL/function coupling check passed.');
  process.exit(0);
}

const relatedFiles = changedFiles.filter(
  (file) =>
    file.startsWith('supabase/functions/') ||
    file.startsWith('src/services/') ||
    file.startsWith('tests/') ||
    file.startsWith('docs/api/')
);

if (relatedFiles.length === 0) {
  console.error('SQL changes were detected without any related Edge Function, service, test, or API contract updates.');
  console.error('Changed SQL files:');
  for (const file of sqlFiles) console.error(`- ${file}`);
  process.exit(1);
}

console.log('SQL/function coupling check passed.');
console.log(`SQL files changed: ${sqlFiles.length}`);
console.log(`Related function/service/test/contract files changed: ${relatedFiles.length}`);
