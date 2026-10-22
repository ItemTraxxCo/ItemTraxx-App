import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getTrustedNpmRuntime } from "./security-exec.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
const runtime = getTrustedNpmRuntime();

const run = (label, executable, args) => {
  console.log(`[security] ${label}`);
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: runtime.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    throw new Error(`[security] ${label} could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`[security] ${label} failed with exit code ${result.status}.`);
  }
};

const ignoredDirectories = new Set([
  ".git",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

const findMatches = (rootPath, pattern) => {
  const matches = [];
  const inspectFile = (path) => {
    const content = readFileSync(path, "utf8");
    if (content.includes("\0")) return;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        matches.push(`${relative(repositoryRoot, path)}:${index + 1}`);
      }
    });
  };
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      inspectFile(path);
    }
  };
  if (statSync(rootPath).isFile()) inspectFile(rootPath);
  else visit(rootPath);
  return matches;
};

const failOnMatches = (label, matches) => {
  if (matches.length) {
    throw new Error(`[security] ${label} found at ${matches.join(", ")}.`);
  }
};

run(
  "testing npm audit gate failure handling",
  runtime.nodePath,
  ["--test", join(scriptDirectory, "npm-audit-gate.test.mjs")],
);
run(
  "npm audit (moderate+)",
  runtime.nodePath,
  [join(scriptDirectory, "npm-audit-gate.mjs")],
);
run(
  "npm audit signatures",
  runtime.nodePath,
  [runtime.npmPath, "audit", "signatures"],
);

console.log("[security] scanning for unsafe dynamic code execution patterns");
const unsafePatterns = /\beval\(|new Function\(/;
const unsafeMatches = ["src", "supabase", "cloudflare"].flatMap((directory) =>
  findMatches(join(repositoryRoot, directory), unsafePatterns)
);
failOnMatches("Unsafe eval/new Function pattern", unsafeMatches);
console.log("No unsafe eval/new Function patterns found.");

console.log("[security] checking sample env file for committed private keys");
const secretMatches = findMatches(
  join(repositoryRoot, ".env.example"),
  /sb_secret_|SUPABASE_SERVICE_ROLE_KEY=.+|CLOUDFLARE_API_TOKEN=.+/,
);
failOnMatches("Potential private secret assignment in .env.example", secretMatches);
console.log("No private secret assignments found in .env.example.");

run(
  "checking privileged RLS policy invariants",
  runtime.nodePath,
  [join(scriptDirectory, "check-privileged-rls-policies.mjs")],
);
run(
  "running Supabase shared security regression tests",
  "deno",
  [
    "test",
    "--node-modules-dir=none",
    "--allow-env",
    "supabase/functions/_shared/cors_test.ts",
    "supabase/functions/_shared/accountSessions_test.ts",
    "supabase/functions/_shared/preloginGuards_test.ts",
    "supabase/functions/_shared/trustedIngress_test.ts",
  ],
);

console.log("[security] audit complete");
