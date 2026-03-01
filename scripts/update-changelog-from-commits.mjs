import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const changelogPath = 'CHANGELOG.md';
const before = process.env.GITHUB_EVENT_BEFORE || process.env.BEFORE_SHA;
const after = process.env.GITHUB_SHA || process.env.AFTER_SHA;
const changelogTimeZone = process.env.CHANGELOG_TIMEZONE || 'America/Los_Angeles';

if (!before || !after) {
  console.log('Missing commit range; set GITHUB_EVENT_BEFORE/BEFORE_SHA and GITHUB_SHA/AFTER_SHA.');
  process.exit(0);
}

const getZonedDateParts = (d, timeZone) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  return { year, month, day };
};

const formatDateForHeading = (d, timeZone) => {
  const { year, month, day } = getZonedDateParts(d, timeZone);
  return `${month}/${day}/${year}`;
};

const formatDateIso = (d, timeZone) => {
  const { year, month, day } = getZonedDateParts(d, timeZone);
  const m = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${m}-${dd}`;
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

const upsertLastUpdated = (content, isoDate) => {
  if (/Last updated \(year-month-day\):\s*\d{4}-\d{2}-\d{2}/.test(content)) {
    return content.replace(
      /Last updated \(year-month-day\):\s*\d{4}-\d{2}-\d{2}/,
      `Last updated (year-month-day): ${isoDate}`
    );
  }
  if (/Last updated:\s*\d{4}-\d{2}-\d{2}\s*\(year-month-day\)/.test(content)) {
    return content.replace(
      /Last updated:\s*\d{4}-\d{2}-\d{2}\s*\(year-month-day\)/,
      `Last updated (year-month-day): ${isoDate}`
    );
  }
  return content;
};

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

const FOOTER_MARKER = '##### You have reached the bottom of the changelog.';

const appendNewSection = (content, heading, bullets) => {
  const section = `\n### ${heading}\n\n${bullets.map((b) => `- ${b}`).join('\n')}\n\n---\n`;
  const footerIdx = content.indexOf(FOOTER_MARKER);
  if (footerIdx === -1) {
    return `${content.trimEnd()}\n${section}`;
  }
  const beforeFooter = content.slice(0, footerIdx).replace(/\s*$/, '\n\n');
  const footerAndAfter = content.slice(footerIdx);
  return `${beforeFooter}${section}\n${footerAndAfter}`;
};

const main = () => {
  const commits = getCommitSubjects();
  if (!commits.length) {
    console.log('No eligible commit messages to add.');
    process.exit(0);
  }

  const now = new Date();
  const heading = `${formatDateForHeading(now, changelogTimeZone)} Development Update`;
  const isoDate = formatDateIso(now, changelogTimeZone);

  let content = readFileSync(changelogPath, 'utf8');
  content = upsertLastUpdated(content, isoDate);

  const existingUpdate = insertIntoExistingSection(content, `### ${heading}`, commits);
  content = existingUpdate ?? appendNewSection(content, heading, commits);

  writeFileSync(changelogPath, content);
  console.log(`Updated ${changelogPath} with ${commits.length} changelog bullet(s).`);
};

main();
