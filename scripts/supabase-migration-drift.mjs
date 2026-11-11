// Detects (and optionally fixes) drift between supabase/migrations and the
// migrations a Supabase project has recorded.
//
// It talks to the Supabase Management API rather than Postgres directly, so it
// works from hosts outside the database network allow-list.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/supabase-migration-drift.mjs --project-ref <ref>
//       Report drift; exit 1 when repo migrations are unrecorded.
//   ... --apply --yes
//       Apply each unrecorded migration in filename order (one transaction per
//       file, recorded under its file name), and record allowlisted superseded
//       files as documented no-ops. Stops at the first failure.
//
// Matching: projects record apply-time versions, and many records carry the
// file name (with or without its version prefix), so a repo file is
// "recorded" when its version or its name appears. Superseded files are
// listed with reasons in supabase/migration-drift-allowlist.json.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrationsDir = resolve(root, "supabase/migrations");
const allowlist = JSON.parse(
  readFileSync(resolve(root, "supabase/migration-drift-allowlist.json"), "utf8"),
);
const superseded = allowlist.superseded ?? {};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const projectRef = (option("--project-ref") ?? process.env.SUPABASE_PROJECT_REF ?? "").trim();
const apply = flag("--apply");
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN.");
  process.exit(2);
}
if (!/^[a-z0-9]{20}$/.test(projectRef)) {
  console.error("Pass --project-ref <ref> or set SUPABASE_PROJECT_REF.");
  process.exit(2);
}
if (apply && !flag("--yes")) {
  console.error("--apply changes the target database; add --yes to confirm.");
  process.exit(2);
}

const api = async (path, body) => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${path}: ${text.slice(0, 600)}`);
  }
  return text ? JSON.parse(text) : null;
};

const recordedRows = await api("/database/query", {
  query: "select version, coalesce(name, '') as name from supabase_migrations.schema_migrations order by version",
  read_only: true,
});
const recorded = new Set();
for (const row of recordedRows) {
  recorded.add(row.version);
  if (row.name) {
    recorded.add(row.name);
    recorded.add(row.name.replace(/^\d{14}_/, ""));
  }
}

const repoFiles = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
const repoKeys = new Set();
const unrecorded = [];
for (const file of repoFiles) {
  const match = file.match(/^(\d{14})_(.+)\.sql$/);
  if (!match) continue;
  const [, version, name] = match;
  const stem = `${version}_${name}`;
  repoKeys.add(version).add(name).add(stem);
  if (recorded.has(version) || recorded.has(name) || recorded.has(stem)) continue;
  unrecorded.push({ file, stem, superseded: superseded[stem] });
}

const remoteOnly = recordedRows.filter((row) =>
  !repoKeys.has(row.version) &&
  !repoKeys.has(row.name) &&
  !repoKeys.has(row.name.replace(/^\d{14}_/, ""))
);

const pending = unrecorded.filter((entry) => !entry.superseded);
const supersededUnrecorded = unrecorded.filter((entry) => entry.superseded);

console.info(`Project ${projectRef}: ${recordedRows.length} recorded, ${repoFiles.length} in repo.`);
if (pending.length > 0) {
  console.info(`\nUnrecorded repo migrations (${pending.length}):`);
  for (const entry of pending) console.info(`  ${entry.file}`);
}
if (supersededUnrecorded.length > 0) {
  console.info(`\nSuperseded (allowlisted, will be recorded as no-ops on --apply):`);
  for (const entry of supersededUnrecorded) console.info(`  ${entry.file}`);
}
if (remoteOnly.length > 0) {
  // Usually a migration applied from a branch that has not merged yet.
  console.warn(`\nRecorded on the project but not in this checkout (${remoteOnly.length}):`);
  for (const row of remoteOnly) console.warn(`  ${row.version} ${row.name}`);
}

if (!apply) {
  if (pending.length > 0) {
    console.error(`\nMigration drift: ${pending.length} repo migration(s) are not recorded on ${projectRef}.`);
    process.exit(1);
  }
  console.info("\nNo migration drift.");
  process.exit(0);
}

for (const entry of unrecorded) {
  const query = entry.superseded
    ? `-- Recorded as a no-op by scripts/supabase-migration-drift.mjs.\n-- ${entry.superseded.replace(/\n/g, " ")}\nselect 1;`
    : readFileSync(resolve(migrationsDir, entry.file), "utf8");
  process.stdout.write(`${entry.superseded ? "Recording no-op" : "Applying"} ${entry.file} ... `);
  try {
    await api("/database/migrations", { name: entry.stem, query });
    console.info("ok");
  } catch (error) {
    console.info("FAILED");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
console.info(`\nApplied ${pending.length} migration(s); recorded ${supersededUnrecorded.length} superseded no-op(s).`);
