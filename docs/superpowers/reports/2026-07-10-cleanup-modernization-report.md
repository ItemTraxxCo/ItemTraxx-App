# ItemTraxx Cleanup and Modernization Audit

**Audit date:** 2026-07-13

**Branch:** `dev/mmango10`

**Final verified implementation head:** `50d48c94f753dde9ba2ed06bc063514269b7fcab`

**Status:** PASS. Tasks 1-8 and the umbrella review closure are complete. The
clean-checkout-equivalent final verification passed at `50d48c94`; this report is
committed only after those results and the protected-flow traces were recorded.

## 1. Executive outcome and scope

The four-plan cleanup decomposed the public bootstrap, frontend shell and services,
Cloudflare Worker, and the three largest Supabase Edge Function handlers; split
public from authenticated CSS; removed only reference-proven dead code and direct
dependencies; aligned generated edge contracts; and added repeatable payload,
CSS-ownership, Worker-type, action-parity, and fresh landing-network gates.

The current production landing artifact is below the approved 250,000-byte
minified and 100,000-byte gzip JavaScript thresholds. The Task 6 production trace
records one proxied `system-status` request, no direct Supabase project request,
and no forbidden SDK request before user action. Task 8 independently rebuilt the
app and refreshed the same payload and network invariants before recording PASS.

The sprint intentionally did not redesign product flows, change database schema or
RLS, broaden dependency ranges, merge contractually different auth/forms/edge
handlers, delete versioned SQL or externally addressed assets, or remove schema
compatibility fallbacks. The report attributes the full branch range carefully:
two user commits are interleaved with the cleanup work, and the immediate
post-merge lock alignment is called out separately below.

## 2. Baseline, branch state, and attribution

| Item | Exact evidence | Interpretation |
| --- | --- | --- |
| Approved analysis baseline | `docs/superpowers/specs/2026-07-10-codebase-cleanup-modernization-design.md` | Captured before the baseline merge on 2026-07-10. Its `about 1.30 MB` and `18 requests` landing figures are explicitly approximate. |
| Baseline merge | `e95f75643f87af6e30c637a8d236040b6de6c2fa` | `git show -s --format='%H%n%P' e95f7564` reports parents `6a99043d8130b39ad26c9d66b1c05b459adb704f` and `a1a1113222fdd401b58b9ac763b9ef6e6bac7487`. |
| Immediate merged-dependency alignment | `119b1fe053f5b72de38a720e1b5bc3459fd87833` | Lock-only Deno alignment after the merge; it is not an edge behavior rewrite. |
| Interleaved user commits | `f2f43406 refactor reciept pdf service`; `1006f461 refactor error messages` | These are retained in the branch history and are not silently attributed to cleanup tasks. |
| Final implementation head | `50d48c94f753dde9ba2ed06bc063514269b7fcab` | Final verified production-source head. It includes the reviewed umbrella fixes and rendered recovery/fallback hardening. |
| Task 8 executable-gate correction | `f6c3ad7c docs: correct final deno verification gate` | Plan-only commit after review; it scopes Deno read access to `supabase/functions/super-tenant-mutate/actions`. Production source and the report are not part of the commit. |
| Prior Task 8 implementation snapshot | `git diff --stat e95f7564..3d07b74f` | 232 files, 44,690 insertions, 13,918 deletions before umbrella review fixes. |
| Initial report snapshot | `git diff --stat e95f7564..6aab2bd2` | 233 files, 45,143 insertions, 13,918 deletions after the initial report commit. This snapshot is not mislabeled as the implementation-head diff. |
| Final verified implementation-head diff | `git diff --stat e95f7564..50d48c94` | 233 files, 45,684 insertions, 13,967 deletions. These totals stop at the final verified implementation head. |
| Final implementation-head divergence | `git rev-list --left-right --count 50d48c94...origin/main`; same command against `origin/dev/mmango10` | At the source state actually verified: 113 ahead / 3 behind `origin/main`, and 116 ahead / 0 behind the branch remote. |
| Terminal post-report divergence | `git rev-list --left-right --count HEAD...origin/main`; same command against `origin/dev/mmango10` | 114 ahead / 3 behind `origin/main`, and 117 ahead / 0 behind the branch remote after this report-only closure commit. The three unmerged upstream commits remain `16140b45`, `b13591fc`, and `cc7d03a9`; no merge, rebase, cherry-pick, reset, or push was performed. |
| Final verified implementation/result commit | `50d48c94f753dde9ba2ed06bc063514269b7fcab` | Every final gate and protected-flow trace below was run against this production-source state. |
| Report commits | `6aab2bd2 docs: report codebase cleanup results`; `ca8d9d52 docs: correct cleanup audit evidence`; follow-up subject `docs: close umbrella cleanup audit` | The follow-up changes this report only. Its self-referential hash is intentionally omitted; resolve it with `git log -1 --format=%H -- docs/superpowers/reports/2026-07-10-cleanup-modernization-report.md`. |

The range `e95f7564..50d48c94` is used for final implementation before/after accounting.
Task-level ownership comes from `.superpowers/sdd/progress.md` and the task reports;
the range itself is not treated as proof that every change is cleanup-owned.

## 3. Architecture and file ownership after cleanup

### Public startup

- Vite 8 automatic splitting replaced the manual vendor grouping. The authoritative
  gate now follows the entry script and every static modulepreload through
  `scripts/check-initial-load-budget.mjs` and the build-only module ownership map.
- `src/services/edgeUrls.ts` owns dependency-free edge URL resolution.
  `src/services/systemStatusService.ts` no longer traverses the authenticated edge
  client, and `src/services/publicAuthBootstrap.ts` performs the non-blocking HTTP
  session summary without eagerly importing Supabase.
- Consent and client monitoring remain best effort and SDK loading remains
  consent-driven. Auth, Supabase, checkout, PDF/barcode, PostHog, and Sentry SDK
  owners are absent from the canonical static preload closure, as shown by
  `artifacts/initial-module-map.json` and `npm run perf:initial:report`.

### Frontend shell and services

- `src/App.vue` is an orchestrator over focused lifecycle composables and the
  `AppBlockingOverlays`, `AppTopBanners`, and async authenticated-navigation units.
- `src/main.ts` derives route/bootstrap behavior through focused helpers, loads E2E
  controls only in the development E2E mode, and delegates monitoring startup to
  `src/bootstrap/clientMonitoring.ts`.
- `src/services/authService.ts` is now a compatibility facade over session
  bootstrap, tenant login, district handoff, privileged login, sign-out, shared
  state, and types. `src/services/checkoutService.ts` remains the network/replay
  facade while `src/services/offlineCheckoutQueue.ts` owns AES-GCM storage,
  migration, warning state, operation IDs, Web Locks, and lease fallback.
- Super-admin frontend calls are partitioned under `src/services/superOps/` by
  control center, sessions, support, sales/customers, and internal operations.

### Cloudflare Worker

- `cloudflare/edge-proxy/src/index.ts` now dispatches through focused routing,
  CORS, response, ingress, cookies/session, Supabase proxy, maintenance fallback,
  and observability modules.
- Generated `worker-configuration.d.ts`, `worker:types:check`, `worker:typecheck`,
  and 63 focused Worker tests establish a first-class runtime/type boundary.
- The entrypoint still visibly owns dispatch order and `ctx.waitUntil`; non-status
  responses remain streamed, while the maintenance status inspection retains its
  explicit 64 KiB bound.

### Supabase Edge Functions

- `super-ops`, `super-tenant-mutate`, and `admin-ops` keep CORS, trusted ingress,
  kill switch, authentication, authorization/role/session/step-up, and rate-limit
  order in their entrypoints. Only already-authorized action bodies moved into
  domain action modules.
- Runtime registries retain exactly 26, 10, and 11 actions respectively. The
  current parity gate reports generated request/response parity for `super-ops`
  26/26, `super-tenant-mutate` 10/10, and `admin-ops` 11/11. Every generated
  `super-ops` and `super-tenant-mutate` success response schema now requires a
  top-level boolean `ok`; admin and tenant-admin contracts remain unchanged.
- Pure identical helpers were shared narrowly: PostgREST missing relation/column
  classification, bounded metadata, SHA-256 formatting, and Worker JSON response
  construction. Endpoint-specific status, failure, audit, and compatibility
  behavior remains local where contracts differ.

### CSS, generated contracts, and verification tooling

- The deleted `src/style.css` ownership was replaced by public
  `tokens.css`, `base.css`, and `app-shell.css`, plus asynchronously loaded
  `authenticated.css` and route-scoped styles. The built public CSS boundary gate
  currently finds only `index-CfrdwCVn.css` and zero authenticated selectors.
- `src/types/edgeSchemas.mjs` is the source for deterministic schema/OpenAPI
  generation. The internal operations snapshot, support privacy field,
  subprocessor actions, and `revoke_current_session` are represented in generated
  state. Shape-level tests lock the required top-level `ok` contracts, and
  `npm run devops:check:edge-contract-drift` regenerated three temporary artifacts
  and reported all three committed files in sync. Generation remains deterministic.
- CI now owns initial JS, public CSS, Worker type/test, edge action parity,
  generated drift, edge coverage, and existing SQL-coupling gates. The heavier
  production Chromium network trace remains a local/final gate by design.

## 4. Oversized-file and stylesheet measurements

`git show e95f7564:<path> | wc -l` supplies the exact merged baseline. The approved
design's pre-merge measurements are retained separately; they match the merged
baseline only for the files the design explicitly named. The design did not
separately record `checkoutService.ts`. Current values come from `wc -l` at
`50d48c94`.

| File | Approved pre-merge baseline | Exact merged baseline | Current | Net entrypoint/facade reduction |
| --- | ---: | ---: | ---: | ---: |
| `src/App.vue` | 1,565 | 1,565 | 371 | -1,194 |
| `src/main.ts` | 434 | 434 | 240 | -194 |
| `src/services/authService.ts` | 1,119 | 1,119 | 25 | -1,094 |
| `src/services/checkoutService.ts` | Not separately recorded | 490 | 207 | -283 |
| `cloudflare/edge-proxy/src/index.ts` | 1,375 | 1,375 | 173 | -1,202 |
| `supabase/functions/super-ops/index.ts` | 2,198 | 2,198 | 227 | -1,971 |
| `supabase/functions/super-tenant-mutate/index.ts` | 1,635 | 1,635 | 236 | -1,399 |
| `supabase/functions/admin-ops/index.ts` | 1,418 | 1,418 | 299 | -1,119 |

These reductions are ownership moves, not equivalent-code deletions. The new
domain modules keep the same contracts behind smaller entrypoints/facades.

The merged `src/style.css` was exactly 1,692 source lines and is now absent. Current
global owners are 57 lines of tokens, 229 base, 1,055 app shell, and 269
authenticated CSS (1,610 lines total), with single-route rules additionally
owned by scoped Vue styles. Source-line movement is not used as a payload proxy.
Reviewed Task 2 artifacts and the current build provide the built CSS comparison:

| Build stage / owner | Raw bytes | Gzip bytes | Loading contract |
| --- | ---: | ---: | --- |
| Reviewed pre-split public entry `index-CXkWcj8R.css` | 27,292 | 5,780 | All 12 authenticated selectors were still in the public entry. |
| Reviewed Task 2 post-split public entry `index-CfrdwCVn.css` | 23,198 | 4,954 | Public entry after the ownership split. |
| Current public entry `index-CfrdwCVn.css` | 23,198 | 4,935 | Public raw bytes remain identical; current boundary scan reports zero authenticated selectors. |
| Current authenticated `authenticated-DZzVJC1c.css` | 3,464 | 1,120 | Loaded before protected UI; absent from public startup. |

The reviewed Task 2 split reduced the public entry by exactly 4,094 raw bytes and
826 gzip bytes. The current entry remains 4,094 raw bytes smaller than the
reviewed pre-split entry (15.0%) and is 845 gzip bytes smaller by the current
measurement (14.6%). The raw post-split bytes and asset hash are stable. The
current gzip result is 19 bytes smaller than Task 2's post-split measurement;
that compressed-size delta is build/zlib measurement variability, not a further
CSS source or ownership change.

## 5. Dependencies

`package.json` at the merged baseline contained 12 dependencies and 13
devDependencies. The current manifest contains 11 and 11.

- Removed direct dependencies with reference evidence: `@posthog/react`.
- Removed direct devDependencies with reference/script evidence: `rollup` and
  `zod-to-json-schema`. Vite 8 uses Rolldown and the generator uses Zod 4's
  built-in JSON-schema support.
- In-range Task 4 updates changed the Supabase client family from 2.110.2 to
  2.110.3, Sentry from 10.64.0 to 10.65.0, PostHog from 1.399.0 to 1.399.2,
  and `@posthog/core` from 1.40.0 to 1.40.2. Manifest ranges were not widened.
- Preserved tooling includes Wrangler, Supabase CLI, Playwright, Cloudflare's Vite
  plugin, and `@cyclonedx/cyclonedx-npm`. Knip cannot infer the CycloneDX binary
  invocation in `scripts/generate-sbom.sh`, but `security:sbom` proves ownership.
- Current `npm outdated --json` reports only out-of-range or exact-pin choices:
  `@cloudflare/vite-plugin` 1.43.1 (latest 1.44.0), Wrangler 4.107.1 (latest
  4.110.0), TypeScript 6.0.3 (latest 7.0.2), and Vue Router 4.6.4 (latest
  5.1.0). The plan deliberately defers these minor/exact-pin or major changes.
- `npm ls --depth=0` reproduces npm's optional `@emnapi/runtime@1.11.1
  extraneous` artifact. Task 4 showed a fresh `npm ci` recreates it; it is not a
  manifest dependency or evidence for a speculative source edit.

## 6. Duplicate-code audit

The exact final Task 8 command was:

```bash
npx -y jscpd src supabase/functions cloudflare/edge-proxy/src \
  --min-lines 8 --min-tokens 70 --reporters console
```

It analyzed 486 files and reported 277 clone groups, 5,635 duplicated lines out
of 147,204 (3.83%) overall. By parsed format: CSS 1,014/28,917 (3.51%), HTML
389/30,981 (1.26%), JavaScript 63/948 (6.65%), TypeScript 4,169/55,354
(7.53%), and Vue 0/31,004 (0.00%).

The design's approximately 9.35% duplicated TypeScript baseline is **not directly
comparable** to this final command. The current command includes explicit `src`,
Supabase, and Worker scopes and jscpd parses Vue subparts into CSS/HTML/TypeScript
while also reporting a separate empty Vue bucket. The report therefore presents
the reproducible current result without claiming an unsupported percentage-point
improvement.

Remaining clusters are dominated by contract-distinct public form/auth screens,
route-owned visual CSS, admin list/detail presentation, Worker-versus-Deno ingress
helpers, and explicit Edge authorization/error scaffolding. They were retained
where sharing would obscure ownership, security order, provider failure behavior,
payloads, or route-specific presentation.

## 7. Landing JavaScript, CSS, and fresh network evidence

The approved design recorded an approximate pre-merge `/` load of about 1.30 MB
minified JavaScript in 18 requests. Once the merged baseline analyzer existed,
`npm run perf:initial:report` measured the comparable static closure exactly at
11 assets, 1,270,192 minified bytes, 401,702 gzip bytes, and 306 forbidden module
ownership matches. That exact merged baseline comes from the Task 2 report.

At the current implementation head, the same analyzer reports nine assets,
189,583 minified bytes and 66,584 gzip bytes with an ownership map and zero
forbidden modules. Relative to the exact merged closure, that is 1,080,609 fewer
minified bytes (85.07%) and 335,118 fewer gzip bytes (83.42%).

Current initial assets from `npm run perf:initial:report`:

1. `appErrorRecovery-qpgkDhHW.js`
2. `appErrors-BcYISgze.js`
3. `authState-7tDta680.js`
4. `cookieConsentService-QioYVWQJ.js`
5. `edgeUrls-B2tvSMcX.js`
6. `index-DD83kMNH.js`
7. `preload-helper-Czpn1I53.js`
8. `reactivity.esm-bundler-DEPiGFhz.js`
9. `rolldown-runtime-QTnfLwEv.js`

`artifacts/landing-network.json`, regenerated by Task 8 at the final implementation
head, records:

| Invariant | Current exact result |
| --- | ---: |
| Raw requests | 24 |
| Sanitized unique URLs | 24 |
| `system-status` requests | 1 |
| Direct Supabase project-host requests | 0 |
| Forbidden SDK requests | 0 |
| Initial minified JS | 189,583 bytes |
| Initial gzip JS | 66,584 bytes |
| Violations | 0 |

The current 24-request trace should not be read as an 18-to-24 regression claim:
the design's 18 was an approximate earlier observation, while the current trace
captures document, JavaScript, CSS, responsive images, logo, proxied HTTP session
and status calls, and Google font resources with a sanitized unique-URL policy.
The stable completion criteria are the payload limits and the one-status,
zero-direct-Supabase, zero-forbidden-SDK invariants.

## 8. Proven removals

The deletion standard combined route/import searches, script/workflow ownership,
external path conventions, dynamic class construction, Knip interpretation, build,
security, and focused browser tests.

| Removed item | Reference evidence |
| --- | --- |
| `src/pages/tenant/TenantHome.vue` | No route/import; `/tenant` redirects to `/tenant/checkout`. |
| `src/services/sessionAccessToken.ts` | No live import/caller after the edge-cookie migration; the exclusive stale Sentry filter branch was removed with it. |
| `src/services/superOpsService.ts` | Repository import/reference scans and Knip found no consumer; the focused replacement modules under `src/services/superOps/` are the live owners. Its deletion was implemented and independently reviewed in `3d07b74f`. |
| `scripts/update-changelog-from-commits.mjs` | No package script, workflow, documentation, environment, or shell invocation. |
| `public/vite.svg` | No HTML/source/config/test/script reference and no conventional ItemTraxx public contract. |
| `.dot-button`, `.admin-section-grid`, `.edit-actions-cell` | No static or constructed-class consumer; complete rule groups removed. |
| `.serial-number.dim` | Task 2 ownership matrix and source/build scan found no exact static or dynamic consumer. |
| `@posthog/react`, direct `rollup`, `zod-to-json-schema` | No live import or executable owner; current owned alternatives are `posthog-js`, Vite/Rolldown, and Zod 4. |

No responsive landing image, conventional public metadata file, Deno/Worker
entrypoint, deploy script, SQL history, dynamic skeleton/status/broadcast class,
or analyzer-only candidate was deleted on Knip evidence alone.

## 9. Verification ledger

### Reviewed task checkpoints already completed

The task reports and independent reviews in `.superpowers/sdd/progress.md` record:

- Plan 1: build/security/performance and 37-test Workstream A checkpoint, followed
  by the final Plan 2 checkpoint's expanded suite.
- Plan 2: exact service/auth/offline queue behavior, 100/100 Playwright, security
  and performance gates, and final `App.vue`/`main.ts` acceptance.
- Plan 3: Worker type generation/typecheck and 63/63 tests; scoped Deno format;
  101/101 frozen Deno tests; three entrypoint checks; edge coverage, generated
  drift, SQL coupling, build/security, and 100/100 Playwright.
- Plan 4 Tasks 1-6: 17 CSS-checker unit tests; CSS split with 104/104 Playwright;
  complete asset/browser fallback audit; dependency install/audit/SBOM/build,
  Worker 63/63 and Playwright 104/104; exact generated action parity and frozen
  state; and the reviewed production landing trace.

### Umbrella review closure

- `2b51cfa8 fix: correct kill-switch status links` corrected the malformed
  kill-switch status URL while preserving the status-page destination and fallback
  copy.
- `1e7728cb fix: align super response contracts with runtime` aligned strict
  top-level `ok` success-response contracts, added exact 10-action
  `super-tenant-mutate` parity, and added shape-level generated-contract tests.
- `50d48c94 test: verify rendered kill-switch recovery` hardened rendered link and
  fallback coverage. The exact `https://status.itemtraxx.com/?ref=killswitch` link,
  fallback message, and live HTTP 200 status were verified; no malformed live URL
  remains.
- The original umbrella reviewer re-reviewed the fixes and approved the branch
  with no remaining findings. These commits do not change SQL, RLS, or deployment
  configuration.

### Commands rerun while drafting Task 7

- `node --version`: `v22.15.0`.
- Current/baseline `wc -l` and dependency counts: recorded in Sections 4 and 5.
- `npm run perf:initial:report`, `npm run perf:report`, `npm run
  perf:css-boundary`, `npm run perf:budget`, and `npm run perf:images`: exit 0.
- `npm run devops:check:edge-action-parity`: Task 7's then-current two registries
  matched; umbrella closure expanded the gate to the three-endpoint result in the
  final verification table.
- `npm run devops:check:edge-contract-drift`: three artifacts in sync.
- Corrected the Task 8 plan command and ran it exactly:
  `deno test --allow-env
  --allow-read=supabase/functions/super-tenant-mutate/actions --frozen
  supabase/functions/_shared/*_test.ts supabase/functions/super-ops/*_test.ts
  supabase/functions/super-tenant-mutate/*_test.ts
  supabase/functions/admin-ops/*_test.ts`; 101 passed, 0 failed. The plan-only
  correction is commit `f6c3ad7c`.
- `npx -y knip --reporter compact`: completed with classified findings in
  Section 12; analyzer output is not represented as a clean pass.
- The exact jscpd command in Section 6: completed with the reported table.
- `git diff --stat`, `git diff --name-status`, remote divergence, generated-state
  diff, and current artifacts: inspected.

### Final lead-owned clean-checkout-equivalent verification

All enforcing gates below exited 0 at `50d48c94` on 2026-07-13. Knip is an
explicitly characterized analyzer rather than an enforcing zero-finding gate.

| Command or gate | Exact current result |
| --- | --- |
| `node --version`; `npm ci --ignore-scripts` | `v22.15.0`; 321 packages installed, 322 audited, 0 vulnerabilities. |
| `bash scripts/check-env-parity.sh` | PASS against `.env.example`. |
| Edge coverage, contract drift, action parity, SQL coupling | PASS: 27 functions / 24 mapped targets; three generated artifacts in sync; admin 11, super 26, and super-tenant 10 actions exact; no SQL changed. |
| Clean build and performance gates | PASS: 990 modules transformed; initial closure 9 assets / 189,583 minified / 66,584 gzip / 0 forbidden modules; CSS boundary 0 violations; main 159,975 bytes; canonical landing 14,404 bytes; image budget and report PASS. |
| `node --test scripts/*.test.mjs` | 44 passed, 0 failed. |
| `npm run security:gate`; `npm run security:sbom` | PASS: no moderate-or-higher npm vulnerability, unsafe dynamic execution, or sample-env secret assignment; 15 shared security tests passed; CycloneDX SBOM generated. |
| Worker declaration/type/test gates | Types current; TypeScript PASS; 63 passed, 0 failed. |
| Corrected frozen Deno suite | 101 passed, 0 failed with `--allow-env --allow-read=supabase/functions/super-tenant-mutate/actions --frozen`. |
| Frozen Deno checks | `super-ops`, `super-tenant-mutate`, and `admin-ops` entrypoints all checked successfully. |
| Generated-state no-drift | `git diff --exit-code` PASS for `deno.lock`, Worker declarations, generated schema/OpenAPI, and endpoint reference. |
| Chromium install and full browser suite | Chromium present; 104 passed in 30.4 seconds. |
| Fresh production landing network | PASS: 24 raw / 24 sanitized unique requests; one system status; zero direct Supabase; zero forbidden SDK; 189,583 minified / 66,584 gzip. |
| jscpd | Characterized: 486 files, 277 clones, 5,635 / 147,204 duplicated lines (3.83%); JavaScript 63 / 948 (6.65%); TypeScript 4,169 / 55,354 (7.53%). |
| Knip compact | Characterized: 115 unused-file findings, one devDependency, five unresolved-import groups, and two exported types. The deleted super-ops facade is absent. |
| Removed-candidate and whitespace scans | Focused file/import/reference scans are clean; `git diff --check` PASS. The plan's combined token scan has the false-positive described below. |
| Process cleanup | No final-verification Vite preview, Playwright, or test Chromium process remained after the traces. |

The exact plan `rg` token list is nonzero because `sessionAccessToken` remains a
legitimate local/parameter name on eight Worker lines, containing ten token
occurrences, across `requestHeaders.ts`, `functionProxy.ts`, and
`supabaseApiProxy.ts`. That token is not the deleted frontend module. A focused
`test ! -e src/services/sessionAccessToken.ts`, import-pattern scan across
source/tests/scripts,
and separate scan for every other removed candidate all passed with no output.
Renaming live Worker locals to satisfy an overbroad token scan would not improve
ownership or behavior, so the audit records the command false positive instead.

Generated-state SHA-256 values after every gate:

- `deno.lock`: `87e0958fc7dc29604fef025b72a371b82b1788cb742e967af4556e2ba70e5e20`
- `cloudflare/edge-proxy/worker-configuration.d.ts`: `6fced50d9ecfe9723af42b5b8e0e912a3e4dcc9e4228f9f412625a89869fab4c`
- generated schema: `0fde134676a6b105e4e74965414b6d9632758a09b8ee58eac43ffa5efaaea09d`
- generated OpenAPI: `3d245600dab828988ad94f27e1b458c034bc959b81947cfbd592b77979846880`
- endpoint reference: `6e72e892af27ff93cde1542a9235ad7c1fa7d2ab3f54f814c7605795885dfd5b`

## 10. Protected-flow preservation matrix

The complete 104-test Chromium run, current code traces, and two direct production
preview traces refresh the matrix below at the final implementation head.

| Protected contract | Named evidence | Final verification status |
| --- | --- | --- |
| Checkout and return | `checkout-borrower-ownership.spec.ts` — “checkout by borrower A, borrower B blocked, return by borrower A allowed”; the current facade trace keeps separate `checkout` and `return` edge envelopes. | PASS. |
| Offline encrypted buffer/replay | Seven `checkout-offline.spec.ts` contracts cover encrypted bytes, legacy migration, corruption warning, exclusive lock, count and operation ID; `protected-routes.spec.ts` covers badge transitions; the facade still delegates queue durability/replay to `offlineCheckoutQueue.ts`. | PASS. |
| Auth/bootstrap | `auth-edge-cases.spec.ts` covers public unauthenticated bootstrap, authenticated-role redirect, suspended fail-closed behavior, and protected first mount; `protected-routes.spec.ts` covers protected bootstrap. | PASS. |
| Tenant admin | Current tests cover fresh 15-minute verification and expiry, protected admin routes, the mutation-guard matrix, suspended write rejection, heartbeat, termination, and rotated-lineage revocation. | PASS. |
| District handoff | `auth-edge-cases.spec.ts` passed one-time-code consume/scrub and deprecated raw-token rejection with zero exchange; code trace confirms raw token names are scrub-only. | PASS. |
| Super admin | Password challenge, OTP/passkey success and fail-closed mismatch, 15-minute expiry, navigation, and exact domain envelopes all passed. | PASS. |
| Logout and session revocation | Returned/thrown `session_not_found` logout-order tests and the heartbeat/termination/invalid-validation/rotated-lineage revocation suite passed. | PASS. |
| Password reset | All three `password-recovery.spec.ts` tests passed: normalized forgot request, error rendering, recovery update, and local-only Supabase sign-out. | PASS. |
| Internal host `/` | A direct production-preview trace with hostname resolution and a temporary ignored Vite allowlist (removed after use) followed `internal.itemtraxx.com/ -> /auth`, rendered “Internal Login | ItemTraxx”, loaded route-owned `InternalAuth` CSS, and made zero global authenticated-CSS requests. `get_internal_ops_snapshot` envelope coverage also passed. | PASS. |
| Unauthorized protected navigation | A direct production-preview trace followed `/tenant/checkout -> /`, rendered the public landing page, and made zero authenticated-CSS requests. | PASS. |
| Authenticated public redirect | `auth-edge-cases.spec.ts` passed authenticated role redirect and the separate tenant-admin marketing-route contract. | PASS. |
| Kill switch | `public-and-legal.spec.ts` passed public-home availability, unavailable routing, rendered `https://status.itemtraxx.com/?ref=killswitch`, and exact fallback copy; the live status URL returned HTTP 200. Worker dispatch tests retained allowlist/exemption order, and no malformed live URL remains. | PASS. |
| Maintenance | Route block/cached message and overlay-precedence tests passed; Worker tests retained the 64 KiB status-read bound and fallback behavior. | PASS. |
| Consent telemetry | Preference persistence, app-shell synchronization, and no-PostHog-before-consent tests passed; the fresh network trace found zero forbidden SDK requests. | PASS. |
| Deployment dry validation | `python3 scripts/deploy-supabase-functions.py --dry-run` printed all 26 function commands. `bash scripts/deploy-cloudflare-worker.sh --dry-run` exercised Wrangler's native dry run at 43.84 KiB upload / 9.75 KiB gzip with the expected bindings. No deployment occurred. | PASS. |

## 11. Preserved manual-review ledger

| Preserved candidate | Evidence and reason | Risk if removed or generalized |
| --- | --- | --- |
| `/landing-old`, `/landing-new`, `/landing-new2` | All remain explicit routes in `src/router/index.ts`; public lifecycle/status tests exercise the retained variants. | Breaks staged/reference surfaces and external links. |
| Versioned SQL/migration history | 46 tracked `supabase/sql/*.sql` files; `git diff --name-status e95f7564..HEAD -- supabase/sql` is empty. | Loses ordered deployment/history and can invalidate production schema assumptions. |
| Public brand, favicon, well-known, and metadata assets | Task 3 inventoried all 19 public files and previewed exact paths/types/bytes, including logos, icons, manifest, robots, sitemap, `humans.txt`, root and well-known `security.txt`. | Breaks browser, crawler, security-disclosure, social, or externally addressed contracts that do not appear in imports. |
| Root and public `llms.txt` | Both are byte-identical 2,155-byte files but serve repository-facing and deployed-root consumers. | Collapsing them without an owner decision can remove one consumer surface. |
| Responsive WebP and PNG fallbacks | Eight landing assets were retained. Real Chromium selected responsive WebP at desktop/mobile densities and an unsupported-source probe selected the PNG `<img>` fallback. | Browser/format/resolution regression. |
| Legacy encrypted offline queue migration/replay and locking | `offlineCheckoutQueue.ts` retains plaintext-array migration, AES-GCM envelope, Web Locks, lease fallback and warning recovery; seven browser tests plus a real-facade replay trace cover it. | Data loss, duplicate transactions, plaintext retention, or concurrent replay. |
| Raw district-handoff rejection/allowlist behavior | Raw `itx_at`/`itx_rt` parameters are scrubbed and rejected; the browser test proves no exchange. Only the one-time code path is consumed. | Credential leakage or re-enabling a deprecated token channel. |
| Missing-table/missing-column compatibility | Shared strict classifiers and opt-in schema-cache behavior are tested; admin session/settings/status and super-tenant actions retain explicit retry/fallback order. | Breaks mixed production-schema rollouts or broadens errors unsafely if overgeneralized. |
| Dynamic skeleton/status/broadcast classes | Source scans find template strings and conditional construction in `SkeletonLoader.vue`, status state/pages, camera scanner, and app banners. Task 2's matrix preserved their CSS owners. | Analyzer-only deletion would cause silent loading/status/banner styling regressions. |
| Worker and app Wrangler choices | `cloudflare/edge-proxy/wrangler.toml` is byte-unchanged from the merge: compatibility date `2026-02-11`, exact vars/function allowlist, KV and two rate-limit bindings, disabled workers.dev/preview URLs, and custom domain `edge.itemtraxx.com`. Root `wrangler.jsonc` is also unchanged: `2026-06-11`, `nodejs_compat`, assets SPA fallback, and observability enabled. | Unreviewed runtime/API compatibility, binding, route, or telemetry changes. |
| Form duplication | Contact sales/support/demo/security forms retain endpoint, category, payload, validation, copy, privacy, and failure differences. | A mega-form can silently normalize distinct public contracts. |
| CSS duplication | Route-owned public/auth/admin visual rules remain local when component semantics or loading ownership differ. | Sharing can pull protected CSS into public startup or couple unrelated designs. |
| Edge duplication | Authorization order, failure envelopes, audit requirements, rate limits, and compatibility behavior remain explicit in each endpoint even where jscpd finds similar scaffolding. | A generic dispatcher can obscure fail-closed security boundaries. |
| Separate public status, telemetry, auth, checkout/return, and offline queue contracts | Each has a distinct failure policy: public status degrades visibly, telemetry is consent-gated/best effort, auth fails closed, network checkout/return owns server envelopes, and offline queue owns encrypted local durability. | A forced shared abstraction would conflate security and failure semantics. |
| Subprocessor super-ops actions | Preview, announce, and list have generated request/response docs but no current frontend call sites; their direct existing response shapes were retained. | Removing externally callable operational actions solely for absent UI callers. |

## 12. Remaining limitations and separately approvable follow-ups

1. The original Task 8 executable command was incorrect because the super-tenant
   import-graph test reads production action files. This was a required gate fix,
   not optional hardening. Commit `f6c3ad7c` corrects the plan to
   `--allow-read=supabase/functions/super-tenant-mutate/actions`; the exact combined
   command passed 101 tests with 0 failures, and Task 8 used that exact corrected
   command.
2. The super-tenant import-cycle roster is hard-coded instead of dynamically
   discovering action files. New action files require roster maintenance.
3. `supabase/functions/super-tenant-mutate/actions/districts.ts` remains 600
   lines and reporting-heavy. `get_district_details` was intentionally preserved;
   any further split needs its own behavior/security review.
4. The public CSS checker conservatively scans declaration values as well as
   selector preludes. This fails safe but can create future false positives.
5. The automated CSS-specific test does not directly exercise unauthorized
   protected navigation or the internal-host root branch. Task 8 closed the
   verification gap with direct production-preview traces; a later test-only
   change can make those two assertions permanent.
6. `.superpowers/sdd/plan4-task-2-report.md` contains one stale pre-fix
   authenticated CSS asset hash. This report uses only current `dist` artifacts.
7. The Task 6 Chromium trace is intentionally a local/final gate rather than CI
   because of browser/process timing and cleanup cost.
8. `SupportRequestListItem` now represents `privacy`, but the current UI category
   label fallback may still render it as `General`. This is a pre-existing,
   separately approvable presentation fix, not a cleanup completion claim.
9. Knip currently reports 115 unused files, one unused devDependency, five
   unresolved-import groups, and two exported types. The files are principally
   Worker/Deno/script/test entrypoints outside Knip's Vite graph; CycloneDX has a
   direct executable owner; the unresolved imports are browser absolute `/src/...`
   Playwright imports. The two exported-type findings (`AuthRole` and product
   event delivery types) remain review candidates, not proven dead code. The
   separately reviewed deletion of `src/services/superOpsService.ts` reduced the
   unused-file count by one and is absent from the final findings.
10. At the final verified implementation head, the branch was 113 commits ahead
    and three commits behind `origin/main`; this report-only closure commit produces
    the terminal 114-ahead / 3-behind state recorded in Section 2. The behind
    commits are dependency-only and
    include exact-pin Cloudflare/Wrangler minor updates outside the reviewed Task 4
    upgrade scope plus packages deliberately removed by this cleanup. Per the
    final audit decision, no merge/rebase/cherry-pick was performed; reconciliation
    remains a separately approvable dependency follow-up, not a failed cleanup gate.
11. The combined removed-token `rg` command remains overbroad because a live
    Worker local is also named `sessionAccessToken`. Section 9 records the eight
    matching lines, ten token occurrences, and clean path-qualified replacement
    scans.

All required final gates, protected-flow traces, generated hashes, divergence,
and deploy dry runs are now recorded. This report-only closure commit is the only
change after final lead verification and does not modify production behavior.
