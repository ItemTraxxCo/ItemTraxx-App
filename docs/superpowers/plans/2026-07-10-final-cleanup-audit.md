# Styles, Dependencies, Generated State, and Final Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove authenticated/admin CSS from public startup, complete the asset/dependency/generated-state cleanup, add a repeatable production landing trace, and produce an evidence-backed final audit proving the repository-wide modernization preserved behavior.

**Architecture:** Split CSS by actual route ownership, enforced by a built-output boundary checker rather than filename assumptions. Update only direct dependencies whose existing ranges already admit the update and verify each group independently. Treat generated schemas, Worker types, and `deno.lock` as deterministic committed state. Finish with machine-verifiable build/network/security gates plus a human-readable before/after report and explicit preserved-candidate ledger.

**Tech Stack:** Vue/Vite CSS extraction, Node 22.15.0, Playwright, npm, Deno, Wrangler, Knip, jscpd, GitHub Actions.

## Global Constraints

- Begin only after Plans 1-3 pass from committed state.
- Preserve visual rendering, responsive behavior, reduced-motion behavior, focus visibility, theme tokens, ARIA semantics, and all public/authenticated routes.
- Do not remove responsive WebP sources or PNG fallbacks without a real-browser failure-mode test proving the fallback unnecessary.
- No dependency major upgrade. Do not widen a manifest range merely to admit a newer release; major versions merged into the baseline stay, but this plan does not add new majors.
- Never hand-edit generated edge schema/OpenAPI/reference files or `worker-configuration.d.ts`; run their owning generators.
- Keep `deno.lock` committed and unchanged by verification unless an intentional import-version change requires regeneration and review.
- Public root assets, SQL history, legacy routes, raw handoff rejection, and schema compatibility fallbacks remain preserved by default and must be listed in the final report.

---

### Task 1: Add a built-output public CSS boundary gate

**Files:**
- Create: `scripts/check-public-css-boundary.mjs`
- Create: `scripts/check-public-css-boundary.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: CSS files linked directly by `dist/index.html`.
- Produces: `npm run perf:css-boundary`; failure if authenticated-only selectors occur in the canonical public entry stylesheet closure.

- [ ] **Step 1: Write failing parser and selector tests**

```js
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectPublicCss } from "./check-public-css-boundary.mjs";

test("reports authenticated selectors in entry-linked CSS", () => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-css-boundary-"));
  const assetsDir = join(root, "assets");
  mkdirSync(assetsDir);
  writeFileSync(join(root, "index.html"), '<link rel="stylesheet" href="/assets/index-a.css">');
  writeFileSync(join(assetsDir, "index-a.css"), ":root{color-scheme:light}.admin-grid{display:grid}");
  try {
    const result = inspectPublicCss({ htmlPath: join(root, "index.html"), assetsDir });
    assert.deepEqual(result.violations, [{ asset: "index-a.css", selector: ".admin-grid" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts public-only entry CSS", () => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-css-boundary-"));
  const assetsDir = join(root, "assets");
  mkdirSync(assetsDir);
  writeFileSync(join(root, "index.html"), '<link rel="stylesheet" href="/assets/index-a.css">');
  writeFileSync(join(assetsDir, "index-a.css"), ":root{color-scheme:light}.button-primary{display:block}");
  try {
    assert.deepEqual(inspectPublicCss({ htmlPath: join(root, "index.html"), assetsDir }).violations, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Confirm the missing-module failure**

```bash
node --test scripts/check-public-css-boundary.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the checker**

```js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const AUTHENTICATED_ONLY_SELECTORS = [
  ".admin-grid",
  ".admin-card",
  ".admin-shell",
  ".admin-hero",
  ".admin-toolbar",
  ".admin-summary-grid",
  ".admin-section-card",
  ".table-wrap",
  ".skeleton-loader-table",
  ".checkout-item-row",
  ".gear-notes-cell",
  ".gear-notes-input",
];
const SAFE_CSS_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*\.css$/;

const linkedCssAssets = (html) => [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+\.css)["'][^>]*>/gi)]
  .map((match) => match[1].split(/[?#]/, 1)[0]);

export const inspectPublicCss = ({ htmlPath = resolve("dist/index.html"), assetsDir = resolve("dist/assets") } = {}) => {
  const assets = [...new Set(linkedCssAssets(readFileSync(htmlPath, "utf8")).map((reference) => {
    const match = reference.match(/^(?:\/|\.\/)?assets\/([^/]+)$/);
    const asset = match?.[1] ?? "";
    if (!SAFE_CSS_RE.test(asset)) throw new Error(`unsafe CSS asset reference: ${reference}`);
    return asset;
  }))].sort();
  const violations = [];
  for (const asset of assets) {
    const css = readFileSync(resolve(assetsDir, asset), "utf8");
    for (const selector of AUTHENTICATED_ONLY_SELECTORS) {
      if (css.includes(selector)) violations.push({ asset, selector });
    }
  }
  return { assets, violations };
};

const run = () => {
  const result = inspectPublicCss();
  if (result.violations.length) {
    console.error("[perf] Authenticated selectors found in public entry CSS", result);
    process.exitCode = 1;
    return;
  }
  console.log("[perf] Public CSS boundary passed", result);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
```

- [ ] **Step 4: Wire the command but do not add it to CI until the split passes**

```json
"perf:css-boundary": "node ./scripts/check-public-css-boundary.mjs"
```

- [ ] **Step 5: Run unit tests and commit**

```bash
node --test scripts/check-public-css-boundary.test.mjs
npm run build
npm run perf:css-boundary
```

Expected before Task 2: unit tests pass; the real build fails and names the authenticated selectors currently shipped in `src/style.css`.

```bash
git add scripts/check-public-css-boundary.mjs scripts/check-public-css-boundary.test.mjs package.json package-lock.json
git commit -m "test: enforce public css ownership"
```

---

### Task 2: Split global CSS by live route ownership

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Create: `src/styles/app-shell.css`
- Create: `src/styles/authenticated.css`
- Create additional route-owned CSS only when the usage matrix proves ownership
- Modify: `src/style.css`
- Modify: `src/main.ts`
- Modify: `src/components/app/AuthenticatedNavigation.vue`
- Modify: owning route/components as required
- Modify: `.github/workflows/ci-core.yml`
- Modify: visual E2E specs

**Interfaces:**
- Consumes: every selector and rule from the post-Plan-3 `src/style.css`.
- Produces: public entry CSS with tokens/base/public shell only; authenticated CSS loaded through authenticated shell/routes; no dropped or duplicate selector.

- [ ] **Step 1: Build a selector ownership matrix**

For every top-level selector in `src/style.css`, search static references and dynamic class construction, then classify it as token/reset, global primitive, public shell/overlay, authenticated shell/navigation, admin/data table, route-specific, or proven dead. Use:

```bash
rg -n 'class=|:class=|classList|skeleton-|status-|broadcast-' src --glob '*.vue' --glob '*.ts'
```

Exercise public, auth, tenant, admin, district, super, unavailable, and submit-confirmation routes at desktop/mobile. Preserve dynamic skeleton/status/broadcast classes.

- [ ] **Step 2: Lock visual/interaction baselines**

Add or update Playwright screenshots/semantic assertions for `/`, `/login`, `/legal`, tenant checkout/return, tenant admin, district, super admin, maintenance, kill switch, version/session overlays, reduced motion, light/dark theme, table overflow, and mobile menu.

- [ ] **Step 3: Move tokens and public base first**

`tokens.css` contains both `:root` theme token blocks. `base.css` contains reset/body/typography, focus/accessibility, brand, button/link/card/form/page primitives used on public and authenticated routes. `app-shell.css` contains route progress/loading, maintenance/kill-switch/version/session overlays, public broadcasts/incidents, and public shell layout.

Make `src/style.css` an ordered compatibility entry while migration is in progress:

```css
@import "./styles/tokens.css";
@import "./styles/base.css";
@import "./styles/app-shell.css";
```

Move complete rule groups, including media queries/keyframes next to their owners; do not duplicate rules across files.

- [ ] **Step 4: Load authenticated CSS only with authenticated chrome/routes**

Place table/admin/skeleton/authenticated navigation/checkout tags in `authenticated.css`. Import it from the async authenticated shell component created in Plan 2:

```vue
<style src="../../styles/authenticated.css"></style>
```

If a public page demonstrably uses a generic `.table` or form rule, move only that shared primitive to `base.css`; do not pull the whole admin stylesheet back into the entry closure.

- [ ] **Step 5: Move route-specific rules to owners**

For selectors used by one route/component, move them to that `.vue` file's `<style scoped>` or a route-imported CSS module. Preserve `:global(...)` only where a child component contract requires it and document that relationship in a comment.

- [ ] **Step 6: Delete the compatibility entry after imports are direct**

Change `main.ts` from `import "./style.css"` to ordered public imports:

```ts
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app-shell.css";
```

Delete `src/style.css` only after `rg` proves it has no import and all selectors have an owner.

- [ ] **Step 7: Verify built CSS and visual behavior**

```bash
npm run build
npm run perf:css-boundary
npm run perf:initial
npm run perf:images
npx playwright test
git diff --check
```

Expected: public boundary passes, public visuals are unchanged, and authenticated route CSS loads when needed.

- [ ] **Step 8: Add CI and commit in ownership-sized groups**

Add after the build:

```yaml
      - name: Check public CSS boundary
        run: npm run perf:css-boundary
```

Commit base/shell and authenticated/route moves separately:

```bash
git commit -m "refactor: split public app styles"
git commit -m "refactor: lazy load authenticated styles"
```

---

### Task 3: Complete the asset and preserved-surface audit

**Files:**
- Delete only newly proven dead tracked assets
- Verify: `public/brand/*`
- Verify: `public/favicon*`, `public/apple-touch-icon.png`, `public/android-chrome-*.png`
- Verify: `public/.well-known/security.txt`, `public/security.txt`, `public/humans.txt`, `public/llms.txt`, root `llms.txt`
- Verify: `src/assets/landing/*`
- Verify: `public/site.webmanifest`, `public/robots.txt`, `public/sitemap.xml`

**Interfaces:**
- Consumes: static imports, `index.html`, manifest/metadata references, built output, conventional external URL paths.
- Produces: only evidence-backed deletions plus a preserved-candidate ledger for externally addressed assets.

- [ ] **Step 1: Recheck every tracked asset**

```bash
git ls-files public src/assets | sort
rg -n 'brand/|favicon|apple-touch|android-chrome|og\.png|security\.txt|humans\.txt|llms\.txt|admin_ui|checkout_return_ui|site\.webmanifest' . --glob '!node_modules/**' --glob '!dist/**' --glob '!docs/superpowers/**'
npm run build
find dist -type f -maxdepth 3 -print | sort
```

Also request conventional public paths from production preview. Absence from imports is not proof for favicons, well-known metadata, OG images, `robots.txt`, `sitemap.xml`, or `llms.txt`.

- [ ] **Step 2: Verify the Plan 1 deletion stayed valid**

Confirm `public/vite.svg` is absent and no generated HTML/CSS references it. If merged-main made it live, restore it and record the evidence instead of forcing deletion.

- [ ] **Step 3: Preserve responsive images and external surfaces**

Verify `<picture>`/`srcset` chooses WebP at intended widths and PNG remains the fallback when WebP is disabled/failed. Preserve both `llms.txt` copies because the root file can serve repository consumers while `public/llms.txt` serves the deployed root, unless the user explicitly approves consolidation.

- [ ] **Step 4: Delete only additional proven files**

Use `apply_patch` for tracked deletions. Ignore untracked macOS `.DS_Store` files; `.gitignore` already excludes them. Never add them to a commit.

- [ ] **Step 5: Verify and commit only if tracked assets changed**

```bash
npm run build
npm run perf:images
npm run perf:initial
npx playwright test tests/e2e/public-and-legal.spec.ts
git diff --check
```

If no additional tracked asset is proven dead, make no empty commit; carry the preserved ledger into Task 7.

---

### Task 4: Apply patch/minor direct-dependency maintenance one group at a time

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify only compatibility code required by an in-range update

**Interfaces:**
- Consumes: post-merge direct dependency ranges and `npm outdated --json`.
- Produces: latest installable versions inside existing ranges, no new major migration, clean audit/build/test state.

- [ ] **Step 1: Inventory live direct dependencies and current use**

```bash
npm outdated --json || true
npm ls --depth=0
npx -y knip --reporter compact
```

Confirm Plan 1 removed `@posthog/react`, direct `rollup`, and `zod-to-json-schema`. Preserve `@cyclonedx/cyclonedx-npm` because `scripts/generate-sbom.sh` invokes it and preserve every deployment/test CLI with a script/workflow reference.

- [ ] **Step 2: Update only within existing manifest ranges**

For each risk group whose `wanted` versions remain in the current manifest ranges, run only the applicable command:

```bash
npm update vue vue-router @vitejs/plugin-vue @vue/tsconfig typescript vue-tsc vite @types/node
npm update @supabase/supabase-js supabase
npm update @sentry/vue posthog-js @vercel/analytics @vercel/speed-insights
npm update jsbarcode jspdf jspdf-autotable
npm update wrangler @cloudflare/vite-plugin
npm update @playwright/test @cyclonedx/cyclonedx-npm
```

Before each line, compare every named package's `wanted` version from `npm outdated` with its current manifest range; remove names that are current or outside-range from that invocation. Do not run `npm install package@latest`, do not widen ranges, and do not update packages whose `latest` requires a new major.

- [ ] **Step 3: Verify by risk group**

Group and verify independently:

1. Vue/router/build/types: `npm run build`, route/auth Playwright.
2. Supabase client/CLI: auth/checkout/admin Playwright, shared Deno tests, edge contract checks.
3. Sentry/PostHog/Vercel: consent/public tests and initial payload/network gates.
4. PDF/barcode: focused barcode/PDF E2E controls and build.
5. Wrangler/Cloudflare: regenerate/check Worker types, typecheck, Worker runtime tests.
6. Test/security tooling: full E2E, security gate, SBOM generation.

Commit each passing risk group separately. If a package requires source churn unrelated to compatibility or changes a public/security contract, restore that package/lock change with `apply_patch`, record it as deferred, and continue.

- [ ] **Step 4: Verify package state**

```bash
npm ci --ignore-scripts
npm ls --depth=0
npm audit --audit-level=high
npm run security:sbom
git diff --check
```

Expected: install is reproducible, no unintended manifest range change, audit gate passes, and SBOM generation succeeds.

---

### Task 5: Make generated state and Deno lock verification deterministic

**Files:**
- Modify only through generators: `docs/api/generated/edge-contracts.schema.json`
- Modify only through generators: `docs/api/generated/edge-contracts.openapi.json`
- Modify only through generators: `docs/api/edge-endpoints.md`
- Modify only through Wrangler: `cloudflare/edge-proxy/worker-configuration.d.ts`
- Modify only when imports changed: `deno.lock`
- Modify: `.github/workflows/ci-core.yml` if a gate is still absent

**Interfaces:**
- Consumes: `src/types/edgeSchemas.mjs`, current endpoint contracts, Wrangler config/env template, Deno imports.
- Produces: deterministic committed artifacts and frozen lock verification.

- [ ] **Step 1: Regenerate edge docs through owners**

```bash
npm run docs:edge-schemas
npm run docs:edge-reference
npm run devops:check:edge-contract-drift
```

Expected: generators either produce no diff or one contract-consistent diff caused by Plan 3. Review every action/schema change against the preserved endpoint registry.

- [ ] **Step 2: Prove generation is deterministic**

Run the same three commands again and assert:

```bash
git diff --exit-code -- docs/api/generated docs/api/edge-endpoints.md
```

If Plan 3 intentionally changed generated content, stage the first generated diff before the second-run comparison and compare the working tree to the index with `git diff --exit-code`; do not discard the intended staged output.

- [ ] **Step 3: Regenerate and check Worker declarations**

```bash
npm run worker:types
npm run worker:types:check
npm run worker:typecheck
```

Expected: generated declaration is current and source typechecks.

- [ ] **Step 4: Align Deno lock only when imports changed**

First run frozen checks:

```bash
deno check --frozen supabase/functions/super-ops/index.ts supabase/functions/super-tenant-mutate/index.ts supabase/functions/admin-ops/index.ts
deno test --allow-env --frozen supabase/functions/_shared/*_test.ts
git diff --exit-code -- deno.lock
```

If frozen resolution fails because Plan 3 added a new imported module, run the same `deno check` once without `--frozen`, review only the lock entries corresponding to those imports, then rerun frozen commands. Never accept unrelated lock churn.

- [ ] **Step 5: Ensure CI runs drift and frozen gates**

Keep edge coverage/contract drift/SQL coupling in CI Core. Add Worker type/test and shared Deno frozen test steps if Plans 1-3 did not already add them. Reuse the repository's pinned Deno setup action.

- [ ] **Step 6: Commit generated state separately**

```bash
git diff --check
git add docs/api/generated docs/api/edge-endpoints.md cloudflare/edge-proxy/worker-configuration.d.ts deno.lock .github/workflows/ci-core.yml
git commit -m "chore: align generated edge state"
```

Do not create the commit when all generated/CI files are unchanged.

---

### Task 6: Add a repeatable fresh production landing network check

**Files:**
- Create: `scripts/check-landing-network.mjs`
- Create: `scripts/check-landing-network.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `dist`, Vite preview on `127.0.0.1`, a fresh Chromium context.
- Produces: `artifacts/landing-network.json`; exit 1 for direct Supabase project-host requests, more than one initial system-status request, or forbidden heavy SDK resources before user action.

- [ ] **Step 1: Unit-test URL classification**

Export and test:

```js
export const classifyLandingRequests = (urls) => ({
  directSupabase: urls.filter((url) => /https:\/\/[^/]+\.supabase\.(?:co|in)\//i.test(url)),
  systemStatus: urls.filter((url) => /\/functions(?:\/v1)?\/system-status(?:[?#]|$)/i.test(url)),
  forbiddenSdk: urls.filter((url) => /(?:jspdf|html2canvas|jsbarcode|posthog|sentry|supabase)[^/]*\.js(?:[?#]|$)/i.test(url)),
});
```

Test positive/negative URLs, including `edge.itemtraxx.com/functions/system-status` as allowed and `project.supabase.co/functions/v1/system-status` as direct Supabase.

- [ ] **Step 2: Implement preview orchestration**

Use `spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4174", "--strictPort"])`. Poll `http://127.0.0.1:4174/` with bounded `fetch` retries. Launch Playwright Chromium with a new context, record `page.on("request")`, navigate to `/`, wait for DOM content plus two seconds of settled startup, write JSON, then close browser and terminate preview in `finally`.

The report contains timestamp, page URL, unique sorted URLs, classification, system-status count, and the initial-load analyzer result. It contains no cookies, authorization headers, or bodies.

- [ ] **Step 3: Fail on approved invariants**

Exit 1 when `directSupabase.length > 0`, `systemStatus.length > 1`, `forbiddenSdk.length > 0`, or the initial JS analyzer exceeds its thresholds. Print exact violating URLs.

- [ ] **Step 4: Wire and verify**

```json
"perf:landing-network": "node ./scripts/check-landing-network.mjs"
```

Run:

```bash
node --test scripts/check-landing-network.test.mjs
rm -rf dist artifacts
npm run build
npm run perf:landing-network
```

Expected: tests pass, preview exits cleanly, JSON artifact is created, and all public network invariants pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-landing-network.mjs scripts/check-landing-network.test.mjs package.json package-lock.json
git commit -m "test: verify fresh landing network"
```

Keep this heavier check in the final/local gate unless CI timing proves stable; the static JS and CSS gates remain mandatory in CI.

---

### Task 7: Produce the final audit and preserved-candidate ledger

**Files:**
- Create: `docs/superpowers/reports/2026-07-10-cleanup-modernization-report.md`
- Verify: entire repository diff from the baseline merge

**Interfaces:**
- Consumes: approved design baseline, final command outputs, `artifacts/perf-report.json`, `artifacts/landing-network.json`, Knip/jscpd results, line/dependency counts.
- Produces: one evidence-backed report with no unsupported completion claim.

- [ ] **Step 1: Collect before/after measurements**

Use the design's recorded baseline and measure final values:

```bash
wc -l src/App.vue src/main.ts src/services/authService.ts src/services/checkoutService.ts cloudflare/edge-proxy/src/index.ts supabase/functions/super-ops/index.ts supabase/functions/super-tenant-mutate/index.ts supabase/functions/admin-ops/index.ts
node -e 'const p=require("./package.json"); console.log({dependencies:Object.keys(p.dependencies||{}).length,devDependencies:Object.keys(p.devDependencies||{}).length})'
npm run perf:initial:report
npm run perf:report
npx -y knip --reporter compact
npx -y jscpd src supabase/functions cloudflare/edge-proxy/src --min-lines 8 --min-tokens 70 --reporters console
BASELINE_MERGE_COMMIT="$(git log --merges --format=%H --grep='origin/main' -n 1)"
test -n "$BASELINE_MERGE_COMMIT"
git diff --stat "$BASELINE_MERGE_COMMIT"..HEAD
```

Confirm the discovered hash is the Plan 1 baseline merge before using the resulting diff in the report.

- [ ] **Step 2: Write required report sections**

The report must contain:

1. scope and baseline commit/final commit;
2. changed architecture and file ownership;
3. before/after line counts for all named oversized files;
4. dependency counts and removals/updates/deferred majors;
5. duplicate-code percentage and remaining intentional clusters;
6. initial JS minified/gzip/assets before and after;
7. fresh landing network request count, system-status count, direct Supabase count, forbidden SDK count;
8. dead files/selectors/assets removed with reference evidence;
9. every verification command and pass/fail output summary;
10. preserved manual-review ledger with evidence and risk;
11. any remaining limitations or separately approvable follow-up.

- [ ] **Step 3: Include the preserved ledger explicitly**

At minimum address `/landing-old`, `/landing-new`, `/landing-new2`, versioned SQL, public brand/favicon/well-known/metadata assets, both `llms.txt` files, responsive WebP and PNG fallbacks, legacy offline queue migration, raw handoff rejection, missing-table/column fallbacks, dynamically generated skeleton/status classes, Worker TOML/compatibility date/node flag/observability choice, and any CSS/form/edge duplication retained because contracts differ.

- [ ] **Step 4: Verify every report number against an artifact/command**

Do not round payload numbers inconsistently: report exact bytes and optionally a human-readable value. Do not claim a route/workflow was preserved unless it has a named automated test or manual trace entry.

- [ ] **Step 5: Commit the report after final verification**

The report commit happens only after Task 8 passes, so defer the actual commit until then.

---

### Task 8: Run the complete clean-checkout-equivalent verification and finish

**Files:**
- Verify: all implementation files and generated artifacts
- Finalize: `docs/superpowers/reports/2026-07-10-cleanup-modernization-report.md`

**Interfaces:**
- Consumes: all four completed plans.
- Produces: a clean, reviewable branch with every approved completion criterion supported by current evidence.

- [ ] **Step 1: Reinstall and run CI-core-equivalent checks with Node 22.15.0**

```bash
node --version
npm ci --ignore-scripts
bash ./scripts/check-env-parity.sh
npm run devops:check:edge-coverage
npm run devops:check:edge-contract-drift
ITX_DIFF_BASE=origin/main ITX_DIFF_HEAD=HEAD npm run devops:check:sql-coupling
rm -rf dist artifacts
npm run build
npm run perf:initial
npm run perf:css-boundary
npm run perf:budget
npm run perf:images
npm run perf:report
node --test scripts/*.test.mjs
```

Expected: Node is `v22.15.0`; every command exits 0.

- [ ] **Step 2: Run security, Worker, Deno, and generated-state gates**

```bash
npm run security:gate
npm run security:sbom
npm run worker:types:check
npm run worker:typecheck
npm run worker:test
deno test --allow-env --allow-read=supabase/functions/super-tenant-mutate/actions --frozen supabase/functions/_shared/*_test.ts supabase/functions/super-ops/*_test.ts supabase/functions/super-tenant-mutate/*_test.ts supabase/functions/admin-ops/*_test.ts
deno check --frozen supabase/functions/super-ops/index.ts supabase/functions/super-tenant-mutate/index.ts supabase/functions/admin-ops/index.ts
git diff --exit-code -- deno.lock cloudflare/edge-proxy/worker-configuration.d.ts docs/api/generated docs/api/edge-endpoints.md
```

Expected: every command exits 0 and verification generates no committed-state drift.

- [ ] **Step 3: Run full browser and production network verification**

```bash
npx playwright install chromium
npx playwright test
npm run perf:landing-network
```

Expected: the full 31-or-later suite passes; production landing trace passes all network/payload invariants.

- [ ] **Step 4: Re-run final static audits**

```bash
npx -y knip --reporter compact
npx -y jscpd src supabase/functions cloudflare/edge-proxy/src --min-lines 8 --min-tokens 70 --reporters console
rg -n 'TenantHome|sessionAccessToken|vite\.svg|update-changelog-from-commits|@posthog/react|zod-to-json-schema' . --glob '!node_modules/**' --glob '!dist/**' --glob '!docs/superpowers/**'
git diff --check
git status --short --branch
```

Expected: only documented analyzer false positives/intentional duplication remain; removed candidates have no live references; no whitespace errors.

- [ ] **Step 5: Perform final protected-flow review**

Manually trace checkout, return, offline buffer/replay, tenant login/admin verification, district handoff, super-admin verification, logout/session revocation, password reset, internal host, public authenticated redirect, kill switch, maintenance, consent telemetry, and deploy-script dry validation. Record each result in the report.

- [ ] **Step 6: Finalize and commit the audit**

Update the report with the exact final commit range and verification results, then:

```bash
git add docs/superpowers/reports/2026-07-10-cleanup-modernization-report.md
git diff --cached --check
git commit -m "docs: report codebase cleanup results"
```

- [ ] **Step 7: Confirm the terminal state**

```bash
git status --short --branch
git log --oneline --decorate --no-merges origin/main..HEAD
```

Expected: clean worktree; reviewable task-sized commit sequence; every approved design completion criterion maps to a plan task and final report evidence. Do not mark the umbrella goal complete if any required gate, protected workflow, payload threshold, or final report item remains unresolved.
