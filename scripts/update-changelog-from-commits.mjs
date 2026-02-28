import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const changelogPath = 'CHANGELOG.md';
const before = process.env.GITHUB_EVENT_BEFORE || process.env.BEFORE_SHA;
const after = process.env.GITHUB_SHA || process.env.AFTER_SHA;

if (!before || !after) {
  console.log('Missing commit range; set GITHUB_EVENT_BEFORE/BEFORE_SHA and GITHUB_SHA/AFTER_SHA.');
  process.exit(0);
}

const formatDateForHeading = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const formatDateIso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getCommitSubjects = () => {
  const raw = execSync(`git log --reverse --no-merges --pretty=format:%s ${before}..${after}`, {
    encoding: 'utf8',
  }).trim();

  if (!raw) return [];

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      if (lower.startsWith('chore(changelog):')) return false;
      if (lower.startsWith('merge ')) return false;
      if (lower.includes('[skip ci]')) return false;
      return true;
    })
    .map((line) => line.endsWith('.') ? line : `${line}.`);
};

const upsertLastUpdated = (content, isoDate) =>
  content.replace(/Last updated \(year-month-day\):\s*\d{4}-\d{2}-\d{2}/, `Last updated (year-month-day): ${isoDate}`);

const insertIntoExistingSection = (content, heading, bullets) => {
  const headingIdx = content.indexOf(heading);
  if (headingIdx === -1) return null;

  const nextDividerIdx = content.indexOf('\n---', headingIdx);
  if (nextDividerIdx === -1) return null;

  const section = content.slice(headingIdx, nextDividerIdx);
  const existingBullets = new Set(
    section
      .split('\n')
      .filter((line) => line.trim().startsWith('- '))
      .map((line) => line.trim().slice(2).trim())
  );

  const freshBullets = bullets.filter((b) => !existingBullets.has(b));
  if (!freshBullets.length) return content;

  const insertion = `${freshBullets.map((b) => `- ${b}`).join('\n')}\n`;
  return `${content.slice(0, nextDividerIdx)}${insertion}${content.slice(nextDividerIdx)}`;
};

const appendNewSection = (content, heading, bullets) => {
  const section = `\n### ${heading}\n\n${bullets.map((b) => `- ${b}`).join('\n')}\n\n---\n`;
  return `${content.trimEnd()}\n${section}`;
};

const main = () => {
  const commits = getCommitSubjects();
  if (!commits.length) {
    console.log('No eligible commit messages to add.');
    process.exit(0);
  }

  const now = new Date();
  const heading = `${formatDateForHeading(now)} Development Update`;
  const isoDate = formatDateIso(now);

  let content = readFileSync(changelogPath, 'utf8');
  content = upsertLastUpdated(content, isoDate);

  const existingUpdate = insertIntoExistingSection(content, `### ${heading}`, commits);
  content = existingUpdate ?? appendNewSection(content, heading, commits);

  writeFileSync(changelogPath, content);
  console.log(`Updated ${changelogPath} with ${commits.length} changelog bullet(s).`);
};

main();
