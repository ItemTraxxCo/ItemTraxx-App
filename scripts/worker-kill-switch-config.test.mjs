import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (path) => readFileSync(resolve(repoRoot, path), "utf8");

test("routine Worker deploys preserve configured edge downtime values", () => {
  const wranglerConfig = readRepoFile("cloudflare/edge-proxy/wrangler.toml");
  assert.match(wranglerConfig, /^keep_vars\s*=\s*true\s*$/m);
  assert.doesNotMatch(wranglerConfig, /^\s*ITX_(?:MAINTENANCE|KILLSWITCH)_/m);
});

test("local development keeps edge downtime disabled by default", () => {
  const devVars = readRepoFile("cloudflare/edge-proxy/.dev.vars.example");
  assert.match(devVars, /^ITX_MAINTENANCE_ENABLED="false"$/m);
  assert.match(devVars, /^ITX_KILLSWITCH_ENABLED="false"$/m);

  const workerEntry = readRepoFile("cloudflare/edge-proxy/src/index.ts");
  assert.match(workerEntry, /resolveDowntimeState\(env\)/);
});

test("the dedicated workflow can set all edge downtime values explicitly", () => {
  const workflow = readRepoFile(".github/workflows/manage-kill-switch.yml");
  for (const name of [
    "ITX_MAINTENANCE_ENABLED",
    "ITX_MAINTENANCE_MESSAGE",
    "ITX_KILLSWITCH_ENABLED",
    "ITX_KILLSWITCH_MESSAGE",
  ]) {
    assert.match(workflow, new RegExp(`--var\\s+"${name}:`));
  }
});
