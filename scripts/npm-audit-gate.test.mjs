import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const gatePath = fileURLToPath(new URL("./npm-audit-gate.mjs", import.meta.url));

const runGate = ({ stdout, stderr = "", exitCode = 0, minSeverity = "moderate" }) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "itx-npm-audit-gate-"));
  try {
    const fakeNpmPath = join(tempDirectory, "npm");
    writeFileSync(
      fakeNpmPath,
      [
        "#!/bin/sh",
        "printf '%s' \"$ITX_TEST_NPM_STDOUT\"",
        "printf '%s' \"$ITX_TEST_NPM_STDERR\" >&2",
        "exit \"$ITX_TEST_NPM_EXIT_CODE\"",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    chmodSync(fakeNpmPath, 0o700);

    return spawnSync(process.execPath, [gatePath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${tempDirectory}${delimiter}${process.env.PATH ?? ""}`,
        ITX_AUDIT_MIN_SEVERITY: minSeverity,
        ITX_TEST_NPM_EXIT_CODE: String(exitCode),
        ITX_TEST_NPM_STDERR: stderr,
        ITX_TEST_NPM_STDOUT: stdout,
      },
    });
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
};

const report = (vulnerabilities) => JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: {
    vulnerabilities: Object.fromEntries(
      ["info", "low", "moderate", "high", "critical"].map((severity) => [
        severity,
        Object.values(vulnerabilities).filter((item) => item.severity === severity).length,
      ]).concat([["total", Object.keys(vulnerabilities).length]]),
    ),
  },
});

test("npm audit transport errors fail closed with partial or complete empty JSON stdout", () => {
  for (const stdout of [JSON.stringify({ vulnerabilities: {} }), report({})]) {
    const result = runGate({
      stdout,
      stderr: "npm error audit endpoint returned an error: ENOTFOUND registry.npmjs.org\n",
      exitCode: 1,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm audit reported a registry or transport error/);
    assert.doesNotMatch(result.stdout, /npm audit gate passed/);
  }
});

test("a successful exit does not hide a reported audit transport error", () => {
  const result = runGate({
    stdout: report({}),
    stderr: "npm error audit endpoint returned an error: ENOTFOUND registry.npmjs.org\n",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm audit reported a registry or transport error/);
  assert.doesNotMatch(result.stdout, /npm audit gate passed/);
});

test("a complete report with findings still blocks at the configured threshold", () => {
  const result = runGate({
    stdout: report({
      vulnerable: { severity: "high", via: [{ source: 123, severity: "high", title: "Test advisory" }] },
    }),
    exitCode: 1,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Blocking vulnerabilities at or above 'moderate': 1/);
  assert.match(result.stderr, /vulnerable \(high\): Test advisory/);
});

test("a complete report below the configured threshold remains non-blocking", () => {
  const result = runGate({
    stdout: report({
      vulnerable: { severity: "low", via: [{ source: 123, severity: "low", title: "Low advisory" }] },
    }),
    exitCode: 1,
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /npm audit gate passed with no vulnerabilities at or above 'moderate'/);
});

test("malformed vulnerability records fail closed instead of defaulting to info", () => {
  for (const vulnerability of [
    { via: [{ source: 123, severity: "high", title: "Missing package severity" }] },
    { severity: "unrecognized", via: [{ source: 123, severity: "high", title: "Unknown severity" }] },
  ]) {
    const result = runGate({
      stdout: report({ vulnerable: vulnerability }),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm audit returned an incomplete or invalid report/);
    assert.doesNotMatch(result.stdout, /npm audit gate passed/);
  }
});
