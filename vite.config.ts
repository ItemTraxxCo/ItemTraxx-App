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

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env: Record<string, string> = {
    ...loadEnv(mode, process.cwd()),
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? "",
  };
  const gitCommit = resolveBuildCommit(env);
  const gitBranch = resolveBuildBranch(env);

  if (
    command === "build" &&
    mode === "production" &&
    env.VITE_E2E_TEST_UTILS === "true"
  ) {
    throw new Error("VITE_E2E_TEST_UTILS cannot be enabled for production builds.");
  }

  return {
    plugins: [vue(), cloudflare(), initialModuleMapPlugin()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("@supabase/supabase-js")) return "vendor-supabase";
              if (id.includes("vue") || id.includes("vue-router")) return "vendor-vue";
              if (id.includes("jspdf-autotable")) return "vendor-jspdf-autotable";
              if (id.includes("jspdf")) return "vendor-jspdf";
              if (id.includes("jsbarcode")) return "vendor-jsbarcode";
            }
            return undefined;
          },
        },
      },
    },
    define: {
      "import.meta.env.VITE_GIT_COMMIT": JSON.stringify(gitCommit),
      "import.meta.env.VITE_GIT_BRANCH": JSON.stringify(gitBranch),
    },
  };
});
