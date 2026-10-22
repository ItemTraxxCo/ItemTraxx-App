import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const validation = yaml.load(
  readFileSync(new URL("../.github/workflows/ci-validation.yml", import.meta.url), "utf8"),
);

test("CI installs and audits the separately locked Cloudflare edge proxy tree", () => {
  const steps = validation.jobs?.validate?.steps ?? [];
  const install = steps.find((step) => step.name === "Install Cloudflare Worker dependencies");
  const audit = steps.find((step) => step.name === "Audit Cloudflare Worker dependencies");

  assert.equal(install?.run, "npm ci --ignore-scripts --prefix cloudflare/edge-proxy");
  assert.match(audit?.run ?? "", /npm audit --audit-level=moderate --prefix cloudflare\/edge-proxy/);
  assert.match(audit?.run ?? "", /npm audit signatures --prefix cloudflare\/edge-proxy/);
});
