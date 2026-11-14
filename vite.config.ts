import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import vue from "@vitejs/plugin-vue";

import { cloudflare } from "@cloudflare/vite-plugin";

const initialModuleMapPlugin = (): Plugin => ({
  name: "itemtraxx-initial-module-map",
  apply: "build" as const,
  writeBundle(_options, bundle) {
    const moduleMap: Record<string, string[]> = {};
    for (const output of Object.values(bundle)) {
      if (output.type === "chunk" && output.fileName.endsWith(".js")) {
        moduleMap[output.fileName.replace(/^assets\//, "")] = Object.keys(
          output.modules
        ).sort();
      }
    }
    const artifactsDir = resolve("artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      resolve(artifactsDir, "initial-module-map.json"),
      `${JSON.stringify(moduleMap, null, 2)}\n`
    );
  },
});

const disableRocketLoaderPlugin = (): Plugin => ({
  name: "itemtraxx-disable-rocket-loader",
  apply: "build" as const,
  transformIndexHtml(html) {
    // Cloudflare Rocket Loader rewrites every <script> tag's type attribute
    // (including type="module") to defer execution through its own async
    // loader, discarding the browser's native module timing guarantees.
    // data-cfasync="false" opts a script out of that rewrite; theme-init.js
    // already carries it — do the same for Vite's generated entry script so
    // the app boots with predictable, native module-script timing.
    return html.replace(
      /(<script\s+type="module"\s+crossorigin\s+src="[^"]+")>/,
      '$1 data-cfasync="false">'
    );
  },
});

// Emits /version.json so the client can detect a newer deploy from our own
// origin instead of calling the GitHub API from every visitor's browser.
const versionManifestPlugin = (commit: string): Plugin => ({
  name: "itemtraxx-version-manifest",
  apply: "build" as const,
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: `${JSON.stringify({ sha: commit, builtAt: new Date().toISOString() })}\n`,
    });
  },
});

const resolveBuildCommit = (env: Record<string, string>) => {
  const vercelCommit = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercelCommit) {
    return vercelCommit.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "n/a";
  }
};

const resolveBuildBranch = (env: Record<string, string>) => {
  const vercelBranch = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (vercelBranch) {
    return vercelBranch;
  }
  try {
    return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  } catch {
    return "n/a";
  }
};

// Absolute URL for the Organization JSON-LD logo in index.html when the
// deployment does not provide VITE_LOGO_URL (CI builds, Playwright's dev
// server, fresh checkouts). Without it Vite warns on every index.html
// transform and ships the literal %VITE_LOGO_URL% placeholder.
const DEFAULT_LOGO_URL = "https://itemtraxx.com/brand/logo-mark.svg";

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env: Record<string, string> = {
    ...loadEnv(mode, process.cwd()),
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? "",
  };
  const gitCommit = resolveBuildCommit(env);
  const gitBranch = resolveBuildBranch(env);
  const logoUrl = env.VITE_LOGO_URL?.trim() || DEFAULT_LOGO_URL;

  if (
    command === "build" &&
    mode === "production" &&
    env.VITE_E2E_TEST_UTILS === "true"
  ) {
    throw new Error("VITE_E2E_TEST_UTILS cannot be enabled for production builds.");
  }

  return {
    plugins: [
      vue(),
      ...(env.VITE_E2E_TEST_UTILS === "true"
        ? []
        : [
            cloudflare({
              experimental: { headersAndRedirectsDevModeSupport: true },
            }),
          ]),
      initialModuleMapPlugin(),
      disableRocketLoaderPlugin(),
      versionManifestPlugin(gitCommit),
    ],
    // Keep the registry import and the Vue adapter on the same module graph;
    // pre-bundling the package root separately would create two bone registries
    // during dev capture/runtime.
    optimizeDeps: {
      exclude: ["boneyard-js"],
    },
    // Keep production maps available for PostHog Error Tracking upload while
    // omitting sourceMappingURL comments so the maps are not served publicly.
    build: {
      sourcemap: "hidden",
    },
    server:
      process.env.VITE_E2E_TEST_UTILS === "true"
        ? { allowedHosts: ["127.0.0.1.nip.io"] }
        : undefined,
    define: {
      "import.meta.env.VITE_GIT_COMMIT": JSON.stringify(gitCommit),
      "import.meta.env.VITE_GIT_BRANCH": JSON.stringify(gitBranch),
      // Vite's %VITE_*% HTML replacement also reads import.meta.env defines,
      // so this one entry feeds both index.html and application code.
      "import.meta.env.VITE_LOGO_URL": JSON.stringify(logoUrl),
    },
  };
});
