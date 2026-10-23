import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const patchVitestLexerCompatibility = () => {
  const require = createRequire(import.meta.url);
  const lexerEntry = require.resolve("es-module-lexer");
  const lexerPackagePath = join(dirname(lexerEntry), "..", "package.json");
  const lexerVersion = JSON.parse(readFileSync(lexerPackagePath, "utf8")).version as string;
  const lexerMajor = Number.parseInt(lexerVersion.split(".")[0] ?? "0", 10);

  // Vitest 5 still imports the removed v2 `initSync` API. The v3 parser
  // initializes itself on the first synchronous parse, so remove only that
  // stale initialization call from the installed Vitest worker chunk. Keep
  // this local and idempotent until Vitest publishes native v3 support.
  if (lexerMajor < 3) {
    return;
  }

  const vitestPackageDir = dirname(require.resolve("vitest"));
  const vitestDist = join(vitestPackageDir, "dist");
  const candidateDirs = [vitestDist, join(vitestDist, "chunks")];
  const importPattern = "import { initSync, parse } from 'es-module-lexer';";
  const initBlockPattern = /if \(!lexerInitialized\) \{\s*initSync\(\);\s*lexerInitialized = true;\s*\}/;

  for (const directory of candidateDirs) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) {
        continue;
      }

      const filePath = join(directory, entry.name);
      const source = readFileSync(filePath, "utf8");
      if (!source.includes(importPattern)) {
        continue;
      }

      const withoutStaleImport = source.replace(
        importPattern,
        "import { parse } from 'es-module-lexer';",
      );
      const patched = withoutStaleImport.replace(
        initBlockPattern,
        "if (!lexerInitialized) lexerInitialized = true;",
      );
      if (patched === withoutStaleImport) {
        throw new Error(
          `Could not patch Vitest's es-module-lexer initialization in ${filePath}`,
        );
      }
      if (patched !== source) {
        writeFileSync(filePath, patched, "utf8");
      }
    }
  }
};

patchVitestLexerCompatibility();

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
