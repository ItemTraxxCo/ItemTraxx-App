import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

// Overall line-coverage floor for the Deno-tested surface (Supabase edge
// functions + the Cloudflare edge-proxy Worker). Below this, CI fails.
// DO NOT LOWER THIS WITHOUT DISCUSSING WITH THE TEAM FIRST.
const LINE_THRESHOLD = 80;

const findTestFiles = (dir) => {
  const results = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = `${current}${sep}${entry.name}`;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith("_test.ts")) {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
};

const supabaseTests = findTestFiles("supabase/functions");
const cloudflareTests = findTestFiles("cloudflare/edge-proxy/src");

const coverageDir = mkdtempSync(join(tmpdir(), "itx-deno-coverage-"));

// Deno overwrites (rather than accumulates) the profile data in a
// --coverage dir on each separate `deno test` invocation, so both suites
// must run together in a single invocation to get a combined lcov report.
// --no-check is safe here (and required for the Cloudflare Worker's ambient
// types): type checking already runs separately in CI (`deno check`,
// `worker:typecheck`), this step only measures runtime line coverage.
const allTests = [...supabaseTests, ...cloudflareTests];
if (!allTests.length) {
  console.error("[coverage] No *_test.ts files found under supabase/functions or cloudflare/edge-proxy/src.");
  process.exit(1);
}

console.log(`[coverage] Running ${allTests.length} Deno test files (Supabase + Cloudflare edge-proxy)...`);
const testRun = spawnSync(
  "deno",
  ["test", "--no-check", "--allow-env", "--allow-read", "--frozen", `--coverage=${coverageDir}`, ...allTests],
  { stdio: "inherit" }
);
if (testRun.status !== 0) {
  console.error("[coverage] Deno test run failed.");
  process.exit(testRun.status ?? 1);
}

const lcovPath = join(coverageDir, "lcov.info");
if (!existsSync(lcovPath)) {
  console.error(`[coverage] Expected lcov report at ${lcovPath} but it was not generated.`);
  process.exit(1);
}

const lcov = readFileSync(lcovPath, "utf8");

const perFile = [];
let currentFile = null;
let linesFound = 0;
let linesHit = 0;
for (const line of lcov.split("\n")) {
  if (line.startsWith("SF:")) {
    currentFile = line.slice(3).trim();
  } else if (line.startsWith("LF:")) {
    linesFound = Number(line.slice(3));
  } else if (line.startsWith("LH:")) {
    linesHit = Number(line.slice(3));
  } else if (line.startsWith("end_of_record")) {
    if (currentFile) {
      perFile.push({ file: currentFile, linesFound, linesHit });
    }
    currentFile = null;
    linesFound = 0;
    linesHit = 0;
  }
}

rmSync(coverageDir, { recursive: true, force: true });

if (!perFile.length) {
  console.error("[coverage] lcov report contained no records — nothing was measured.");
  process.exit(1);
}

const totalFound = perFile.reduce((sum, entry) => sum + entry.linesFound, 0);
const totalHit = perFile.reduce((sum, entry) => sum + entry.linesHit, 0);
const overallPercent = totalFound === 0 ? 100 : (totalHit / totalFound) * 100;

const belowThreshold = perFile
  .map((entry) => ({
    ...entry,
    percent: entry.linesFound === 0 ? 100 : (entry.linesHit / entry.linesFound) * 100,
  }))
  .filter((entry) => entry.percent < LINE_THRESHOLD)
  .sort((a, b) => a.percent - b.percent);

console.log("");
console.log(`[coverage] Overall Deno line coverage: ${overallPercent.toFixed(1)}% (threshold: ${LINE_THRESHOLD}%)`);
if (belowThreshold.length) {
  console.log(`[coverage] ${belowThreshold.length} file(s) below ${LINE_THRESHOLD}%:`);
  for (const entry of belowThreshold) {
    console.log(`  - ${entry.file}: ${entry.percent.toFixed(1)}% (${entry.linesHit}/${entry.linesFound} lines)`);
  }
}

if (overallPercent < LINE_THRESHOLD) {
  console.error(
    `\n[coverage] FAIL: overall Deno line coverage ${overallPercent.toFixed(1)}% is below the ${LINE_THRESHOLD}% floor.`
  );
  process.exit(1);
}

console.log("[coverage] PASS");
