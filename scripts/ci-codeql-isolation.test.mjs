import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = (path) => yaml.load(readFileSync(new URL(path, import.meta.url), "utf8"));
const ci = workflow("../.github/workflows/ci.yml");
const ciValidation = workflow("../.github/workflows/ci-validation.yml");
const codeql = workflow("../.github/workflows/codeql.yml");
const denoLockSync = workflow("../.github/workflows/dependabot-deno-lock-sync.yml");
const failureNotification = workflow("../.github/workflows/ci-failure-notify.yml");
const triage = workflow("../.github/workflows/ci-triage.yml");

const usesCodeQlAction = (step) =>
  typeof step.uses === "string" && step.uses.startsWith("github/codeql-action/");

test("PR validation and Dependabot follow-up stay in pull_request cache scope", () => {
  assert.deepEqual(ci.permissions, {
    actions: "read",
    contents: "read",
    "pull-requests": "read",
  });
  for (const [jobName, job] of Object.entries(ci.jobs ?? {})) {
    assert.equal(job.permissions, undefined, `${jobName} must inherit CI’s read-only permissions`);
  }
  assert.ok(Object.hasOwn(ci.on ?? {}, "pull_request"));
  assert.equal(ci.jobs?.validate?.uses, "./.github/workflows/ci-validation.yml");
  assert.deepEqual(Object.keys(ciValidation.on ?? {}), ["workflow_call"]);
  assert.equal((ciValidation.jobs?.validate?.steps ?? []).some(usesCodeQlAction), false);
  assert.equal(ci.on?.workflow_dispatch, undefined);
  assert.equal(ci.jobs?.["require-trusted-ref"], undefined);

  const checkout = ciValidation.jobs?.validate?.steps?.find((step) => step.name === "Checkout");
  assert.equal(checkout?.with?.ref, "${{ inputs.ref }}");

  assert.ok(denoLockSync.on?.pull_request);
  assert.equal(denoLockSync.on?.workflow_dispatch, undefined);
  assert.equal(denoLockSync.jobs?.sync?.permissions?.actions, "read");
  assert.equal(denoLockSync.jobs?.sync?.outputs?.updated_head_sha, "${{ steps.updated-head.outputs.sha }}");
  assert.equal(denoLockSync.jobs?.validate?.uses, "./.github/workflows/ci-validation.yml");
  assert.deepEqual(denoLockSync.jobs?.validate?.needs, ["sync", "kill-switch-preflight"]);
  assert.equal(denoLockSync.jobs?.validate?.with?.ref, "${{ needs.sync.outputs.updated_head_sha }}");
  assert.equal(denoLockSync.jobs?.validate?.with?.diff_head_sha, "${{ needs.sync.outputs.updated_head_sha }}");
  assert.equal(
    denoLockSync.jobs?.sync?.steps?.some((step) => /workflow_dispatch|actions\/workflows/.test(step.run ?? "")),
    false,
  );

  assert.ok(failureNotification.on?.workflow_run?.workflows?.includes("CodeQL"));
  assert.ok(triage.on?.workflow_run?.workflows?.includes("CodeQL"));
  assert.match(failureNotification.jobs?.notify?.if ?? "", /pull_request_target/);
  assert.match(triage.jobs?.triage?.if ?? "", /pull_request_target/);
});

test("CodeQL analyzes PR source without a privileged pull_request_target checkout", () => {
  assert.ok(codeql.on?.pull_request);
  assert.equal(codeql.on?.pull_request_target, undefined);
  assert.deepEqual(codeql.on?.push?.branches, ["main", "preview", "staging"]);
  assert.equal(codeql.on?.schedule?.[0]?.cron, "21 9 * * 1");

  assert.deepEqual(codeql.permissions, {
    actions: "read",
    contents: "read",
    "pull-requests": "read",
  });

  const preflight = codeql.jobs?.["kill-switch-preflight"];
  assert.equal(preflight?.uses, "./.github/workflows/kill-switch-preflight.yml");
  assert.equal(preflight?.with?.status_source, "supabase");

  const analyze = codeql.jobs?.analyze;
  assert.ok(analyze?.needs?.includes("kill-switch-preflight"));
  assert.match(analyze?.if ?? "", /needs\.kill-switch-preflight\.outputs\.active == 'false'/);
  assert.deepEqual(analyze?.permissions, {
    actions: "read",
    contents: "read",
    "pull-requests": "read",
    "security-events": "write",
  });
  for (const [jobName, job] of Object.entries(codeql.jobs ?? {})) {
    if (jobName !== "analyze") {
      assert.equal(job.permissions, undefined, `${jobName} must not override the read-only workflow permissions`);
    }
  }
  assert.equal((analyze?.steps ?? []).some((step) => Object.hasOwn(step, "run")), false);
  assert.ok(codeql.jobs?.["slack-notify-start"]?.needs?.includes("kill-switch-preflight"));
  assert.equal(codeql.jobs?.["slack-notify-start"]?.if, "${{ github.event_name != 'pull_request' }}");
  assert.match(codeql.jobs?.["slack-notify-finish"]?.if ?? "", /github\.event_name != 'pull_request'/);
  assert.match(codeql.jobs?.["slack-notify-preflight-blocked"]?.if ?? "", /github\.event_name != 'pull_request'/);
  assert.ok(codeql.jobs?.["slack-notify-finish"]?.needs?.includes("analyze"));
  assert.ok(codeql.jobs?.["slack-notify-preflight-blocked"]?.needs?.includes("kill-switch-preflight"));

  const checkout = analyze.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout?.with?.ref, "${{ github.sha }}");
  assert.equal(checkout?.with?.["persist-credentials"], false);
  assert.equal(checkout?.with?.["allow-unsafe-pr-checkout"], undefined);

  const init = analyze.steps.find((step) => step.uses?.startsWith("github/codeql-action/init@"));
  const upload = analyze.steps.find((step) => step.uses?.startsWith("github/codeql-action/analyze@"));
  assert.equal(init?.with?.["build-mode"], "none");
  assert.match(upload?.with?.ref ?? "", /refs\/pull\/\{0\}\/merge/);
  assert.equal(upload?.with?.sha, "${{ github.sha }}");
});
