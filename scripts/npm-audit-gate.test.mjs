import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pathWithoutDependencyBins } from "./security-exec.mjs";

const gatePath = fileURLToPath(new URL("./npm-audit-gate.mjs", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

const runGate = ({ stdout, stderr = "", exitCode = 0, minSeverity = "moderate" }) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "itx-npm-audit-gate-"));
  try {
    const dependencyBinDirectory = join(tempDirectory, "node_modules", ".bin");
    mkdirSync(dependencyBinDirectory, { recursive: true });
    const shadowMarkerPath = join(tempDirectory, "shadow-command-ran");
    const fakeNpmPath = join(dependencyBinDirectory, "npm");
    const fakeNodePath = join(dependencyBinDirectory, "node");
    const fakeBashPath = join(dependencyBinDirectory, "bash");
    const fakeNpmCliPath = join(tempDirectory, "npm-cli.mjs");
    writeFileSync(
      fakeNpmPath,
      [
        "#!/bin/sh",
        "printf 'shadow npm invoked' > \"$ITX_TEST_SHADOW_MARKER\"",
        "exit 99",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    chmodSync(fakeNpmPath, 0o700);
    for (const fakePath of [fakeNodePath, fakeBashPath]) {
      writeFileSync(
        fakePath,
        `#!/bin/sh\nprintf 'shadow command invoked' > "$ITX_TEST_SHADOW_MARKER"\nexit 99\n`,
        { mode: 0o700 },
      );
      chmodSync(fakePath, 0o700);
    }
    writeFileSync(
      fakeNpmCliPath,
      [
        "process.stdout.write(process.env.ITX_TEST_NPM_STDOUT ?? '');",
        "process.stderr.write(process.env.ITX_TEST_NPM_STDERR ?? '');",
        "process.exit(Number(process.env.ITX_TEST_NPM_EXIT_CODE ?? 0));",
        "",
      ].join("\n"),
    );

    return spawnSync(process.execPath, [gatePath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dependencyBinDirectory}${delimiter}${process.env.PATH ?? ""}`,
        npm_execpath: fakeNpmCliPath,
        npm_node_execpath: process.execPath,
        ITX_TEST_SHADOW_MARKER: shadowMarkerPath,
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

test("npm and Node dependency-bin shims cannot replace the audit executable", () => {
  const result = runGate({ stdout: report({}) });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /npm audit gate passed with no vulnerabilities/);
  assert.equal(result.stderr, "");
});

test("security package scripts use npm's absolute Node path without shell or npm recursion", () => {
  const scripts = JSON.parse(readFileSync(packageJsonPath, "utf8")).scripts;

  for (const name of ["security:audit", "security:gate"]) {
    assert.match(scripts[name], /^\"\$npm_node_execpath\" \.\/scripts\//);
    assert.doesNotMatch(scripts[name], /(?:^|\s)(?:node|npm|bash)(?:\s|$)/);
  }
});

test("dependency-installed executable directories are removed from helper PATH", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "itx-security-path-"));
  try {
    const dependencyBinDirectory = join(tempDirectory, "node_modules", ".bin");
    const trustedBinDirectory = join(tempDirectory, "trusted-bin");
    mkdirSync(dependencyBinDirectory, { recursive: true });
    mkdirSync(trustedBinDirectory, { recursive: true });
    const shadowMarkerPath = join(tempDirectory, "shadow-deno-ran");
    const trustedMarkerPath = join(tempDirectory, "trusted-deno-ran");
    const fakeDenoPath = join(dependencyBinDirectory, "deno");
    const trustedDenoPath = join(trustedBinDirectory, "deno");
    writeFileSync(
      fakeDenoPath,
      `#!/bin/sh\nprintf 'shadow deno invoked' > "${shadowMarkerPath}"\nexit 99\n`,
      { mode: 0o700 },
    );
    writeFileSync(
      trustedDenoPath,
      `#!/bin/sh\nprintf 'trusted deno invoked' > "${trustedMarkerPath}"\nexit 0\n`,
      { mode: 0o700 },
    );
    chmodSync(fakeDenoPath, 0o700);
    chmodSync(trustedDenoPath, 0o700);
    const filtered = pathWithoutDependencyBins(
      `${dependencyBinDirectory}${delimiter}${trustedBinDirectory}`,
    );

    assert.doesNotMatch(filtered, /node_modules[\\/]+\.bin/);
    assert.equal(filtered, trustedBinDirectory);
    const result = spawnSync("deno", ["--version"], {
      encoding: "utf8",
      env: { ...process.env, PATH: filtered },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(existsSync(shadowMarkerPath), false);
    assert.equal(existsSync(trustedMarkerPath), true);
    assert.doesNotMatch(`${result.stdout ?? ""}${result.stderr ?? ""}`, /shadow deno invoked/);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

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
