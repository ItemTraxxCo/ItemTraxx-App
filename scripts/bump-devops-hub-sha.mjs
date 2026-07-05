import fs from 'node:fs/promises';
import path from 'node:path';

const workflowPaths = [
  '.github/workflows/ci-triage.yml',
  '.github/workflows/pr-risk-review.yml',
  '.github/workflows/deploy-evidence.yml',
  '.github/workflows/synthetic-probes.yml',
  '.github/workflows/dependabot-promotion.yml',
];

const shaArg = process.argv[2];
if (!shaArg || !/^[0-9a-f]{40}$/i.test(shaArg)) {
  console.error('Usage: node ./scripts/bump-devops-hub-sha.mjs <40-char-commit-sha>');
  process.exit(1);
}

for (const relativePath of workflowPaths) {
  const absolutePath = path.resolve(relativePath);
  const current = await fs.readFile(absolutePath, 'utf8');
  const updated = current.replace(
    /ItemTraxxCo\/devops\/\.github\/workflows\/(reusable-[^@]+)@[0-9a-f]{40}/g,
    `ItemTraxxCo/devops/.github/workflows/$1@${shaArg}`
  );
  if (current === updated) {
    console.warn(`No pinned hub SHA found to update in ${relativePath}`);
    continue;
  }
  await fs.writeFile(absolutePath, updated, 'utf8');
  console.log(`Updated ${relativePath}`);
}
