import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = (path) => yaml.load(readFileSync(new URL(path, import.meta.url), "utf8"));
const ci = workflow("../.github/workflows/ci.yml");
const codeql = workflow("../.github/workflows/codeql.yml");
const denoLockSync = workflow("../.github/workflows/dependabot-deno-lock-sync.yml");
const failureNotification = workflow("../.github/workflows/ci-failure-notify.yml");
const triage = workflow("../.github/workflows/ci-triage.yml");

const usesCodeQlAction = (step) =>
  typeof step.uses === "string" && step.uses.startsWith("github/codeql-action/");

test("PR validation and Dependabot follow-up CI do not receive CodeQL write access", () => {
  assert.deepEqual(ci.permissions, {
    actions: "read",
    contents: "read",
    "pull-requests": "read",
  });
  for (const [jobName, job] of Object.entries(ci.jobs ?? {})) {
    assert.equal(job.permissions, undefined, `${jobName} must inherit CI’s read-only permissions`);
  }
  assert.equal((ci.jobs?.validate?.steps ?? []).some(usesCodeQlAction), false);

  const followup = denoLockSync.jobs?.sync?.steps?.find((step) =>
    step.name === "Dispatch checks for the updated PR head",
  );
  assert.match(followup?.run ?? "", /actions\/workflows\/ci\.yml\/dispatches/);

  assert.ok(failureNotification.on?.workflow_run?.workflows?.includes("CodeQL"));
  assert.ok(triage.on?.workflow_run?.workflows?.includes("CodeQL"));
  assert.match(failureNotification.jobs?.notify?.if ?? "", /pull_request_target/);
  assert.match(triage.jobs?.triage?.if ?? "", /pull_request_target/);
});

test("CodeQL analyzes PR source in a trusted, non-executing privileged job", () => {
  assert.ok(codeql.on?.pull_request_target);
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
  assert.equal(codeql.jobs?.["slack-notify-start"]?.if, "${{ github.event_name != 'pull_request_target' }}");
  assert.ok(codeql.jobs?.["slack-notify-finish"]?.needs?.includes("analyze"));
  assert.ok(codeql.jobs?.["slack-notify-preflight-blocked"]?.needs?.includes("kill-switch-preflight"));

  const checkout = analyze.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.match(checkout?.with?.ref ?? "", /merge_commit_sha/);
  assert.equal(checkout?.with?.["persist-credentials"], false);
  assert.equal(checkout?.with?.["allow-unsafe-pr-checkout"], true);

  const init = analyze.steps.find((step) => step.uses?.startsWith("github/codeql-action/init@"));
  const upload = analyze.steps.find((step) => step.uses?.startsWith("github/codeql-action/analyze@"));
  assert.equal(init?.with?.["build-mode"], "none");
  assert.match(upload?.with?.ref ?? "", /refs\/pull\/\{0\}\/merge/);
  assert.match(upload?.with?.sha ?? "", /merge_commit_sha/);
});
