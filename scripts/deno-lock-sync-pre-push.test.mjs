import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const prePushHook = new URL("./deno-lock-sync-pre-push.sh", import.meta.url);
const expectedHead = "a".repeat(40);
const pushHead = "b".repeat(40);

function runHook({ input, env = {} }) {
  const directory = mkdtempSync(join(tmpdir(), "itx-deno-lock-hook-"));
  try {
    const binDirectory = join(directory, "bin");
    mkdirSync(binDirectory);
    const fakeGit = join(binDirectory, "git");
    writeFileSync(
      fakeGit,
      `#!/bin/sh\nif [ "$1" = "rev-parse" ] && [ "$2" = "--verify" ] && [ "$3" = "HEAD^{commit}" ]; then\n  printf '%s\\n' "$EXPECTED_PUSH_SHA"\nelse\n  exit 99\nfi\n`,
    );
    chmodSync(fakeGit, 0o700);

    return spawnSync("bash", [prePushHook.pathname, "origin", "https://example.invalid/ItemTraxx-App.git"], {
      encoding: "utf8",
      input,
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        EXPECTED_HEAD_SHA: expectedHead,
        EXPECTED_PUSH_SHA: pushHead,
        SYNC_BRANCH: "dependabot/npm_and_yarn/example-1.2.3",
        ...env,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("pre-push hook permits only the validated single-ref update from the expected PR head", () => {
  const result = runHook({
    input: `HEAD ${pushHead} refs/heads/dependabot/npm_and_yarn/example-1.2.3 ${expectedHead}\n`,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("pre-push hook rejects a branch that was rewound or deleted before push discovery", () => {
  for (const remoteSha of ["c".repeat(40), "0".repeat(40)]) {
    const result = runHook({
      input: `HEAD ${pushHead} refs/heads/dependabot/npm_and_yarn/example-1.2.3 ${remoteSha}\n`,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /branch changed before the push/);
  }
});

test("pre-push hook rejects unexpected refs, local commits, and multiple updates", () => {
  const invalidUpdates = [
    `HEAD ${pushHead} refs/heads/main ${expectedHead}\n`,
    `HEAD ${"c".repeat(40)} refs/heads/dependabot/npm_and_yarn/example-1.2.3 ${expectedHead}\n`,
    `HEAD ${pushHead} refs/heads/dependabot/npm_and_yarn/example-1.2.3 ${expectedHead}\nHEAD ${pushHead} refs/heads/another ${expectedHead}\n`,
  ];

  for (const input of invalidUpdates) {
    const result = runHook({ input });
    assert.notEqual(result.status, 0);
  }
});
