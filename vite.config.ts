import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const VERSION_REPO_URL = "https://github.com/ItemTraxxCo/ItemTraxx-App";

const gitCommit = (() => {
  try {
    const lsRemote = execSync(`git ls-remote ${VERSION_REPO_URL} HEAD`)
      .toString()
      .trim();
    const fullHash = lsRemote.split(/\s+/)[0] ?? "";
    if (fullHash.length >= 7) {
      return fullHash.slice(0, 7);
    }
  } catch {
    // fallback to local repo hash below
  }

  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "n/a";
  }
})();

// https://vite.dev/config/
export default defineConfig({
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
});
