import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseSha = process.env.DENO_LOCK_SYNC_BASE_SHA;

if (!/^[a-f0-9]{40}$/i.test(baseSha ?? "")) {
  fail("DENO_LOCK_SYNC_BASE_SHA must be the 40-character PR base commit SHA.");
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function parseJson(contents, label) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    fail(`Could not parse ${label}: ${error.message}`);
  }
}

function readBaseFile(path) {
  try {
    return execFileSync("git", ["show", `${baseSha}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    fail(`Could not read ${path} from PR base ${baseSha}.`);
  }
}

function directDependencies(manifest) {
  return {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
}

function resolvedNpmVersion(lockfile, packageName) {
  return lockfile.packages?.[`node_modules/${packageName}`]?.version;
}

function npmSpecifierPackageName(specifier) {
  if (!specifier.startsWith("npm:")) return null;

  const packageSpecifier = specifier.slice("npm:".length);
  const versionSeparator = packageSpecifier.startsWith("@")
    ? packageSpecifier.indexOf("@", packageSpecifier.indexOf("/") + 1)
    : packageSpecifier.indexOf("@");

  if (versionSeparator < 1) return null;
  return packageSpecifier.slice(0, versionSeparator);
}

const baseManifest = parseJson(readBaseFile("package.json"), "base package.json");
const baseLockfile = parseJson(readBaseFile("package-lock.json"), "base package-lock.json");
const currentManifest = parseJson(readFileSync("package.json", "utf8"), "package.json");
const currentLockfile = parseJson(readFileSync("package-lock.json", "utf8"), "package-lock.json");
const denoLock = parseJson(readFileSync("deno.lock", "utf8"), "deno.lock");

const baseDependencies = directDependencies(baseManifest);
const currentDependencies = directDependencies(currentManifest);
const changedDirectDependencies = Object.keys(currentDependencies).filter((packageName) => {
  const manifestRangeChanged = baseDependencies[packageName] !== currentDependencies[packageName];
  const npmResolutionChanged =
    resolvedNpmVersion(baseLockfile, packageName) !== resolvedNpmVersion(currentLockfile, packageName);

  return manifestRangeChanged || npmResolutionChanged;
});

if (changedDirectDependencies.length === 0) {
  console.log("No changed root npm dependencies to compare with deno.lock.");
  process.exit(0);
}

const workspaceDependencies = denoLock.workspace?.packageJson?.dependencies;
if (!Array.isArray(workspaceDependencies)) {
  fail("deno.lock is missing workspace.packageJson.dependencies.");
}

const mismatches = [];

for (const packageName of changedDirectDependencies.sort()) {
  const npmVersion = resolvedNpmVersion(currentLockfile, packageName);
  const workspaceSpecifiers = workspaceDependencies.filter(
    (specifier) => npmSpecifierPackageName(specifier) === packageName,
  );

  if (!npmVersion) {
    mismatches.push(`${packageName}: package-lock.json has no resolved direct package version`);
    continue;
  }

  if (workspaceSpecifiers.length !== 1) {
    const detail = workspaceSpecifiers.length === 0
      ? "no Deno workspace specifier"
      : `${workspaceSpecifiers.length} Deno workspace specifiers`;
    mismatches.push(`${packageName}: package-lock.json=${npmVersion}, ${detail} in deno.lock`);
    continue;
  }

  const [workspaceSpecifier] = workspaceSpecifiers;
  const denoResolution = denoLock.specifiers?.[workspaceSpecifier];
  const denoVersion = typeof denoResolution === "string"
    ? denoResolution.split("_", 1)[0]
    : undefined;

  if (!denoVersion) {
    mismatches.push(`${packageName}: deno.lock has no resolution for ${workspaceSpecifier}`);
    continue;
  }

  if (npmVersion !== denoVersion) {
    mismatches.push(
      `${packageName}: package-lock.json=${npmVersion}, deno.lock=${denoVersion} (${workspaceSpecifier})`,
    );
  }
}

if (mismatches.length > 0) {
  console.error("::error::Changed direct npm dependencies do not match their Deno lock resolutions:");
  for (const mismatch of mismatches) console.error(`  - ${mismatch}`);
  console.error("Pin the intended package versions in package.json, then regenerate package-lock.json and deno.lock.");
  process.exit(1);
}

console.log(
  `Deno/npm version parity verified for ${changedDirectDependencies.length} changed direct dependencies.`,
);
