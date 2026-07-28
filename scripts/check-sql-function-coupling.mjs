import { execFileSync } from 'node:child_process';

function getChangedFiles(base, head) {
  if (!base || /^0+$/.test(base)) return [];
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

function getChangedEntries(base, head) {
  if (!base || /^0+$/.test(base)) return [];
  const diffRange = head ? `${base}...${head}` : `${base}...HEAD`;
  const output = execFileSync('git', ['diff', '--name-status', '--find-renames', diffRange], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0] ?? '';
      if (status.startsWith('R') || status.startsWith('C')) {
        return {
          status,
          oldPath: parts[1] ?? '',
          path: parts[2] ?? '',
        };
      }

      return {
        status,
        oldPath: null,
        path: parts[1] ?? '',
      };
    });
}

function isLegacySqlRelocation(entry) {
  if (!entry.status.startsWith('R')) return false;
  if (!entry.oldPath?.startsWith('supabase/sql/')) return false;
  return (
    entry.path.startsWith('supabase/manual/sql/') ||
    entry.path.startsWith('supabase/archive/sql-legacy/')
  );
}

const base = process.env.ITX_DIFF_BASE || process.argv[2] || 'HEAD~1';
const head = process.env.ITX_DIFF_HEAD || process.argv[3] || 'HEAD';
const changedFiles = getChangedFiles(base, head);
const changedEntries = getChangedEntries(base, head);

if (changedFiles.length === 0) {
  console.log(`No changed files detected for ${base}...${head}; skipping SQL/function coupling check.`);
  process.exit(0);
}

const sqlFiles = changedFiles.filter(
  (file) =>
    file.startsWith('supabase/sql/') ||
    file.startsWith('supabase/manual/sql/')
);
if (sqlFiles.length === 0) {
  console.log('No SQL files changed; SQL/function coupling check passed.');
  process.exit(0);
}

const relatedFiles = changedFiles.filter(
  (file) =>
    file.startsWith('supabase/functions/') ||
    file.startsWith('src/services/') ||
    file.startsWith('tests/') ||
    file.startsWith('docs/api/') ||
    file === 'scripts/check-privileged-rls-policies.mjs'
);

const sqlEntries = changedEntries.filter(
  (entry) =>
    entry.path.startsWith('supabase/sql/') ||
    entry.path.startsWith('supabase/manual/sql/') ||
    entry.path.startsWith('supabase/archive/sql-legacy/')
);

if (relatedFiles.length === 0 && sqlEntries.length > 0 && sqlEntries.every(isLegacySqlRelocation)) {
  console.log('Only legacy SQL file relocations were detected; SQL/function coupling check passed.');
  console.log(`Legacy SQL relocations: ${sqlEntries.length}`);
  process.exit(0);
}

if (relatedFiles.length === 0) {
  console.error('SQL changes were detected without any related Edge Function, service, test, verification, or API contract updates.');
  console.error('Changed SQL files:');
  for (const file of sqlFiles) console.error(`- ${file}`);
  process.exit(1);
}

console.log('SQL/function coupling check passed.');
console.log(`SQL files changed: ${sqlFiles.length}`);
console.log(`Related function/service/test/verification/contract files changed: ${relatedFiles.length}`);
