import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (path) => readFileSync(resolve(repoRoot, path), "utf8");

test("routine Worker deploys preserve the configured kill-switch value", () => {
  const wranglerConfig = readRepoFile("cloudflare/edge-proxy/wrangler.toml");
  assert.match(wranglerConfig, /^keep_vars\s*=\s*true\s*$/m);
  assert.doesNotMatch(wranglerConfig, /^\s*ITX_ITEMTRAXX_KILLSWITCH_ENABLED\s*=/m);
});

test("local development keeps the kill switch off by default", () => {
  const devVars = readRepoFile("cloudflare/edge-proxy/.dev.vars.example");
  assert.match(devVars, /^ITX_ITEMTRAXX_KILLSWITCH_ENABLED="false"$/m);

  const workerEntry = readRepoFile("cloudflare/edge-proxy/src/index.ts");
  assert.match(workerEntry, /env\.ITX_ITEMTRAXX_KILLSWITCH_ENABLED\s*\?\?\s*""/);
});

test("the dedicated workflow can still set the kill-switch value explicitly", () => {
  const workflow = readRepoFile(".github/workflows/manage-kill-switch.yml");
  assert.match(
    workflow,
    /--var\s+"ITX_ITEMTRAXX_KILLSWITCH_ENABLED:\$KILL_SWITCH_ENABLED"/,
  );
});
