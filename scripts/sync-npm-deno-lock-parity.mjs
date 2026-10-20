import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const baseSha = process.env.DENO_LOCK_SYNC_BASE_SHA;
const fixMismatches = process.argv.includes("--fix");
const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies"];

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

function setWorkflowOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function describeMismatches(structuralMismatches, versionMismatches) {
  const messages = [
    ...structuralMismatches,
    ...versionMismatches.map(({ packageName, npmVersion, denoVersion, workspaceSpecifier }) =>
      `${packageName}: package-lock.json=${npmVersion}, deno.lock=${denoVersion} (${workspaceSpecifier})`
    ),
  ];

  console.error("::error::Changed direct npm dependencies do not match their Deno lock resolutions:");
  for (const mismatch of messages) console.error(`  - ${mismatch}`);
  console.error("Pin the intended package versions in package.json, then regenerate package-lock.json and deno.lock.");
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
  if (fixMismatches) setWorkflowOutput("fixed", "false");
  process.exit(0);
}

const workspaceDependencies = denoLock.workspace?.packageJson?.dependencies;
if (!Array.isArray(workspaceDependencies)) {
  fail("deno.lock is missing workspace.packageJson.dependencies.");
}

const structuralMismatches = [];
const versionMismatches = [];

for (const packageName of changedDirectDependencies.sort()) {
  const npmVersion = resolvedNpmVersion(currentLockfile, packageName);
  const packageRange = currentDependencies[packageName];
  const packageSpecifiers = workspaceDependencies.filter(
    (specifier) => npmSpecifierPackageName(specifier) === packageName,
  );

  if (!npmVersion) {
    structuralMismatches.push(`${packageName}: package-lock.json has no resolved direct package version`);
    continue;
  }

  const exactWorkspaceSpecifier = `npm:${packageName}@${packageRange}`;
  const exactMatches = packageSpecifiers.filter((specifier) => specifier === exactWorkspaceSpecifier);
  const workspaceSpecifier = exactMatches.length === 1
    ? exactMatches[0]
    : exactMatches.length === 0 && packageSpecifiers.length === 1
    ? packageSpecifiers[0]
    : undefined;

  if (!workspaceSpecifier) {
    const detail = packageSpecifiers.length === 0
      ? "no Deno workspace specifier"
      : `cannot uniquely match root range ${packageRange} to Deno workspace specifier(s): ${packageSpecifiers.join(", ")}`;
    structuralMismatches.push(`${packageName}: package-lock.json=${npmVersion}, ${detail} in deno.lock`);
    continue;
  }

  const denoResolution = denoLock.specifiers?.[workspaceSpecifier];
  const denoVersion = typeof denoResolution === "string"
    ? denoResolution.split("_", 1)[0]
    : undefined;

  if (!denoVersion) {
    structuralMismatches.push(`${packageName}: deno.lock has no resolution for ${workspaceSpecifier}`);
    continue;
  }

  if (npmVersion !== denoVersion) {
    versionMismatches.push({ packageName, npmVersion, denoVersion, workspaceSpecifier });
  }
}

if (fixMismatches && structuralMismatches.length > 0) {
  describeMismatches(structuralMismatches, versionMismatches);
  process.exit(1);
}

if (fixMismatches && versionMismatches.length > 0) {
  const lockfileRoot = currentLockfile.packages?.[""];
  if (!lockfileRoot) fail("package-lock.json is missing its root packages entry.");

  const pins = [];
  for (const { packageName, npmVersion } of versionMismatches) {
    const manifestGroups = dependencyGroups.filter((group) =>
      Object.hasOwn(currentManifest[group] ?? {}, packageName)
    );
    const lockfileGroups = dependencyGroups.filter((group) =>
      Object.hasOwn(lockfileRoot[group] ?? {}, packageName)
    );

    if (manifestGroups.length !== 1 || lockfileGroups.length !== 1) {
      structuralMismatches.push(
        `${packageName}: cannot safely update the package.json and package-lock.json root dependency entries`,
      );
      continue;
    }

    pins.push({ packageName, npmVersion, manifestGroup: manifestGroups[0], lockfileGroup: lockfileGroups[0] });
  }

  if (structuralMismatches.length > 0) {
    describeMismatches(structuralMismatches, versionMismatches);
    process.exit(1);
  }

  for (const { packageName, npmVersion, manifestGroup, lockfileGroup } of pins) {
    currentManifest[manifestGroup][packageName] = npmVersion;
    lockfileRoot[lockfileGroup][packageName] = npmVersion;
  }

  writeFileSync("package.json", `${JSON.stringify(currentManifest, null, 2)}\n`);
  writeFileSync("package-lock.json", `${JSON.stringify(currentLockfile, null, 2)}\n`);
  setWorkflowOutput("fixed", "true");
  console.log(
    `Pinned changed direct dependencies to npm lock versions: ${pins.map(({ packageName, npmVersion }) => `${packageName}=${npmVersion}`).join(", ")}.`,
  );
  process.exit(0);
}

if (structuralMismatches.length > 0 || versionMismatches.length > 0) {
  describeMismatches(structuralMismatches, versionMismatches);
  process.exit(1);
}

if (fixMismatches) setWorkflowOutput("fixed", "false");

console.log(
  `Deno/npm version parity verified for ${changedDirectDependencies.length} changed direct dependencies.`,
);
