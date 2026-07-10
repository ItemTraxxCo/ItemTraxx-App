# Baseline, Landing Performance, and Dead-Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase the cleanup sprint on current `origin/main`, make the canonical landing route independent of authenticated/heavy SDKs, enforce the complete initial JavaScript preload budget, and remove only revalidated high-confidence dead code.

**Architecture:** Keep the public startup graph limited to Vue, router, public chrome, status, consent state, and a dependency-free HTTP session probe. Remove the current manual vendor graph so Vite 8/Rolldown can split by actual dynamic import boundaries. Measure the entry script plus every static modulepreload from `dist/index.html`; do not infer performance from chunk filenames.

**Tech Stack:** Vue 3, TypeScript, Vite 8/Rolldown, Node 22.15.0, Playwright, Deno, Cloudflare Workers, npm.

## Global Constraints

- Preserve checkout/return behavior, authentication redirects, canonical-host redirects, password-reset recovery, cookie-consent gating, tenant/district routing, and kill-switch behavior.
- Use `npm ci --ignore-scripts` for the CI-parity install and Node 22.15.0 for all Node commands.
- Never delete a Deno function, Worker entrypoint, shell-invoked script, public root asset, SQL file, or compatibility fallback solely because Knip reports it unused.
- Keep each commit limited to the named task. Run `git diff --check` and the narrow verification before every commit.
- If the merged `origin/main` contradicts an exact path or API below, stop that task, update this plan with the live equivalent, and commit the plan correction before implementation.

---

### Task 1: Merge the live baseline and prove it is healthy

**Files:**
- Verify: `.gitignore`
- Verify: `package.json`
- Verify: `package-lock.json`
- Verify: `deno.lock`
- Verify: `.github/workflows/ci-core.yml`

**Interfaces:**
- Consumes: `origin/main`, the two existing `.gitignore` commits on `dev/mmango10`.
- Produces: one merge commit with both upstream changes and the branch-specific ignore rules preserved.

- [ ] **Step 1: Confirm there are no uncommitted implementation changes**

Run:

```bash
git status --short --branch
git log --oneline --decorate -6
```

Expected: the only sprint changes are the approved design and plan documents; no source or generated-file changes are present.

- [ ] **Step 2: Fetch and inspect divergence**

Run:

```bash
git fetch --prune origin
git rev-list --left-right --count HEAD...origin/main
git diff --stat HEAD..origin/main
```

Expected: the divergence is explicit before merging. Do not use reset, rebase, or force-push.

- [ ] **Step 3: Merge `origin/main`**

Run:

```bash
git merge --no-ff origin/main
```

If `.gitignore` conflicts, retain the upstream file and both branch additions (`tmp/` and `.claude/`), remove conflict markers, then complete the merge with:

```bash
git add .gitignore
git commit
```

- [ ] **Step 4: Install exactly as CI installs**

Run with Node 22.15.0 active:

```bash
node --version
npm ci --ignore-scripts
```

Expected: `node --version` is `v22.15.0`; install exits 0 without changing the lockfile.

- [ ] **Step 5: Re-establish the merged baseline**

Run:

```bash
bash ./scripts/check-env-parity.sh
rm -rf dist artifacts
npm run build
npm run perf:budget
npm run perf:images
npm run perf:report
deno test --allow-env --frozen supabase/functions/_shared/*_test.ts
deno test --no-check --frozen cloudflare/edge-proxy/src/index_test.ts
npx playwright test
git status --short
```

Expected: all existing gates pass; Playwright reports at least the current 31 passing tests; `deno.lock` and the worktree remain unchanged. If `--frozen` is not supported by the merged Deno command, record that exact error and use `DENO_FROZEN=true` only after verifying it preserves the lockfile.

---

### Task 2: Add a test-driven initial-load closure analyzer

**Files:**
- Create: `scripts/check-initial-load-budget.mjs`
- Create: `scripts/check-initial-load-budget.test.mjs`
- Modify: `vite.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `dist/index.html`, local `dist/assets/*` files referenced by the entry module and `<link rel="modulepreload">` tags, and the build-only `artifacts/initial-module-map.json` emitted by Vite.
- Produces: `measureInitialLoad({ htmlPath, assetsDir, moduleMapPath }) -> { assets, minifiedBytes, gzipBytes, forbiddenModules, moduleMapPresent }`; CLI exit 1 when the closure exceeds 250,000 minified bytes or 100,000 gzip bytes, the module map is missing, or a forbidden heavy/authenticated SDK is in the static closure.

- [ ] **Step 1: Write the failing parser and budget tests**

Create a Node test that writes a temporary HTML file with one module script and two modulepreloads, asserts all three files are counted exactly once, asserts duplicate references are deduplicated, and asserts `../escape.js` is rejected.

```js
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { measureInitialLoad } from "./check-initial-load-budget.mjs";

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
    assert.ok(result.gzipBytes > 0);
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
    '<script type="module" src="/assets/../escape.js"></script>'
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
```

- [ ] **Step 2: Run the test and confirm it fails for the missing module**

Run:

```bash
node --test scripts/check-initial-load-budget.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `check-initial-load-budget.mjs`.

- [ ] **Step 3: Implement the analyzer**

Implement the module with this public surface and behavior:

```js
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_INITIAL_MINIFIED_BYTES = 250_000;
export const MAX_INITIAL_GZIP_BYTES = 100_000;
const SAFE_ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
const FORBIDDEN_INITIAL_MODULE_RE = /node_modules\/(?:jspdf|html2canvas|jsbarcode|posthog-js|@sentry|@supabase)\//;

const readAssetReferences = (html) => {
  const references = [];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.js)["'][^>]*>/gi)) {
    const tag = match[0];
    if (/^<script\b/i.test(tag) || /rel=["']modulepreload["']/i.test(tag)) {
      references.push(match[1]);
    }
  }
  return references;
};

const toSafeAssetName = (reference) => {
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  const match = withoutQuery.match(/^(?:\/|\.\/)?assets\/([^/]+)$/);
  const assetName = match?.[1] ?? "";
  if (!SAFE_ASSET_NAME_RE.test(assetName)) {
    throw new Error(`unsafe initial asset reference: ${reference}`);
  }
  return assetName;
};

const readModuleMap = (moduleMapPath) => {
  try {
    return JSON.parse(readFileSync(moduleMapPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
};

export const measureInitialLoad = ({
  htmlPath = resolve("dist/index.html"),
  assetsDir = resolve("dist/assets"),
  moduleMapPath = resolve("artifacts/initial-module-map.json"),
} = {}) => {
  const html = readFileSync(htmlPath, "utf8");
  const assets = [...new Set(readAssetReferences(html).map(toSafeAssetName))].sort();
  const moduleMap = readModuleMap(moduleMapPath);
  const totals = assets.reduce(
    (result, assetName) => {
      const assetPath = resolve(assetsDir, assetName);
      const bytes = readFileSync(assetPath);
      result.minifiedBytes += statSync(assetPath).size;
      result.gzipBytes += gzipSync(bytes).byteLength;
      return result;
    },
    { minifiedBytes: 0, gzipBytes: 0 }
  );
  const forbiddenModules = assets.flatMap((asset) =>
    (Array.isArray(moduleMap?.[asset]) ? moduleMap[asset] : [])
      .filter((module) => typeof module === "string" && FORBIDDEN_INITIAL_MODULE_RE.test(module))
      .map((module) => ({ asset, module }))
  );
  return { assets, ...totals, forbiddenModules, moduleMapPresent: moduleMap !== null };
};

const run = () => {
  const reportOnly = process.argv.includes("--report-only");
  const result = measureInitialLoad();
  console.log("[perf] Initial JavaScript closure", result);
  if (!reportOnly && (
    result.minifiedBytes > MAX_INITIAL_MINIFIED_BYTES ||
    result.gzipBytes > MAX_INITIAL_GZIP_BYTES ||
    !result.moduleMapPresent ||
    result.forbiddenModules.length > 0
  )) {
    console.error("[perf] Initial JavaScript budget failed", {
      maxMinifiedBytes: MAX_INITIAL_MINIFIED_BYTES,
      maxGzipBytes: MAX_INITIAL_GZIP_BYTES,
    });
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
```

- [ ] **Step 4: Emit build-only chunk module ownership from Vite**

Add a small build plugin in `vite.config.ts`; it writes outside `dist` so source module paths are never deployed:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const initialModuleMapPlugin = (): Plugin => ({
  name: "itemtraxx-initial-module-map",
  apply: "build" as const,
  writeBundle(_options, bundle) {
    const moduleMap = Object.fromEntries(
      Object.values(bundle)
        .filter((output) => output.type === "chunk" && output.fileName.endsWith(".js"))
        .map((output) => [
          output.fileName.replace(/^assets\//, ""),
          Object.keys(output.modules ?? {}).sort(),
        ])
    );
    const artifactsDir = resolve("artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      resolve(artifactsDir, "initial-module-map.json"),
      `${JSON.stringify(moduleMap, null, 2)}\n`
    );
  },
});
```

Add `initialModuleMapPlugin()` to the existing Vite plugin array. Let Vite infer the hook parameters from `Plugin`; do not use `any` or a double cast.

- [ ] **Step 5: Run the unit tests and correct the literal byte expectation if Node reports a different exact fixture total**

Run:

```bash
node --test scripts/check-initial-load-budget.test.mjs
```

Expected: 3 passing tests. If the fixture byte total differs, calculate it from the three literal fixture strings and update only that assertion.

- [ ] **Step 6: Add report-only package wiring**

Add to `scripts` in `package.json`:

```json
"perf:initial:report": "node ./scripts/check-initial-load-budget.mjs --report-only"
```

Run:

```bash
npm run build
npm run perf:initial:report
```

Expected: the command prints the exact referenced asset list, merged-baseline totals, module-map status, and forbidden static SDK modules; it does not fail the pre-optimization build in report-only mode.

- [ ] **Step 7: Commit the analyzer**

```bash
git add scripts/check-initial-load-budget.mjs scripts/check-initial-load-budget.test.mjs vite.config.ts package.json package-lock.json
git diff --cached --check
git commit -m "test: measure initial landing javascript"
```

---

### Task 3: Restore Vite 8 automatic code splitting

**Files:**
- Modify: `vite.config.ts`
- Verify: `src/router/index.ts`

**Interfaces:**
- Consumes: existing route-level dynamic imports.
- Produces: a Vite build with no deprecated `build.rollupOptions.output.manualChunks` function and a materially smaller static preload closure.

- [ ] **Step 1: Capture the report-only baseline from Task 2**

```bash
npm run build
npm run perf:initial:report
cp dist/index.html /tmp/itemtraxx-index-before-auto-split.html
```

Expected: approximately the re-established 1.30 MB baseline, adjusted for merged-main drift.

- [ ] **Step 2: Remove only the manual vendor grouping**

Delete `build.rollupOptions.output.manualChunks` from `vite.config.ts`. Preserve the existing target, sourcemap, minification, warning, and plugin settings. Do not replace it with manual `codeSplitting` groups in this task.

- [ ] **Step 3: Build and compare**

```bash
rm -rf dist
npm run build
npm run perf:initial:report
git diff -- vite.config.ts dist/index.html
```

Expected: build passes; Vite emits no deprecation warning for the removed option; initial minified JavaScript is no worse than 450,000 bytes and neither a jsPDF nor full Sentry aggregate is statically preloaded.

- [ ] **Step 4: Run route smoke tests and commit**

```bash
npx playwright test tests/e2e/public-and-legal.spec.ts tests/e2e/auth-edge-cases.spec.ts
git diff --check
git add vite.config.ts
git commit -m "perf: restore automatic vite code splitting"
```

Expected: focused tests pass with no rendered-route changes.

---

### Task 4: Make status URL resolution dependency-free

**Files:**
- Create: `src/services/edgeUrls.ts`
- Modify: `src/services/edgeFunctionClient.ts`
- Modify: `src/services/systemStatusService.ts`
- Modify: `src/services/districtService.ts`

**Interfaces:**
- Consumes: `VITE_EDGE_PROXY_URL`, `VITE_USE_EDGE_PROXY_IN_DEV`, `VITE_SUPABASE_URL`, current production/dev URL rules.
- Produces: `getEdgeFunctionsBaseUrl(): string` from a module with no Supabase, Sentry, or authenticated-client imports.

- [ ] **Step 1: Add a browser regression that observes public startup requests**

Add a test to `tests/e2e/public-and-legal.spec.ts` which records requests, opens `/`, waits for the status UI to settle, and asserts:

```ts
expect(requestedUrls.filter((url) => url.includes("/functions/system-status"))).toHaveLength(1);
expect(requestedUrls.some((url) => /\.supabase\.(?:co|in)\//.test(url))).toBe(false);
```

Run the focused test. Expected before the extraction: the status-count assertion may pass, while the test documents the public network invariant that later tasks must retain.

- [ ] **Step 2: Create the pure URL module**

Move the current `getEdgeFunctionsBaseUrl` implementation unchanged into `src/services/edgeUrls.ts`:

```ts
const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const getEdgeFunctionsBaseUrl = (): string => {
  const edgeProxyUrl = String(import.meta.env.VITE_EDGE_PROXY_URL ?? "").trim();
  const useProxyInDev = import.meta.env.VITE_USE_EDGE_PROXY_IN_DEV !== "false";
  if (edgeProxyUrl && (!import.meta.env.DEV || useProxyInDev)) {
    return `${trimTrailingSlash(edgeProxyUrl)}/functions`;
  }
  if (!import.meta.env.DEV) return "/functions";
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
  if (!supabaseUrl) return "/functions";
  return `${trimTrailingSlash(supabaseUrl)}/functions/v1`;
};
```

Use the merged implementation verbatim if its dev fallback has changed; the extraction must not alter returned URLs.

- [ ] **Step 3: Re-export for compatibility and update status**

In `edgeFunctionClient.ts`, import and re-export the function:

```ts
import { getEdgeFunctionsBaseUrl } from "./edgeUrls";
export { getEdgeFunctionsBaseUrl } from "./edgeUrls";
```

In `systemStatusService.ts`, import directly from `./edgeUrls`. Verify `edgeUrls.ts` imports nothing.

- [ ] **Step 4: Make district Supabase lookup lazy**

Replace the static `supabaseClient` import in `districtService.ts` with:

```ts
const getSupabaseClient = async () => (await import("./supabaseClient")).supabase;
```

At the existing RPC lookup, add `const supabase = await getSupabaseClient();` immediately before the unchanged query. Do not change hostname parsing, district state, timeouts, or fallback URLs.

- [ ] **Step 5: Verify and commit**

```bash
npm run build
npx playwright test tests/e2e/public-and-legal.spec.ts tests/e2e/auth-edge-cases.spec.ts
npm run perf:initial:report
git diff --check
git add src/services/edgeUrls.ts src/services/edgeFunctionClient.ts src/services/systemStatusService.ts src/services/districtService.ts tests/e2e/public-and-legal.spec.ts
git commit -m "perf: isolate public edge url resolution"
```

Expected: build and focused tests pass; status code no longer traverses `edgeFunctionClient.ts` or `supabaseClient.ts`.

---

### Task 5: Keep unauthenticated public bootstrap out of the Supabase graph

**Files:**
- Create: `src/services/publicAuthBootstrap.ts`
- Modify: `src/services/authService.ts`
- Modify: `src/main.ts`
- Modify: `tests/e2e/auth-edge-cases.spec.ts`

**Interfaces:**
- Consumes: `fetchHttpSessionSummary()`, URL hash handoff markers, current auth-state application logic.
- Produces: `hasDistrictSessionHandoff(hash?: string): boolean`; `refreshPublicAuthFromSession(): Promise<void>`; exported `applyHttpSessionSummary(summary)` compatibility seam in `authService.ts`.

- [ ] **Step 1: Add failing public-session E2E cases**

Add two cases:

1. Unauthenticated `/auth/session/me` returns the current unauthenticated envelope; `/` renders and no Supabase project-host request occurs.
2. Authenticated `/auth/session/me` returns the existing session-summary fixture; the current role redirect still occurs.

Run:

```bash
npx playwright test tests/e2e/auth-edge-cases.spec.ts -g "public session bootstrap"
```

Expected: the authenticated case protects current behavior; the unauthenticated case fails if the browser still reaches a Supabase project host.

- [ ] **Step 2: Export the existing auth-state applicator without changing it**

Rename the private `applySessionSummary` function in `authService.ts` to `applyHttpSessionSummary`, export it, and update its existing internal call sites. Its body—including suspended-tenant handling, district resolution, and auth-state writes—must remain byte-for-byte equivalent.

- [ ] **Step 3: Implement the lightweight public probe**

```ts
import { clearAuthState } from "../store/authState";
import { fetchHttpSessionSummary } from "./httpSessionService";

const HANDOFF_KEYS = ["itx_hc", "itx_th", "itx_at", "itx_rt"];

export const hasDistrictSessionHandoff = (hash = window.location.hash): boolean => {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return HANDOFF_KEYS.some((key) => params.has(key));
};

export const refreshPublicAuthFromSession = async (): Promise<void> => {
  const summary = await fetchHttpSessionSummary();
  if (!summary.authenticated || !summary.user) {
    clearAuthState(true);
    return;
  }
  const { applyHttpSessionSummary, initAuthListener } = await import("./authService");
  await applyHttpSessionSummary(summary);
  initAuthListener();
};
```

Retain the existing timeout/error handling at the `main.ts` call site; this new module must not import `authService.ts` until the HTTP summary is authenticated.

- [ ] **Step 4: Replace static auth imports in `main.ts`**

Remove the top-level `authService.ts` import. Use the cheap hash check before loading handoff code:

```ts
if (hasDistrictSessionHandoff()) {
  const { consumeDistrictSessionHandoff } = await import("./services/authService");
  await consumeDistrictSessionHandoff();
}
```

For the public background session check, call `refreshPublicAuthFromSession()` inside the existing timeout/error boundary. For protected-route bootstrap, dynamically import `refreshAuthFromSession`, `initAuthListener`, and `adminLoginWithSession` at the existing decision points. Do not change timeout lengths, recovery links, or redirect destinations.

- [ ] **Step 5: Verify and commit**

```bash
npm run build
npx playwright test tests/e2e/auth-edge-cases.spec.ts tests/e2e/protected-routes.spec.ts tests/e2e/public-and-legal.spec.ts
npm run perf:initial:report
git diff --check
git add src/services/publicAuthBootstrap.ts src/services/authService.ts src/main.ts tests/e2e/auth-edge-cases.spec.ts
git commit -m "perf: defer authenticated public bootstrap"
```

Expected: unauthenticated `/` does not load the Supabase SDK graph; authenticated public visitors retain the current redirect.

---

### Task 6: Remove authenticated and heavy modules from the public shell path

**Files:**
- Modify: `src/App.vue`
- Modify: `src/main.ts`
- Modify: `src/services/analyticsService.ts`
- Modify: `src/services/posthogService.ts`
- Modify: `src/services/sentry.ts`
- Modify: `src/services/clientDiagnostics.ts`
- Modify: `tests/e2e/public-and-legal.spec.ts`
- Verify: `src/services/checkoutService.ts`
- Verify: `src/services/adminOpsService.ts`
- Verify: `src/services/consentRecordService.ts`

**Interfaces:**
- Consumes: current shell actions and lifecycle triggers.
- Produces: dynamic authenticated-service boundaries with identical action results and no eager SDK imports on unauthenticated public routes.

- [ ] **Step 1: Expand the public startup test**

Record all response URLs for two seconds after `/` reaches network idle. Assert that no requested JavaScript filename contains `jspdf`, `html2canvas`, `jsbarcode`, `posthog`, `sentry`, or `supabase`, and that no Supabase project host is contacted. Use lowercase filename matching; do not assert generated hashes.

- [ ] **Step 2: Make authenticated-only components asynchronous**

Replace static component imports in `App.vue` with Vue async components, beginning with:

```ts
const OnboardingModal = defineAsyncComponent(() => import("./components/OnboardingModal.vue"));
```

Apply the same boundary to authenticated notification/navigation components that the merged `App.vue` statically imports. Keep public kill-switch, maintenance, and route-loading UI synchronous.

- [ ] **Step 3: Dynamically load shell action services at the action boundary**

Replace static service imports with local imports at the existing functions:

```ts
const refreshOfflineQueueCount = async () => {
  if (!auth.isAuthenticated || !isTenantScopedRoute.value) {
    offlineQueueCount.value = 0;
    return;
  }
  const { getBufferedCheckoutCount } = await import("./services/checkoutService");
  offlineQueueCount.value = await getBufferedCheckoutCount();
};

const signOut = async () => {
  const { signOutCurrentUser } = await import("./services/authService");
  await signOutCurrentUser();
};
```

Use the actual merged sign-out export name. Apply the same local-import pattern to admin session touches/checks and consent-record persistence. Preserve all existing catches, user messages, timers, and state resets.

- [ ] **Step 4: Gate authenticated timers**

Start offline-queue and admin-session polling only while the auth state and current route need them. Stop and clear each timer on logout, route exit, and component unmount. A public visitor must not import a service merely because a timer fired.

- [ ] **Step 5: Keep telemetry consent-driven**

Ensure the code path invoked before consent imports no PostHog or Sentry SDK module. SDK imports belong inside the existing `allowsAnalytics`/`allowsDiagnostics` branches. Preserve best-effort error handling and never turn a telemetry import failure into an app error.

- [ ] **Step 6: Verify the public and authenticated paths**

```bash
npm run build
npm run perf:initial:report
npx playwright test tests/e2e/public-and-legal.spec.ts tests/e2e/auth-edge-cases.spec.ts tests/e2e/protected-routes.spec.ts tests/e2e/suspended-tenant.spec.ts
git diff --check
```

Expected: focused tests pass; the public startup browser test observes no heavy/authenticated SDK chunk; authenticated routes still show queue/admin/onboarding behavior.

- [ ] **Step 7: Commit**

```bash
git add src/App.vue src/main.ts src/services tests/e2e/public-and-legal.spec.ts
git commit -m "perf: defer authenticated app shell modules"
```

---

### Task 7: Turn the initial-load measurement into a CI gate

**Files:**
- Modify: `package.json`
- Modify: `scripts/check-bundle-budget.mjs`
- Modify: `.github/workflows/ci-core.yml`
- Modify: `tests/e2e/public-and-legal.spec.ts`

**Interfaces:**
- Consumes: the optimized `dist/index.html` closure.
- Produces: `npm run perf:initial`; CI failure above 250,000 minified bytes or 100,000 gzip bytes.

- [ ] **Step 1: Prove the optimized build meets the approved thresholds**

```bash
rm -rf dist
npm run build
node ./scripts/check-initial-load-budget.mjs
```

Expected: exit 0 at or below both thresholds. Stop and report the exact asset list if it fails; do not raise either threshold without approval.

- [ ] **Step 2: Add the enforced package command**

```json
"perf:initial": "node ./scripts/check-initial-load-budget.mjs"
```

- [ ] **Step 3: Correct the legacy route-chunk check**

In `scripts/check-bundle-budget.mjs`, replace `PublicHome-` with `LandingPageNew-` and rename `maxPublicHomeBytes`/`landingChunk` messages to `maxLandingBytes`/canonical landing. Keep the 5 MiB per-chunk guard as a secondary protection; the new closure gate is authoritative.

- [ ] **Step 4: Add CI wiring immediately after the build**

```yaml
      - name: Check initial JavaScript budget
        run: npm run perf:initial
```

Keep the existing bundle, image, and report steps.

- [ ] **Step 5: Verify and commit**

```bash
node --test scripts/check-initial-load-budget.test.mjs
npm run build
npm run perf:initial
npm run perf:budget
npm run perf:images
npm run perf:report
npx playwright test tests/e2e/public-and-legal.spec.ts
git diff --check
git add package.json package-lock.json scripts/check-bundle-budget.mjs .github/workflows/ci-core.yml tests/e2e/public-and-legal.spec.ts
git commit -m "ci: enforce canonical landing payload"
```

---

### Task 8: Revalidate and remove only proven dead code

**Files:**
- Delete if still unreferenced: `src/pages/tenant/TenantHome.vue`
- Delete if still unreferenced: `src/services/sessionAccessToken.ts`
- Delete if still unreferenced: `public/vite.svg`
- Delete if still unreferenced: `scripts/update-changelog-from-commits.mjs`
- Modify: `src/style.css`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: merged routes, scripts, workflows, imports, documentation, CSS class construction, package usage.
- Produces: removal of only candidates with no live or external invocation path.

- [ ] **Step 1: Re-run reference checks candidate by candidate**

```bash
rg -n "TenantHome|sessionAccessToken|vite\.svg|update-changelog-from-commits|dot-button|admin-section-grid|edit-actions-cell" . --glob '!node_modules/**' --glob '!dist/**' --glob '!docs/superpowers/**'
rg -n "@posthog/react|from ['\"]rollup['\"]|zod-to-json-schema|cyclonedx" . --glob '!node_modules/**' --glob '!package-lock.json'
npx -y knip --reporter compact
```

Expected: each deletion candidate has no route/import/script/workflow/documentation reference. Preserve `@cyclonedx/cyclonedx-npm`, Deno functions, Worker sources, deployment scripts, SQL, and dynamic skeleton selectors even if Knip lists them.

- [ ] **Step 2: Delete proven files and selectors**

Delete the four files only when Step 1 confirms them. Remove complete CSS rule blocks for `.dot-button`, `.admin-section-grid`, and `.edit-actions-cell` only when no static or constructed-class reference remains after the merged-main check.

- [ ] **Step 3: Remove unused direct dependencies through npm**

```bash
npm uninstall @posthog/react
npm uninstall --save-dev rollup zod-to-json-schema
```

If merged `origin/main` introduced a real direct import or script use, preserve that package and include the evidence in the final audit instead.

- [ ] **Step 4: Verify references, build, security gate, and routes**

```bash
rg -n "TenantHome|sessionAccessToken|vite\.svg|update-changelog-from-commits|@posthog/react|zod-to-json-schema" . --glob '!node_modules/**' --glob '!dist/**' --glob '!docs/superpowers/**'
npm run build
npm run perf:initial
npm run security:gate
npx playwright test tests/e2e/public-and-legal.spec.ts tests/e2e/auth-edge-cases.spec.ts
git diff --check
```

Expected: reference search is empty except package-lock transitive names or deliberate audit documentation; all verification passes.

- [ ] **Step 5: Commit**

```bash
git add -A src/pages/tenant/TenantHome.vue src/services/sessionAccessToken.ts public/vite.svg scripts/update-changelog-from-commits.mjs src/style.css package.json package-lock.json
git commit -m "chore: remove proven dead frontend code"
```

---

### Task 9: Complete Workstream A verification

**Files:**
- Verify: all files changed in Tasks 1-8
- Record later: `docs/superpowers/reports/2026-07-10-cleanup-modernization-report.md` in Plan 4

**Interfaces:**
- Consumes: merged and optimized Workstream A.
- Produces: a clean, releasable checkpoint eligible for frontend decomposition.

- [ ] **Step 1: Run the complete checkpoint suite**

```bash
bash ./scripts/check-env-parity.sh
rm -rf dist artifacts
npm run build
npm run perf:initial
npm run perf:budget
npm run perf:images
npm run perf:report
npm run security:gate
deno test --allow-env --frozen supabase/functions/_shared/*_test.ts
deno test --no-check --frozen cloudflare/edge-proxy/src/index_test.ts
npx playwright test
npx -y knip --reporter compact
git diff --check
git status --short --branch
```

Expected: every required command passes, Playwright has no regressions, the initial closure meets both thresholds, and the worktree is clean after committed changes. Knip may list documented external-entry false positives only.

- [ ] **Step 2: Inspect the built HTML and fresh browser trace**

Run the production preview, open `/` in a fresh Playwright context, and record resource URLs. Confirm:

- no more than one initial `system-status` request;
- no direct Supabase project-host request before user action;
- no jsPDF, html2canvas, barcode, PostHog, Sentry, or Supabase SDK in the static preload set;
- the HTTP session-summary request remains present and non-blocking;
- public rendering and canonical-host behavior remain unchanged.

- [ ] **Step 3: Create a checkpoint commit only if verification itself required a fix**

If no fix was required, do not create an empty commit. If a narrow verification fix was required, rerun the affected test and commit it separately with a message describing that fix.
