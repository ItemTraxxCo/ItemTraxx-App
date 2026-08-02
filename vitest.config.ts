import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Standalone from vite.config.ts on purpose: the app's Vite config wires up
// the Cloudflare plugin and git-commit shell-outs that unit tests don't need
// and that slow every test run down.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    // jsdom has no IndexedDB implementation; fake-indexeddb/auto installs a
    // real (in-memory) one on the global object so offline-storage code that
    // uses window.indexedDB can be tested against actual IDB semantics.
    setupFiles: ["fake-indexeddb/auto", "./src/test/setupStorage.ts"],
    include: ["src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/*.d.ts",
        "src/e2e/**",
        "src/main.ts",
      ],
    },
  },
});
