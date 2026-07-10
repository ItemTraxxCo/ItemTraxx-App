# Frontend Decomposition and Vue Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `App.vue`, `main.ts`, public-page duplication, checkout/auth service size, and repeated lifecycle code while preserving rendered behavior and every authentication, tenant, checkout, and return contract.

**Architecture:** Keep `App.vue` as an orchestrator over focused Vue composables/components. Derive bootstrap decisions from router metadata, centralize shared public lifecycles only where contracts match, and split oversized services behind compatibility facades so callers migrate incrementally. Every extraction first locks the current result with focused browser tests.

**Tech Stack:** Vue 3 Composition API, Vue Router, TypeScript, Vite 8, Playwright, Web Crypto, Web Locks, npm.

## Global Constraints

- Begin only after every checkpoint in `2026-07-10-baseline-landing-dead-code.md` passes.
- Preserve DOM order, ARIA roles, visible copy, route names, route metadata, timers, storage keys, custom events, and error messages unless a test proves a current defect and the user separately approves a fix.
- Keep `src/services/authService.ts` and `src/services/checkoutService.ts` as compatibility facades until all current imports have migrated and the full E2E suite passes.
- Preserve the encrypted queue format, plaintext migration, key/session storage, Web Locks preference, lease fallback, operation IDs, retry classification, and warning consumption.
- Keep admin and super verification TTLs at 15 minutes and the admin idle default/minimum behavior unchanged.
- Do not combine auth/checkout extraction with landing markup or CSS changes in one commit.

---

### Task 1: Make bootstrap route decisions pure and move E2E controls out of `main.ts`

**Files:**
- Create: `src/bootstrap/routeBootstrap.ts`
- Create: `src/e2e/testControls.ts`
- Modify: `src/main.ts`
- Modify: `tests/e2e/auth-edge-cases.spec.ts`
- Modify: `tests/e2e/protected-routes.spec.ts`

**Interfaces:**
- Consumes: `router.resolve(path)`, route `meta.public`, internal-host district state, `VITE_E2E_TEST_UTILS`.
- Produces: `isPublicBootstrapRoute(path: string): boolean`; `isAdminBootstrapRoute(path: string): boolean`; `attachE2EControls(router): void` loaded only in dev E2E mode.

- [ ] **Step 1: Add route-classification regressions**

Extend E2E coverage so first-mount behavior is exercised on `/`, `/forgot-password`, `/legal/student-privacy`, `/landing-old`, `/landing-new2`, a tenant route, and `/district`. The public cases must not wait for protected auth bootstrap; the protected cases must retain guard behavior.

Run:

```bash
npx playwright test tests/e2e/auth-edge-cases.spec.ts tests/e2e/protected-routes.spec.ts
```

Expected before the change: the current hard-coded public subset exposes why the metadata-derived helper is needed; existing cases remain green.

- [ ] **Step 2: Implement router-derived classification**

```ts
import type { Router } from "vue-router";

export const isPublicBootstrapRoute = (router: Router, path: string): boolean =>
  router.resolve(path || "/").matched.some((record) => record.meta.public === true);

export const isAdminBootstrapRoute = (router: Router, path: string): boolean => {
  const resolved = router.resolve(path || "/");
  return resolved.path.startsWith("/tenant/admin") || resolved.path === "/district";
};
```

Delete `PUBLIC_BOOTSTRAP_PATHS`; update `main.ts` callers to pass `window.location.pathname`. Do not infer public status from name prefixes.

- [ ] **Step 3: Move the complete E2E window contract**

Move the `Window.__itemtraxxTest` declaration and the full existing `attachE2EControls` body to `src/e2e/testControls.ts`. Export:

```ts
import type { Router } from "vue-router";
export const attachE2EControls = (router: Router): void => { /* existing body */ };
```

Replace the `main.ts` call with:

```ts
if (import.meta.env.VITE_E2E_TEST_UTILS === "true") {
  const { attachE2EControls } = await import("./e2e/testControls");
  attachE2EControls(router);
}
```

Keep the production guard inside `attachE2EControls`; Vite's production build-time rejection remains unchanged.

- [ ] **Step 4: Verify and commit**

```bash
npm run build
npx playwright test tests/e2e/auth-edge-cases.spec.ts tests/e2e/protected-routes.spec.ts tests/e2e/admin-mutation-guards.spec.ts
wc -l src/main.ts
git diff --check
git add src/bootstrap/routeBootstrap.ts src/e2e/testControls.ts src/main.ts tests/e2e
git commit -m "refactor: isolate frontend bootstrap decisions"
```

Expected: route behavior and E2E controls pass; E2E-only code is absent from the normal production graph; `main.ts` is smaller.

---

### Task 2: Introduce one reference-counted system-status lifecycle

**Files:**
- Create: `src/store/systemStatusState.ts`
- Create: `src/composables/useSystemStatus.ts`
- Modify: `src/App.vue`
- Modify: `src/pages/LandingPageNew.vue`
- Modify: `src/pages/LandingPageNew2.vue`
- Modify: `src/pages/PublicHome.vue`
- Modify: `tests/e2e/public-and-legal.spec.ts`

**Interfaces:**
- Consumes: `fetchSystemStatus({ force, staleWhileRevalidate })` and its existing response envelope.
- Produces: singleton reactive payload, label/class derivation, one five-minute visible-page poller, `useSystemStatus()` acquire/release lifecycle.

- [ ] **Step 1: Add the failing shared-poller test**

Count `system-status` requests while `/` remains visible for initial load, while a synthetic visibility change is dispatched, and after navigating between retained landing variants. Assert one initial request and no multiplication of active timers/listeners.

- [ ] **Step 2: Implement the singleton store**

```ts
import { computed, reactive } from "vue";
import { fetchSystemStatus, type SystemStatusPayload } from "../services/systemStatusService";

const POLL_INTERVAL_MS = 300_000;
const state = reactive({
  payload: {} as SystemStatusPayload,
  responseStatus: 0,
  responseOk: false,
  hasResult: false,
  loading: false,
  refreshedAt: 0,
});
let consumers = 0;
let timer: number | null = null;

const statusLabel = computed(() => {
  if (!state.hasResult) return "Unknown";
  if (state.responseOk && state.payload.status === "operational") return "Running";
  if (state.responseStatus >= 500 || state.payload.status === "down") return "Down";
  return "Degraded";
});

const statusClass = computed<"status-ok" | "status-warn" | "status-down" | "status-unknown">(() => {
  if (statusLabel.value === "Running") return "status-ok";
  if (statusLabel.value === "Degraded") return "status-warn";
  if (statusLabel.value === "Down") return "status-down";
  return "status-unknown";
});

const refresh = async (force = false): Promise<void> => {
  if (state.loading) return;
  state.loading = true;
  try {
    const result = await fetchSystemStatus({ force, staleWhileRevalidate: !force });
    if (result?.payload) {
      state.payload = result.payload;
      state.responseStatus = result.status;
      state.responseOk = result.ok;
      state.hasResult = true;
    }
    state.refreshedAt = Date.now();
  } finally {
    state.loading = false;
  }
};

const schedule = () => {
  if (timer !== null || consumers === 0) return;
  timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh(true);
  }, POLL_INTERVAL_MS);
};

const acquire = () => {
  consumers += 1;
  if (consumers === 1) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void refresh();
    schedule();
  }
};

const release = () => {
  consumers = Math.max(0, consumers - 1);
  if (consumers !== 0) return;
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "visible") void refresh();
};

export const systemStatusState = { state, statusLabel, statusClass, refresh, acquire, release };
```

Before adopting this mapping, compare the merged pages' exact labels and status predicates. Keep `Running`, `Down`, `Degraded`, and `Unknown` byte-for-byte unless merged main has changed every consumer consistently.

- [ ] **Step 3: Add the composable and migrate consumers**

```ts
import { onMounted, onUnmounted } from "vue";
import { systemStatusState } from "../store/systemStatusState";

export const useSystemStatus = () => {
  onMounted(systemStatusState.acquire);
  onUnmounted(systemStatusState.release);
  return systemStatusState;
};
```

Replace each page's `refreshSystemStatus`, interval, visibility listener, status refs, and cleanup with `useSystemStatus`. In `App.vue`, continue deriving maintenance, kill-switch, broadcasts, and incidents from the full shared payload; do not reduce it to label/class.

- [ ] **Step 4: Verify and commit**

```bash
npm run build
npx playwright test tests/e2e/public-and-legal.spec.ts
npm run perf:initial
git diff --check
git add src/store/systemStatusState.ts src/composables/useSystemStatus.ts src/App.vue src/pages/LandingPageNew.vue src/pages/LandingPageNew2.vue src/pages/PublicHome.vue tests/e2e/public-and-legal.spec.ts
git commit -m "refactor: share system status lifecycle"
```

Keep the status cases in the existing `tests/e2e/public-and-legal.spec.ts`; do not create a duplicate status spec.

---

### Task 3: Consolidate public-page chrome and product-event delivery

**Files:**
- Create: `src/composables/usePublicPageChrome.ts`
- Create: `src/services/productEvents.ts`
- Modify: `src/pages/LandingPageNew.vue`
- Modify: `src/pages/LandingPageNew2.vue`
- Modify: `src/pages/PublicHome.vue`
- Modify after contract comparison: `src/pages/ContactPage.vue`
- Modify after contract comparison: `src/pages/ContactSales.vue`
- Modify after contract comparison: `src/pages/ContactSupport.vue`
- Modify after contract comparison: `src/pages/RequestDemoPage.vue`
- Modify after contract comparison: `src/pages/ForgotPassword.vue`
- Modify after contract comparison: `src/pages/ResetPassword.vue`
- Modify: `tests/e2e/public-and-legal.spec.ts`

**Interfaces:**
- Consumes: menu open state, scroll behavior, current year, Vercel analytics event name/properties, consent-gated PostHog event name/properties.
- Produces: `usePublicPageChrome()` and `trackProductEvent(name, properties): void` with no eager telemetry SDK imports.

- [ ] **Step 1: Lock current public interactions**

Add tests for menu open/close, anchor scroll, Escape close, copyright year, CTA navigation, and one analytics call route mock. Assert DOM/accessibility behavior, not implementation details.

- [ ] **Step 2: Implement the page-chrome composable**

```ts
import { onBeforeUnmount, onMounted, ref } from "vue";

export const usePublicPageChrome = () => {
  const menuOpen = ref(false);
  const currentYear = new Date().getFullYear();
  const closeMenu = () => { menuOpen.value = false; };
  const toggleMenu = () => { menuOpen.value = !menuOpen.value; };
  const onKeydown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
  onMounted(() => window.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
  return { menuOpen, currentYear, closeMenu, toggleMenu };
};
```

Only include scroll code if all adopted pages currently use identical scroll/offset semantics. Leave visually different mobile menus local.

- [ ] **Step 3: Implement a lazy product-event facade**

```ts
export const trackProductEvent = (
  name: string,
  properties: Record<string, string | number | boolean> = {}
): void => {
  void import("./analyticsService")
    .then(({ trackAnalyticsEvent }) => trackAnalyticsEvent(name, properties))
    .catch(() => undefined);
  void import("./posthogService")
    .then(({ capturePostHogEvent }) => capturePostHogEvent(name, properties))
    .catch(() => undefined);
};
```

The underlying PostHog service remains responsible for consent. Keep current event names and property keys exactly; the facade coordinates delivery but does not rename telemetry.

- [ ] **Step 4: Migrate only identical call sites and shared footers**

Adopt the composable/facade in the three retained landing variants. Reuse `PublicFooter.vue` only when rendered copy, order, URLs, `target`, and `rel` attributes match. Preserve page-specific sections instead of adding a configuration mega-component.

- [ ] **Step 5: Verify and commit**

```bash
npm run build
npm run perf:initial
npx playwright test tests/e2e/public-and-legal.spec.ts
git diff --check
git add src/composables/usePublicPageChrome.ts src/services/productEvents.ts src/pages src/components/PublicFooter.vue tests/e2e/public-and-legal.spec.ts
git commit -m "refactor: consolidate public page lifecycles"
```

---

### Task 4: Split encrypted offline queue storage from checkout network operations

**Files:**
- Create: `src/services/offlineCheckoutQueue.ts`
- Modify: `src/services/checkoutService.ts`
- Modify: `src/App.vue`
- Modify: checkout/return pages importing queue helpers
- Create: `tests/e2e/checkout-offline.spec.ts`

**Interfaces:**
- Consumes: current storage keys, encrypted envelope `{ version: 1, iv, cipher }`, plaintext array migration, Web Locks/lease behavior.
- Produces from `offlineCheckoutQueue.ts`: exported `CheckoutReturnPayload`, `BufferedCheckoutItem`, `ensureCheckoutOperationId`, `consumeCheckoutOfflineWarning`, `getBufferedCheckoutCount`, `queueCheckoutPayload`, `withOfflineQueueLock`, `readOfflineQueue`, and `writeOfflineQueue`.

- [ ] **Step 1: Add black-box queue contract tests**

Cover: empty count, encrypted write (raw localStorage is not plaintext), read-back, legacy plaintext migration, corrupted envelope reset/warning, concurrent lock serialization, queue count, and preserved operation ID. Execute through existing E2E test controls or a small dev-only fixture page; do not export crypto internals solely for testing.

- [ ] **Step 2: Move types and the contiguous storage implementation unchanged**

Move lines beginning with `CheckoutReturnPayload` through `queueCheckoutPayload` from `checkoutService.ts` into `offlineCheckoutQueue.ts`. Export the compatibility surface listed above. Preserve these constants exactly:

```ts
const OFFLINE_QUEUE_KEY = "itemtraxx:checkout-offline-buffer:v1";
const OFFLINE_QUEUE_KEY_VERSION = "itemtraxx:checkout-offline-buffer:key:v1";
const OFFLINE_QUEUE_LOCK_KEY = "itemtraxx:checkout-offline-buffer:lock:v1";
const OFFLINE_QUEUE_ALGO = "AES-GCM";
const OFFLINE_QUEUE_LOCK_TTL_MS = 30_000;
const OFFLINE_QUEUE_LOCK_REFRESH_MS = 1_000;
```

Rename `ensureOperationId` only at the export boundary to `ensureCheckoutOperationId`; do not change its generated value format.

- [ ] **Step 3: Keep `checkoutService.ts` as the network facade**

Import the queue surface into `checkoutService.ts`. Leave `executeCheckoutReturn`, retry classification, student/gear lookups, `submitCheckoutReturn`, and `syncBufferedCheckoutQueue` behavior in the facade. Re-export compatibility names:

```ts
export { consumeCheckoutOfflineWarning, getBufferedCheckoutCount } from "./offlineCheckoutQueue";
export type { CheckoutReturnPayload } from "./offlineCheckoutQueue";
```

The sync loop must still hold the same exclusive queue lock while processing and writing its remaining items.

- [ ] **Step 4: Let the shell import only queue counting**

Change `App.vue` to dynamically import `offlineCheckoutQueue.ts` rather than `checkoutService.ts` for the badge count. Checkout/return pages continue using the facade until their network/queue responsibilities are independently migrated.

- [ ] **Step 5: Verify and commit**

```bash
npm run build
npx playwright test tests/e2e --grep "offline|checkout|return|operation"
npm run perf:initial
git diff --check
git add src/services/offlineCheckoutQueue.ts src/services/checkoutService.ts src/App.vue tests/e2e
git commit -m "refactor: isolate encrypted checkout queue"
```

Expected: queue bytes remain decryptable across reload in the same tab session, plaintext migration still works, and checkout/return envelopes are unchanged.

---

### Task 5: Decompose auth behind a stable facade

**Files:**
- Create: `src/services/auth/sessionBootstrap.ts`
- Create: `src/services/auth/tenantLogin.ts`
- Create: `src/services/auth/districtHandoff.ts`
- Create: `src/services/auth/privilegedLogin.ts`
- Create: `src/services/auth/signOut.ts`
- Create: `src/services/auth/types.ts`
- Modify: `src/services/authService.ts`
- Modify: `tests/e2e/auth-edge-cases.spec.ts`
- Modify: `tests/e2e/protected-routes.spec.ts`

**Interfaces:**
- Consumes/produces: every current exported `authService.ts` name and signature; session summary, tenant login, district handoff, super-admin login/passkey, sign-out, and post-sign-out URL behavior.
- Security order: local HTTP/Supabase session cleanup, privileged-session revocation, auth-state clear, district/tenant context clear, and redirects remain in their current order.

- [ ] **Step 1: Inventory the exact public facade**

```bash
rg -n '^export (const|async function|function|type|interface)' src/services/authService.ts
rg -n 'from ["'"'].*authService["'"']' src tests
```

Copy the merged export list into a scratch checklist. No export disappears in this task.

- [ ] **Step 2: Expand auth contract tests before moving code**

Cover unauthenticated bootstrap, active tenant user, suspended tenant, tenant admin verification, district handoff success and raw-token rejection, super-admin challenge/passkey, logout with missing local Supabase session, forced session termination, and post-sign-out URL selection.

- [ ] **Step 3: Move pure types and normalization first**

Move `ProfileRow`, tenant/session response types, known-role normalization, function-name normalization, login-location normalization, and exported input/result types into `auth/types.ts`. Keep literal roles restricted to:

```ts
export type AuthRole = "tenant_user" | "tenant_admin" | "district_admin" | "super_admin";
```

Do not broaden unknown backend values into authenticated roles.

- [ ] **Step 4: Extract one domain per commit**

Move bodies without semantic edits in this order:

1. `sessionBootstrap.ts`: profile/session summary application, listener initialization, current-session refresh, tenant suspension handling.
2. `tenantLogin.ts`: tenant login and login notification.
3. `districtHandoff.ts`: handoff consume/create, raw-token rejection, district slug/host work.
4. `privilegedLogin.ts`: admin session login, super-admin OTP/passkey flows, privileged step-up.
5. `signOut.ts`: server/local revocation, state cleanup, post-sign-out URL.

After each move, make `authService.ts` re-export the moved functions:

```ts
export { refreshAuthFromSession, initAuthListener, applyHttpSessionSummary } from "./auth/sessionBootstrap";
export { consumeDistrictSessionHandoff, createDistrictSessionHandoff, createDistrictAdminSessionHandoff } from "./auth/districtHandoff";
export { adminLoginWithSession, superAdminLogin, superAdminPasskeyLogin } from "./auth/privilegedLogin";
export { signOut, getPostSignOutUrl } from "./auth/signOut";
```

Add the existing tenant login exports from the live inventory rather than guessing their names. Run the focused auth suite after every domain commit.

- [ ] **Step 5: Remove cyclic dependencies, not security checks**

If an extracted module needs shared state application, place that pure helper in `auth/sessionState.ts`; do not import the compatibility facade from a child module. Keep server calls in their owning domain module and preserve fail-closed catches.

- [ ] **Step 6: Verify facade compatibility and size**

```bash
npm run build
npx playwright test tests/e2e/auth-edge-cases.spec.ts tests/e2e/protected-routes.spec.ts tests/e2e/admin-mutation-guards.spec.ts
rg -n 'from ["'"'].*authService["'"']' src tests
wc -l src/services/authService.ts src/services/auth/*.ts
git diff --check
```

Expected: every old import still compiles, facade contains exports rather than 1,000+ lines of mixed implementation, and no extracted module normally exceeds 400 lines.

---

### Task 6: Split the super-admin frontend facade by existing contract families

**Files:**
- Create: `src/services/superOps/types.ts`
- Create: `src/services/superOps/client.ts`
- Create: `src/services/superOps/controlCenter.ts`
- Create: `src/services/superOps/support.ts`
- Create: `src/services/superOps/salesCustomers.ts`
- Create: `src/services/superOps/internalOps.ts`
- Create: `src/services/superOps/sessions.ts`
- Modify: `src/services/superOpsService.ts`
- Modify: super/internal pages that currently import the facade
- Modify: `tests/e2e/super-flows-and-exports.spec.ts`

**Interfaces:**
- Consumes/produces: every existing `superOpsService.ts` type/function signature and exact `super-ops` action/payload envelope.
- Produces: domain modules behind a compatibility facade; route pages import only their owning domain after migration.

- [ ] **Step 1: Inventory and lock request envelopes**

Record every current export and caller:

```bash
rg -n '^export ' src/services/superOpsService.ts
rg -n 'superOpsService' src --glob '*.vue' --glob '*.ts'
```

Extend `tests/e2e/super-flows-and-exports.spec.ts` so mocked calls assert action and payload keys for control center/settings, support, sales/customers, internal snapshot, and session actions.

- [ ] **Step 2: Move shared types and one request client**

Move exported domain types to `superOps/types.ts`. Extract the current `invokeEdgeFunction` wrapper into `superOps/client.ts`:

```ts
export const invokeSuperOps = async <T>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> => {
  const result = await invokeEdgeFunction<T>("super-ops", {
    method: "POST",
    body: { action, payload },
  });
  if (!result.ok) throw edgeFunctionError(result, "Request failed.");
  return result.data as T;
};
```

Use the live facade's exact generic/result/error logic if it differs; all domain modules call this one wrapper.

- [ ] **Step 3: Move functions by existing action family**

Move control center/runtime/alerts/policy/approvals, support, sales/customers, internal snapshot, and super-admin session functions into the corresponding modules. Keep function signatures and return transformations unchanged. Make `superOpsService.ts` re-export all old names so callers remain compatible during migration.

- [ ] **Step 4: Migrate page imports to owning modules**

Update each super/internal page to import its domain module directly. `authService.ts` imports `touchSuperAdminSession` from `superOps/sessions.ts`. Keep the compatibility facade until all external/tests imports are accounted for; it may remain as a stable public surface if documentation or third-party code references it.

- [ ] **Step 5: Verify and commit**

```bash
npm run build
npx playwright test tests/e2e/super-flows-and-exports.spec.ts tests/e2e/auth-edge-cases.spec.ts
wc -l src/services/superOpsService.ts src/services/superOps/*.ts
git diff --check
git add src/services/superOps src/services/superOpsService.ts src/services/authService.ts src/pages/super src/pages/internal tests/e2e/super-flows-and-exports.spec.ts
git commit -m "refactor: split super ops frontend service"
```

Expected: facade is re-exports only, focused modules normally remain below 400 lines, and all action envelopes match pre-extraction tests.

---

### Task 7: Extract `App.vue` lifecycles into focused composables and chrome components

**Files:**
- Create: `src/composables/useCookieConsentTelemetry.ts`
- Create: `src/composables/useAppVersionStatus.ts`
- Create: `src/composables/useAdminSessionLifecycle.ts`
- Create: `src/composables/useOfflineQueueCount.ts`
- Create: `src/composables/useOnboarding.ts`
- Create: `src/composables/useTopBannerLayout.ts`
- Create: `src/components/app/AppTopBanners.vue`
- Create: `src/components/app/AppBlockingOverlays.vue`
- Create: `src/components/app/AuthenticatedNavigation.vue`
- Modify: `src/App.vue`
- Modify: `tests/e2e/auth-edge-cases.spec.ts`
- Modify: `tests/e2e/protected-routes.spec.ts`
- Modify: `tests/e2e/public-and-legal.spec.ts`
- Modify: `tests/e2e/admin-session-revocation.spec.ts`
- Modify: `tests/e2e/super-flows-and-exports.spec.ts`

**Interfaces:**
- Consumes: existing refs/computed state, auth state, route, router, storage events, status payload, timer constants.
- Produces: one composable per lifecycle and presentational components with typed props/emits; `App.vue` remains the owner of cross-lifecycle orchestration.

- [ ] **Step 1: Snapshot shell behavior with focused tests**

Cover cookie banner and preferences, maintenance banner/overlay, kill switch allowed routes, broadcast/incident dismissals, version overlay, session-ended overlay, top-menu role links, offline badge, onboarding open/complete, admin idle logout, session heartbeat, theme, and top-banner CSS variables.

- [ ] **Step 2: Extract pure/presentational units first**

For every component, define props/emits explicitly. Example overlay boundary:

```ts
const props = defineProps<{
  maintenanceVisible: boolean;
  maintenanceMessage: string;
  killSwitchVisible: boolean;
  killSwitchMessage: string;
  versionVisible: boolean;
  currentVersion: string;
  latestVersion: string | null;
}>();
const emit = defineEmits<{ reload: []; toggleTheme: []; signInAgain: [] }>();
```

Move the existing template markup intact. Do not move service calls into presentational components.

- [ ] **Step 3: Extract lifecycles one at a time**

Each composable returns state plus named actions and owns all listeners/timers it creates. `useAdminSessionLifecycle` must accept the current auth/route predicates and expose `start`, `stop`, and `recordActivity`; it keeps heartbeat, verification check, idle timer, and logout guards distinct. `useTopBannerLayout` owns ResizeObserver/measure/cleanup. `useAppVersionStatus` owns GitHub version polling. `useCookieConsentTelemetry` owns storage/custom-event synchronization and consent recording.

Use `onScopeDispose` or `onUnmounted` for every listener/timer. Do not retain both old and new lifecycle wiring during a commit.

- [ ] **Step 4: Keep `App.vue` as the orchestration seam**

The final script should read as composition:

```ts
const status = useSystemStatus();
const consent = useCookieConsentTelemetry(auth);
const version = useAppVersionStatus();
const onboarding = useOnboarding(auth, route);
const offlineQueue = useOfflineQueueCount(auth, route);
const adminSession = useAdminSessionLifecycle({ auth, route, router });
const banners = useTopBannerLayout();
```

Cross-lifecycle rules such as suppressing a version overlay during maintenance remain visible in `App.vue` computed state.

- [ ] **Step 5: Verify after each extraction and commit separately**

```bash
npm run build
npx playwright test tests/e2e/auth-edge-cases.spec.ts tests/e2e/protected-routes.spec.ts tests/e2e/public-and-legal.spec.ts tests/e2e/admin-mutation-guards.spec.ts
wc -l src/App.vue src/composables/use*.ts src/components/app/*.vue
git diff --check
```

Commit each coherent lifecycle/component group separately, using messages such as:

```bash
git commit -m "refactor: extract app status overlays"
git commit -m "refactor: extract authenticated app lifecycle"
git commit -m "refactor: extract app consent and version state"
```

Expected end state: `src/App.vue` is at most 500 lines; extracted units normally remain below 400 lines.

---

### Task 8: Decompose the active landing page and repeated public forms conservatively

**Files:**
- Create: focused components under `src/components/landing/`
- Create only when exact form contracts match: `src/composables/usePublicFormSubmission.ts`
- Modify: `src/pages/LandingPageNew.vue`
- Modify after contract comparison: `src/pages/ContactPage.vue`
- Modify after contract comparison: `src/pages/ContactSales.vue`
- Modify after contract comparison: `src/pages/ContactSupport.vue`
- Modify after contract comparison: `src/pages/RequestDemoPage.vue`
- Modify after contract comparison: `src/pages/ForgotPassword.vue`
- Modify after contract comparison: `src/pages/ResetPassword.vue`
- Modify: `tests/e2e/public-and-legal.spec.ts`
- Modify: `tests/e2e/public-contact-forms.spec.ts`

**Interfaces:**
- Consumes: current landing props/data, CTA event contracts, FAQ state, form endpoint/payload/validation/error contracts.
- Produces: section components with no route/service ownership; optional form composable parameterized only by genuinely variable endpoint/serializer behavior.

- [ ] **Step 1: Capture rendered structure and interactions**

Use Playwright screenshots or semantic assertions for header, hero, showcase, feature/operations sections, FAQ, final CTA, and footer at desktop/mobile viewports. Record the active root page's heading order and accessible link names.

- [ ] **Step 2: Extract coherent active-page sections**

Create components only at existing semantic boundaries, for example:

- `LandingHeader.vue`
- `LandingHero.vue`
- `LandingShowcase.vue`
- `LandingFeatureSections.vue`
- `LandingFaq.vue`
- `LandingFinalCta.vue`

Pass static content as typed readonly props where needed and emit `cta`/`toggle-faq`; do not let child sections import router or telemetry. Preserve image `srcset`, fallback PNGs, dimensions, lazy/eager loading, headings, and link destinations.

- [ ] **Step 3: Consolidate forms only after a contract matrix**

For each duplicated form, document endpoint, method, payload keys, validation, success route/message, error mapping, timeout, and telemetry. Extract `usePublicFormSubmission` only for a group whose matrix matches in every field except explicit inputs. Leave differing forms separate and record the difference for Plan 4's manual-review report.

- [ ] **Step 4: Verify visual/semantic parity and commit**

```bash
npm run build
npm run perf:initial
npm run perf:images
npx playwright test tests/e2e/public-and-legal.spec.ts
git diff --check
git add src/components/landing src/composables src/pages tests/e2e/public-and-legal.spec.ts
git commit -m "refactor: decompose canonical landing page"
```

Expected: no screenshot/semantic regression, no new initial dependency, and no retained landing variant is deleted.

---

### Task 9: Complete the frontend checkpoint

**Files:**
- Verify: all Plan 2 changes
- Record later: final report in Plan 4

**Interfaces:**
- Consumes: decomposed frontend.
- Produces: a clean checkpoint before security-sensitive Worker/Supabase decomposition.

- [ ] **Step 1: Check size, dependencies, and duplication**

```bash
wc -l src/App.vue src/main.ts src/services/authService.ts src/services/checkoutService.ts
npx -y knip --reporter compact
npx -y jscpd src --min-lines 8 --min-tokens 70 --reporters console
```

Expected: `App.vue <= 500`, `main.ts <= 300`, auth facade is focused, checkout network facade no longer owns queue crypto, and duplicate TypeScript is below the 9.35% baseline or every remaining cluster is documented as contractually different.

- [ ] **Step 2: Run the full frontend/regression suite**

```bash
bash ./scripts/check-env-parity.sh
rm -rf dist artifacts
npm run build
npm run perf:initial
npm run perf:budget
npm run perf:images
npm run perf:report
npm run security:gate
npx playwright test
git diff --check
git status --short --branch
```

Expected: all commands pass from committed state and the working tree is clean.

- [ ] **Step 3: Inspect protected workflows manually**

Exercise tenant checkout and return, offline buffer/replay, tenant-admin login/verification, district handoff, super-admin verification, logout, password reset, public authenticated redirect, and internal-host `/`. Compare network request envelopes/statuses to the pre-extraction traces.

- [ ] **Step 4: Do not advance on a compatibility discrepancy**

If any workflow differs, bisect within Plan 2's task-sized commits, fix only the owning extraction, rerun its focused suite and the full frontend suite, then commit the repair before beginning Plan 3.
