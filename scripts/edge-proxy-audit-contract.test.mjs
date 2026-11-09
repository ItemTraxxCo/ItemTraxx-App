import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const validation = yaml.load(
  readFileSync(new URL("../.github/workflows/ci-validation.yml", import.meta.url), "utf8"),
);

test("CI installs and audits the separately locked Cloudflare edge proxy tree", () => {
  // The audit must run in the same job that installs the edge-proxy tree,
  // because `npm audit signatures` verifies the installed packages.
  const auditJob = Object.values(validation.jobs ?? {}).find((job) =>
    (job.steps ?? []).some((step) => step.name === "Audit Cloudflare Worker dependencies"),
  );
  const steps = auditJob?.steps ?? [];
  const install = steps.find((step) => step.name === "Install Cloudflare Worker dependencies");
  const audit = steps.find((step) => step.name === "Audit Cloudflare Worker dependencies");
  assert.ok(
    steps.indexOf(install) !== -1 && steps.indexOf(install) < steps.indexOf(audit),
    "edge-proxy install must precede its audit in the same job",
  );

  assert.equal(install?.run, "npm ci --ignore-scripts --prefix cloudflare/edge-proxy");
  assert.match(audit?.run ?? "", /npm audit --audit-level=moderate --prefix cloudflare\/edge-proxy/);
  assert.match(audit?.run ?? "", /npm audit signatures --prefix cloudflare\/edge-proxy/);
});
