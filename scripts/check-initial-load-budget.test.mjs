import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  MAX_INITIAL_GZIP_BYTES,
  MAX_INITIAL_MINIFIED_BYTES,
  measureInitialLoad,
  shouldFailInitialLoad,
} from "./check-initial-load-budget.mjs";

const validInitialLoadResult = () => ({
  assets: [],
  minifiedBytes: MAX_INITIAL_MINIFIED_BYTES,
  gzipBytes: MAX_INITIAL_GZIP_BYTES,
  forbiddenModules: [],
  moduleMapPresent: true,
});

test("measures the unique entry and static modulepreload closure", () => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-initial-load-"));
  const assetsDir = join(root, "assets");
  mkdirSync(assetsDir);
  writeFileSync(join(assetsDir, "index-1.js"), "export const entry = true;");
  writeFileSync(join(assetsDir, "vue-1.js"), "export const vue = true;");
  writeFileSync(join(assetsDir, "router-1.js"), "export const router = true;");
  writeFileSync(
    join(root, "index.html"),
    '<script type="module" src="/assets/index-1.js"></script>' +
      '<link rel="modulepreload" href="/assets/vue-1.js">' +
      '<link rel="modulepreload" href="/assets/router-1.js">' +
      '<link rel="modulepreload" href="/assets/vue-1.js">'
  );

  try {
    const result = measureInitialLoad({ htmlPath: join(root, "index.html"), assetsDir });
    assert.deepEqual(result.assets, ["index-1.js", "router-1.js", "vue-1.js"]);
    assert.equal(result.minifiedBytes, 77);
    assert.equal(
      result.gzipBytes,
      [
        "export const entry = true;",
        "export const vue = true;",
        "export const router = true;",
      ].reduce((total, source) => total + gzipSync(source).byteLength, 0)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("counts query-bearing assets and deduplicates fragment variants", () => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-initial-load-"));
  const assetsDir = join(root, "assets");
  mkdirSync(assetsDir);
  writeFileSync(join(assetsDir, "app.js"), "x");
  writeFileSync(
    join(root, "index.html"),
    '<script type="module" src="/assets/app.js?v=1"></script>' +
      '<link rel="modulepreload" href="/assets/app.js#fragment">'
  );

  try {
    const result = measureInitialLoad({ htmlPath: join(root, "index.html"), assetsDir });
    assert.deepEqual(result.assets, ["app.js"]);
    assert.equal(result.minifiedBytes, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validates the full initial asset attribute before suffix stripping", () => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-initial-load-"));
  const assetsDir = join(root, "assets");
  mkdirSync(assetsDir);
  writeFileSync(
    join(root, "index.html"),
    '<script type="module" src="/assets/styles.css?redirect=escape.js&cache=1"></script>'
  );

  try {
    assert.throws(
      () => measureInitialLoad({ htmlPath: join(root, "index.html"), assetsDir }),
      /unsafe initial asset reference/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects references outside the generated assets directory", () => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-initial-load-"));
  const assetsDir = join(root, "assets");
  mkdirSync(assetsDir);
  writeFileSync(
    join(root, "index.html"),
    '<script type="module" src="/assets/../escape.js?v=1"></script>'
  );
  try {
    assert.throws(
      () => measureInitialLoad({ htmlPath: join(root, "index.html"), assetsDir }),
      /unsafe initial asset reference/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports forbidden SDK modules in the static closure", () => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-initial-load-"));
  const assetsDir = join(root, "assets");
  const moduleMapPath = join(root, "initial-module-map.json");
  mkdirSync(assetsDir);
  writeFileSync(join(assetsDir, "index-1.js"), "export const entry = true;");
  writeFileSync(join(root, "index.html"), '<script type="module" src="/assets/index-1.js"></script>');
  writeFileSync(moduleMapPath, JSON.stringify({
    "index-1.js": [
      "/repo/src/main.ts",
      "/repo/node_modules/@supabase/supabase-js/dist/module/index.js",
    ],
  }));
  try {
    const result = measureInitialLoad({ htmlPath: join(root, "index.html"), assetsDir, moduleMapPath });
    assert.deepEqual(result.forbiddenModules, [{
      asset: "index-1.js",
      module: "/repo/node_modules/@supabase/supabase-js/dist/module/index.js",
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not fail report-only mode when enforcement conditions are present", () => {
  const result = {
    ...validInitialLoadResult(),
    minifiedBytes: MAX_INITIAL_MINIFIED_BYTES + 1,
    gzipBytes: MAX_INITIAL_GZIP_BYTES + 1,
    forbiddenModules: [{ asset: "entry.js", module: "/node_modules/jspdf/index.js" }],
    moduleMapPresent: false,
  };

  assert.equal(shouldFailInitialLoad(result, { reportOnly: true }), false);
});

test("fails enforcing mode when the module map is missing", () => {
  assert.equal(
    shouldFailInitialLoad({ ...validInitialLoadResult(), moduleMapPresent: false }),
    true
  );
});

test("fails enforcing mode when a forbidden module is present", () => {
  assert.equal(
    shouldFailInitialLoad({
      ...validInitialLoadResult(),
      forbiddenModules: [{ asset: "entry.js", module: "/node_modules/jspdf/index.js" }],
    }),
    true
  );
});

test("fails enforcing mode when either byte budget is exceeded", () => {
  assert.equal(
    shouldFailInitialLoad({
      ...validInitialLoadResult(),
      minifiedBytes: MAX_INITIAL_MINIFIED_BYTES + 1,
    }),
    true
  );
  assert.equal(
    shouldFailInitialLoad({
      ...validInitialLoadResult(),
      gzipBytes: MAX_INITIAL_GZIP_BYTES + 1,
    }),
    true
  );
});

test("allows enforcing mode at the exact byte thresholds", () => {
  assert.equal(shouldFailInitialLoad(validInitialLoadResult()), false);
});
