// Regenerates tests/security/postgres/baseline/schema.sql, the schema-only
// baseline the adversarial SQL suite boots from. It runs the catalog-driven
// generator read-only through the Supabase Management API, so it works even
// though the project database enforces a network allow-list.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=... npm run test:security:baseline
// Target project: ITX_SECURITY_BASELINE_PROJECT_REF, else the linked project
// in supabase/.temp/project-ref (staging). Never point this at a project you
// do not intend to mirror; the query is read-only and returns DDL only.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const generatorPath = resolve(root, "tests/security/postgres/baseline/generate-baseline.sql");
const outputPath = resolve(root, "tests/security/postgres/baseline/schema.sql");

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (a Supabase personal access token) to regenerate the baseline.");
  process.exit(2);
}

let projectRef = process.env.ITX_SECURITY_BASELINE_PROJECT_REF?.trim();
if (!projectRef) {
  try {
    projectRef = readFileSync(resolve(root, "supabase/.temp/project-ref"), "utf8").trim();
  } catch {
    // handled below
  }
}
if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
  console.error("Set ITX_SECURITY_BASELINE_PROJECT_REF or link the staging project (supabase link).");
  process.exit(2);
}

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: readFileSync(generatorPath, "utf8"),
      read_only: true,
    }),
  },
);
if (!response.ok) {
  console.error(`Management API query failed with HTTP ${response.status}.`);
  process.exit(1);
}

const rows = await response.json();
const baseline = Array.isArray(rows) ? rows[0]?.baseline : undefined;
if (typeof baseline !== "string" || !baseline.includes("create table")) {
  console.error("Management API returned no baseline DDL.");
  process.exit(1);
}

// The baseline is committed. Refuse anything that looks like a credential
// embedded in a function body, default, or policy.
const secretPatterns = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "JWT"],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/, "Supabase API key"],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/, "Stripe-style secret"],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/, "bearer token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bpassword\s*(?:=|:=|=>)\s*'[^']+'/i, "password literal"],
];
const findings = secretPatterns
  .filter(([pattern]) => pattern.test(baseline))
  .map(([, label]) => label);
if (findings.length > 0) {
  console.error(
    `Refusing to write the baseline: possible secret material (${findings.join(", ")}). Review the source schema first.`,
  );
  process.exit(1);
}

writeFileSync(outputPath, baseline);
const statements = baseline.split(/;\n/).length;
console.info(`Wrote ${outputPath} (${baseline.length} bytes, ~${statements} statements) from project ${projectRef}.`);
