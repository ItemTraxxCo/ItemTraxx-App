import { execSync } from "node:child_process";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

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

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const gitCommit = resolveBuildCommit(env);

  if (
    command === "build" &&
    mode === "production" &&
    env.VITE_E2E_TEST_UTILS === "true"
  ) {
    throw new Error("VITE_E2E_TEST_UTILS cannot be enabled for production builds.");
  }

  return {
    plugins: [vue()],
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
    },
  };
});
