import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const distDirectory = resolve(
  process.env.POSTHOG_SOURCEMAP_DIRECTORY?.trim() || "dist",
);
const projectId = process.env.POSTHOG_CLI_PROJECT_ID?.trim();
const apiKey = process.env.POSTHOG_CLI_API_KEY?.trim();

const removeSourceMaps = (directory) => {
  if (!existsSync(directory)) return 0;
  let removed = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      removed += removeSourceMaps(entryPath);
    } else if (entry.name.endsWith(".map")) {
      unlinkSync(entryPath);
      removed += 1;
    }
  }
  return removed;
};

// Source-map credentials are intentionally optional for local builds and
// pull-request validation. Production deploys should provide them through the
// Vercel/CI secret store, never through a VITE_* variable or checked-in file.
if (!projectId || !apiKey) {
  const removed = removeSourceMaps(distDirectory);
  console.info(
    `[posthog] source-map upload skipped; POSTHOG_CLI_PROJECT_ID/API_KEY are not configured. Removed ${removed} local map file(s).`,
  );
  process.exit(0);
}

if (!existsSync(distDirectory)) {
  throw new Error(`[posthog] source-map directory does not exist: ${distDirectory}`);
}

const resolveReleaseVersion = () => {
  const explicit = process.env.POSTHOG_CLI_RELEASE_VERSION?.trim();
  if (explicit) return explicit;

  // Vite exposes the same short commit as VITE_GIT_COMMIT at runtime. Keep
  // the uploaded release version identical to the value in captured events.
  const viteCommit = process.env.VITE_GIT_COMMIT?.trim();
  if (viteCommit) return viteCommit.slice(0, 128);

  const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercelCommit) return vercelCommit.slice(0, 7);

  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  });
  if (!git.error && git.status === 0) {
    const commit = git.stdout.trim();
    if (commit) return commit.slice(0, 128);
  }
  return undefined;
};

const releaseVersion = resolveReleaseVersion();
if (!releaseVersion) {
  throw new Error(
    "[posthog] source-map upload requires POSTHOG_CLI_RELEASE_VERSION or a git commit.",
  );
}

const releaseName = process.env.POSTHOG_CLI_RELEASE_NAME?.trim() || "itemtraxx-web";

const runCli = (args) => {
  const command = process.env.POSTHOG_CLI_BIN?.trim() || "posthog-cli";
  let result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  // CI images may not have the global binary. Use the published package as a
  // fallback without adding a runtime dependency to the browser bundle.
  if (result.error?.code === "ENOENT" && command === "posthog-cli") {
    result = spawnSync("npx", ["--yes", "@posthog/cli", ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
  }

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`[posthog] CLI exited with status ${result.status ?? "unknown"}.`);
  }
};

runCli(["sourcemap", "inject", "--directory", distDirectory]);
runCli([
  "sourcemap",
  "upload",
  "--directory",
  distDirectory,
  "--release-name",
  releaseName,
  "--release-version",
  releaseVersion,
  "--delete-after",
]);

console.info(`[posthog] uploaded source maps for ${releaseName}@${releaseVersion}.`);
