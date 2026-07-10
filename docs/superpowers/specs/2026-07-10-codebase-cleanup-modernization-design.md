# ItemTraxx Codebase Cleanup and Modernization Design

**Date:** 2026-07-10  
**Status:** Design approved; awaiting written-spec review
**Repository:** `ItemTraxxCo/ItemTraxx-App`  
**Working branch:** `dev/mmango10`

## Purpose

This sprint reduces technical debt across the ItemTraxx repository without adding features or changing product behavior. The work removes code that is demonstrably dead, reduces duplication and oversized units, modernizes the Vue/Vite build, and materially improves the public landing-page payload. Checkout, return, authentication, authorization, tenant isolation, Supabase security, RLS, database behavior, and business rules remain unchanged.

The repository is too broad for one safe rewrite. The sprint is therefore an umbrella program composed of independently testable workstreams. Each workstream must leave the repository buildable and releasable before the next begins.

Implementation planning will use four sequential plan documents under this approved umbrella design:

1. baseline synchronization, landing performance, and proven dead-code removal;
2. frontend shell, page, and service decomposition;
3. Cloudflare Worker and Supabase function decomposition;
4. style/dependency/generated-state cleanup and the final repository audit.

Each plan must be reviewed and completed before execution advances to the next plan. This preserves the repository-wide objective without creating one unreviewable implementation batch.

## Current-State Evidence

The analysis baseline was captured from `dev/mmango10` on 2026-07-10 before source edits:

- The worktree was clean.
- The branch was five commits behind `origin/main` and two `.gitignore` commits ahead.
- The Node 22.15.0 production build passed.
- The existing bundle and image budget scripts passed.
- Fifty-five Supabase shared Deno tests passed with `--allow-env`.
- Eleven Cloudflare Worker runtime tests passed with the current `--no-check` harness.
- Thirty-one Playwright tests passed after installing the repository-required Chromium binary.
- `src/App.vue` was 1,565 lines, `src/style.css` was 1,692 lines, and `src/main.ts` was 434 lines.
- The largest frontend service was `src/services/authService.ts` at 1,119 lines.
- The largest server entrypoints included `supabase/functions/super-ops/index.ts` at 2,198 lines, `super-tenant-mutate/index.ts` at 1,635 lines, `admin-ops/index.ts` at 1,418 lines, and `cloudflare/edge-proxy/src/index.ts` at 1,375 lines.
- The current `/` route loaded about 1.30 MB of minified JavaScript in 18 requests in a fresh production-preview browser context. The preload set included a 564 kB Vue/Sentry aggregate, 401 kB of jsPDF, and 202 kB of Supabase.
- A temporary build using Vite 8 automatic code splitting reduced the HTML static preload closure from about 1.30 MB to 441 kB without source changes.
- The existing performance gate checked only the 92.7 kB entry chunk and the legacy `PublicHome` route chunk, each against a 5 MiB limit. It did not measure the full preload closure for the actual root route, `LandingPageNew.vue`.
- Static analysis found high-confidence dead files and dependencies, but also false positives for externally invoked scripts, Cloudflare/Supabase entrypoints, and site-root public assets.
- Duplication analysis reported approximately 9.35% duplicated TypeScript, concentrated in public-page setup, forms, authentication UI, edge request scaffolding, and mutation handlers.

These measurements are baselines, not completion evidence. They must be re-established after merging `origin/main` before implementation begins.

## Constraints and Non-Goals

### Required invariants

- Preserve all existing user-visible behavior.
- Preserve checkout and return semantics, including encrypted offline buffering and replay.
- Preserve authentication, authorization, admin verification TTLs, session revocation, and tenant/district routing.
- Preserve tenant isolation, trusted edge ingress, RLS, SQL behavior, and database compatibility.
- Preserve cookie-consent gating for analytics and diagnostics.
- Preserve internal-host behavior and all documented deployment paths.
- Use Node 22.15.0 for CI-parity verification.
- Prefer small commits that can be reviewed and reverted independently.

### Explicit non-goals

- No redesign, new feature, product-flow change, schema redesign, or broad dependency-major migration.
- No deletion of SQL history because multiple files describe successive migrations.
- No removal of compatibility behavior without current production-schema or telemetry evidence proving it obsolete.
- No speculative abstraction. Shared code is introduced only where two or more current call sites have the same contract.
- No bulk formatting or naming churn unrelated to a concrete cleanup boundary.

## Architecture Principles

1. **Remove before abstracting.** Delete proven dead code first so later abstractions model only live behavior.
2. **Make public startup independent.** Public routes may load Vue, the router, public chrome, status, and consent code. Supabase, PDF, admin, checkout, and authenticated dashboard code load only when required.
3. **Keep boundaries behavior-based.** New units own one lifecycle or domain responsibility rather than one arbitrary technical layer.
4. **Keep security checks close to entrypoints.** Edge refactors may share pure parsing and formatting helpers, but authorization ordering remains explicit and reviewable in each endpoint.
5. **Measure complete load paths.** Performance gates cover the entry script and all static modulepreloads, not one filename prefix.
6. **Fail according to domain.** Telemetry remains best effort; authentication and authorization continue to fail closed; public status failures remain non-fatal and visible as unknown status.
7. **Prefer automatic splitting first.** Vite/Rolldown automatic code splitting is the default. Manual groups are added only when a measured regression cannot be solved through source dependency boundaries.

## Workstream A: Baseline, Build Modernization, and Landing Performance

### A1. Establish the implementation baseline

- Merge `origin/main` into `dev/mmango10`, preserving the branch's two `.gitignore` commits.
- Reinstall with the repository's CI install policy when the merged lockfile requires it.
- Re-run build, performance, security-helper, Worker, and E2E baselines before functional edits.
- Record the merged baseline in the implementation plan and compare every performance stage against it.

### A2. Correct Vite 8 chunking

- Replace deprecated `build.rollupOptions.output.manualChunks` usage with Vite 8 configuration.
- Begin with Rolldown automatic code splitting rather than recreating vendor groups.
- Preserve route-level dynamic imports already declared in `src/router/index.ts`.
- Enable build metadata needed by the repository-owned initial-load checker if the HTML alone is insufficient.

The temporary automatic build proved that the current manual groups recursively hoist unrelated shared helpers into jsPDF and Sentry/Vue chunks. Removing those groups is the first measured optimization.

### A3. Separate public URL/status code from authenticated clients

- Extract pure edge URL resolution from `edgeFunctionClient.ts` into a dependency-free URL module.
- Make `systemStatusService.ts` depend on that URL module instead of the authenticated edge client.
- Keep status caching and request deduplication in one shared status store/composable.
- Make the app shell and retained landing variants consume the same status state and polling lifecycle.
- Maintain one initial status request and one five-minute visible-page poller.

### A4. Defer authenticated and heavy modules

- Remove static public-startup paths to `supabaseClient.ts`, auth/admin services, checkout network services, PDF libraries, Sentry SDK modules, PostHog SDK modules, and authenticated-only components.
- Load Supabase only when auth initialization, district lookup, or an authenticated action actually requires it.
- Keep the background HTTP session check that redirects already-authenticated visitors, but schedule it after the public app mounts and do not require the Supabase SDK for it.
- Make `OnboardingModal.vue`, notification UI, and other authenticated-only chrome async.
- Split offline queue storage/counting from checkout network submission so the app shell can display queue state without importing the authenticated request graph.
- Keep telemetry imports consent-driven and best effort.

### A5. Add an honest performance gate

Create a repository-owned checker for the JavaScript referenced by the built HTML entry and every static modulepreload. The initial target after Workstream A is:

- no more than **250,000 minified bytes** of initial JavaScript;
- no more than **100,000 gzip bytes** of initial JavaScript;
- no jsPDF, html2canvas, barcode-generation, PostHog SDK, Sentry SDK, or Supabase SDK chunk in the canonical landing route's static preload set;
- no direct request to a Supabase project host while loading `/` before user action;
- no more than one initial `system-status` request.

If a preserved behavior makes one threshold impossible, the implementation must show the measured dependency responsible and obtain approval before changing the threshold.

## Workstream B: Proven Dead Code and Dependency Removal

Every candidate is rechecked after merging `origin/main`. A candidate is deleted only when repository references, entrypoint configuration, current scripts/workflows, and relevant runtime conventions agree that it is unused.

### High-confidence candidates

- `src/pages/tenant/TenantHome.vue`
- `src/services/sessionAccessToken.ts`
- `public/vite.svg`
- `scripts/update-changelog-from-commits.mjs`, if the merged workflows and documentation still contain no invocation
- `@posthog/react`
- direct `rollup`
- `zod-to-json-schema`, because the current generator uses Zod 4's built-in `z.toJSONSchema`
- exports reported unused where the underlying function is private to its own module
- selectors with no static or dynamic class construction path, including the currently identified `.dot-button`, `.admin-section-grid`, and `.edit-actions-cell`

Package removals update both `package.json` and `package-lock.json` through npm. Source files are not deleted merely because a generic analyzer does not understand Deno, Worker, shell, or deploy entrypoints.

### Manual-review candidates to preserve by default

- `/landing-old`, `/landing-new`, and `/landing-new2`, because the README explicitly says preserved legacy surfaces may exist for reference or staged rollout
- versioned SQL files
- public brand, favicon, `humans.txt`, `security.txt`, and `llms.txt` assets that may be requested directly or by external consumers
- the duplicate repository-root `llms.txt` until its repository-facing purpose is confirmed
- legacy offline-queue migration and raw handoff rejection paths
- missing-table and missing-column fallbacks in edge functions
- any CSS class assembled dynamically, including skeleton variants

The final handoff lists every preserved manual-review candidate and the evidence that prevented automatic deletion.

## Workstream C: Frontend Decomposition and Duplication Reduction

### C1. Make `App.vue` an orchestrator

Extract responsibilities in behavior-preserving steps:

- system status, maintenance, kill-switch, and incident state;
- cookie consent and telemetry enablement;
- version polling and update overlay state;
- authenticated admin-session lifecycle and idle handling;
- offline queue count lifecycle;
- onboarding visibility and completion;
- top-banner measurement and rendering;
- authenticated navigation/chrome.

The end state is an `App.vue` that assembles route content and focused units rather than implementing each lifecycle. The target is at most 500 lines for `App.vue`; extracted units should normally remain below 400 lines and expose explicit inputs/outputs.

### C2. Simplify bootstrap code

- Replace the hard-coded subset of public bootstrap paths with router-derived public-route classification.
- Keep canonical-host redirect and password-reset recovery behavior.
- Move E2E-only controls to a dev-only module that is dynamically imported only when `VITE_E2E_TEST_UTILS=true`.
- Keep auth initialization behavior, but isolate it from public first paint.

The target is at most 300 lines for `src/main.ts`, with bootstrap decisions testable as pure helpers where possible.

### C3. Consolidate public-page behavior

- Introduce a small public-page composable for menu, scroll, copyright year, and lifecycle cleanup where contracts match.
- Introduce one product-event facade that coordinates Vercel Analytics and consent-gated PostHog without forcing either SDK into public startup.
- Reuse `PublicFooter.vue` for retained landing variants when their rendered copy and links match.
- Consolidate repeated landing status logic through the shared status unit from Workstream A.
- Extract coherent sections from the active landing page only when the rendered DOM, accessibility semantics, and payload remain unchanged.

Do not force visually or semantically different pages through a single configurable mega-component.

### C4. Split oversized services by domain

- Separate encrypted offline queue storage/locking/migration from checkout network operations.
- Split `authService.ts` into session bootstrap, tenant login, district handoff, privileged/super auth, and sign-out units while preserving its public facade during migration.
- Split large super-admin service facades only where action groups already have distinct request contracts.
- Keep identity generation, validation, and formatting logic centralized only when clients share the exact same rule.

The compatibility facade permits callers to migrate incrementally and prevents a broad import rewrite in one commit.

## Workstream D: Cloudflare Worker and Supabase Function Decomposition

This workstream runs only after frontend and shared regression gates are stable.

### D1. Repair the Worker test/type boundary

- Generate or declare the correct Cloudflare runtime types through the repository's Wrangler toolchain.
- Fix the current refresh-result narrowing and `BufferSource` typing issues without changing response behavior.
- Add a repeatable Worker typecheck/test command instead of relying permanently on `deno test --no-check`.

### D2. Decompose the Worker

Split `cloudflare/edge-proxy/src/index.ts` into focused modules for:

- environment/runtime types and constants;
- CORS and request sanitization;
- trusted-ingress signing;
- session cookies and refresh;
- Supabase API/function proxying;
- maintenance fallback;
- Worker observability;
- the final route dispatcher.

The entry module should normally remain below 500 lines. Existing exported test seams remain stable or receive equivalent focused tests before moving.

### D3. Extract pure shared edge primitives

Create shared Deno helpers only for repeated contracts such as:

- missing relation/column error classification;
- bounded request metadata sanitization;
- common response/CORS construction where headers are identical;
- repeated pure normalization and formatting rules.

Each helper receives direct Deno tests before endpoint adoption.

### D4. Split oversized handlers without hiding security order

For `super-ops`, `super-tenant-mutate`, `admin-ops`, and other oversized handlers:

- keep `serve`, CORS, trusted-ingress, authentication, role checks, verification/session checks, kill-switch checks, and rate limiting explicit in the entrypoint;
- move post-authorization action bodies into domain modules;
- preserve action names, payloads, status codes, error envelopes, audit writes, and database calls;
- migrate one action family per commit and run relevant tests after each move.

No shared abstraction may make it harder to see whether an action is authorized.

## Workstream E: Styles, Assets, Dependencies, and Generated State

- Split global CSS by responsibility so public startup does not download authenticated table/admin styles.
- Keep base tokens, accessibility utilities, and truly global layout in the initial stylesheet.
- Keep route/component styles colocated or asynchronously imported with their owning route.
- Re-run image budgets; retain the responsive WebP landing images and PNG fallbacks unless browser evidence proves a fallback unnecessary.
- Apply only patch/minor dependency updates that remain inside the merged manifest's existing compatibility ranges and are independently verifiable.
- Do not add Vue Router, TypeScript, CycloneDX, or other major migrations solely for modernization. Major versions already merged into `origin/main` are the implementation baseline and are not rolled back by this sprint.
- Align `deno.lock` with the merged source and package state, then use frozen verification where supported so tests do not silently mutate it.
- Regenerate edge schema/reference artifacts only through the repository scripts and verify generated diffs are deterministic.

## Runtime Data Flow After Cleanup

### Canonical public route

1. HTML loads the minimal Vue/router entry and base/public CSS.
2. Router resolves the public route without importing authenticated services.
3. Public shell and the requested page render.
4. Shared status state performs one edge-proxy status request and schedules visible-page refreshes.
5. Cookie-consent state determines whether telemetry SDKs may load.
6. A low-priority HTTP session summary check may redirect an existing authenticated session.
7. Supabase, PDF, admin, checkout, and dashboard modules remain unloaded until their route or action requires them.

### Protected route

1. Bootstrap loads the auth/session boundary.
2. Router guards evaluate the existing session, tenant, district, role, tenant-match, and privileged-verification rules.
3. The relevant authenticated shell and route chunk load.
4. Services call the Cloudflare proxy/Supabase functions through existing request envelopes.
5. Server entrypoints enforce trusted ingress and authorization before dispatching to extracted action modules.

## Error Handling

- Public status failure returns unknown/degraded UI without blocking render.
- Telemetry import or delivery failures remain non-fatal and never bypass consent.
- Dynamic import failures use the existing global recovery surface; any new loader catches only where it can provide an equivalent user-visible fallback.
- Auth bootstrap timeouts and failures retain current fallback/clear-state behavior.
- Authenticated requests retain request IDs, retry rules, error envelopes, and fail-closed authorization.
- Offline queue read/migration failures retain current warning and recovery behavior.
- Refactoring does not convert logged failures into silent failures.

## Verification Strategy

### After every task-sized change

- verify imports, exports, routes, and references;
- run the narrowest affected test;
- run `git diff --check`;
- inspect the diff for unrelated churn.

### After every workstream

- `bash ./scripts/check-env-parity.sh`
- clean prior `dist` artifacts using the same CI policy
- `npm run build`
- `npm run perf:budget`
- `npm run perf:images`
- the new initial-load closure check
- focused Playwright tests for affected routes
- relevant Deno or Worker tests

### Final verification

- full 31-test-or-later Playwright suite
- all Supabase shared Deno tests with required permissions and frozen lock behavior
- Worker runtime tests and the new typecheck gate
- `npm run security:gate`
- full CI-core performance sequence
- edge contract and SQL coupling checks
- dead-code/reference re-scan with Deno/Worker/script entrypoint false positives excluded
- duplication report compared with the 2026-07-10 baseline
- fresh production-preview request trace for `/`
- clean `git status --short --branch`

Tests prove only the behavior they cover. The final audit must also inspect routes, imports, generated output, browser network activity, and the complete diff.

## Completion Criteria

The sprint is complete only when all of the following are true:

1. Every high-confidence dead-code candidate is removed or documented with new evidence showing it is live.
2. Unused direct dependencies are removed and package/lock state is consistent.
3. The canonical landing route meets the initial JavaScript and network criteria from Workstream A.
4. The performance gate measures the actual root entry preload closure.
5. `App.vue`, `main.ts`, the Worker entry, and named oversized edge handlers have been decomposed into focused units or have a documented reason that further splitting would make security/maintenance worse.
6. Repeated public status, public-page lifecycle, form, and edge helper logic is either shared or intentionally documented as contractually different.
7. No protected workflow, security boundary, database behavior, or public rendering behavior changes.
8. All workstream and final verification gates pass from a clean checkout-compatible state.
9. Manual-review candidates are listed with evidence rather than deleted speculatively.
10. The final report compares before/after files, dependency counts, duplicate-code metrics, initial payload, network requests, and verification results.

## Commit and Review Strategy

- Commit the approved design and implementation plans separately from source changes.
- Use one reviewable commit per task-sized cleanup or extraction.
- Keep performance, dead-code, frontend decomposition, Worker, and Supabase-function changes in distinct commit groups.
- Never combine a security-sensitive extraction with unrelated style, dependency, or generated-file churn.
- Re-run the relevant verification before each commit and the full verification before declaring completion.
