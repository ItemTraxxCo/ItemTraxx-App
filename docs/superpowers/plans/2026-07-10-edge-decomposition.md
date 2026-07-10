# Cloudflare Worker and Supabase Edge Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable, current-runtime Worker type boundary and decompose the Cloudflare proxy plus the three largest Supabase Edge Function handlers without changing security order, request/response contracts, database calls, or compatibility fallbacks.

**Architecture:** Generate Worker runtime/binding types from Wrangler configuration and a checked-in names-only local env template, then keep the Worker entrypoint as a small route/security dispatcher over focused modules. In Supabase functions, retain CORS, trusted ingress, kill switch, authentication, role, privileged verification, and rate limiting visibly in each `index.ts`; move only already-authorized action bodies into domain modules. Shared Deno helpers are limited to pure contracts proven identical by tests.

**Tech Stack:** Cloudflare Workers/Wrangler 4, TypeScript, Web Crypto, Deno, Supabase Edge Functions, `@supabase/supabase-js`, PostgREST, npm.

## Global Constraints

- Begin only after Plans 1 and 2 pass from committed state.
- Re-read current Cloudflare Workers best practices/types and the Supabase changelog/docs immediately before implementation; the planning baseline used Cloudflare Workers docs updated 2026-06-03, Wrangler 4.107.0, generated workerd runtime 1.20260701.1, and the 2026-07-10 Supabase changelog.
- Never hand-write a Worker `Env` interface. Generate it with `wrangler types`; secrets are named with empty values in `.dev.vars.example`, never committed with credentials.
- Keep every Promise awaited, returned, explicitly ignored with `void`, or passed to `ctx.waitUntil()`. Keep all request-scoped state local to the request.
- Preserve trusted-ingress HMAC inputs, headers, body bytes, cookies, cookie attributes, CORS headers, rate-limit keys, refresh behavior, request IDs, fallback status behavior, and upstream streaming.
- Do not update `compatibility_date`, add `nodejs_compat`, convert TOML to JSONC, or enable new observability billing/config as incidental cleanup. Record those configuration choices for manual review in Plan 4.
- Do not alter RLS, schemas, grants, SQL, RPC names, action names, payload keys, audit records, error envelopes, status codes, or service-role boundaries.
- Keep missing-table/column compatibility branches unless current production schema and telemetry separately prove them obsolete.

---

### Task 1: Generate Worker types and make typecheck a first-class gate

**Files:**
- Create: `cloudflare/edge-proxy/.dev.vars.example`
- Create: `cloudflare/edge-proxy/worker-configuration.d.ts` (Wrangler generated)
- Create: `cloudflare/edge-proxy/tsconfig.json`
- Modify: `cloudflare/edge-proxy/src/index.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci-core.yml`

**Interfaces:**
- Consumes: `cloudflare/edge-proxy/wrangler.toml`, names of deployed Worker secrets, Wrangler runtime types.
- Produces: global generated `Env`; `npm run worker:types:check`; `npm run worker:typecheck`; `npm run worker:test`.

- [ ] **Step 1: Reproduce the current type failures**

Run:

```bash
deno check --frozen cloudflare/edge-proxy/src/index.ts
```

Expected before the fix: failures around `BufferSource`, `ExecutionContext`/test context, and refresh-result narrowing. Save the exact count in the final report; do not use `--no-check` as the permanent type gate.

- [ ] **Step 2: Add names-only local secret configuration**

Create `cloudflare/edge-proxy/.dev.vars.example` with no credential values:

```dotenv
SUPABASE_URL=""
SUPABASE_ANON_KEY=""
ITX_EDGE_PROXY_SHARED_SECRET=""
ITX_ITEMTRAXX_KILLSWITCH_MESSAGE=""
SESSION_COOKIE_DOMAIN=""
SESSION_COOKIE_SAMESITE=""
SESSION_REFRESH_COOKIE_MAX_AGE_SECONDS=""
SENTRY_DSN=""
```

These names complement non-secret vars/bindings already in `wrangler.toml`; deployment secrets remain managed externally.

- [ ] **Step 3: Generate, do not author, Worker types**

Run:

```bash
cd cloudflare/edge-proxy
npx wrangler types worker-configuration.d.ts --config wrangler.toml --env-file .dev.vars.example --strict-vars false
cd ../..
```

Expected: generated `Env` contains KV, rate-limit bindings, configured vars, and all names in `.dev.vars.example`; the file header records the Wrangler command/hash.

- [ ] **Step 4: Add a Worker-only TypeScript config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": []
  },
  "include": ["worker-configuration.d.ts", "src/**/*.ts"],
  "exclude": ["src/**/*_test.ts"]
}
```

The generated runtime declaration supplies Worker globals; tests continue under Deno and are excluded from this `tsc` pass.

- [ ] **Step 5: Fix the two source typing defects without casts**

Remove the hand-written `Env`, `KvBinding`, and `RateLimitBinding` types from `index.ts`. For body hashing, copy into an owned `ArrayBuffer`:

```ts
const bytes = new Uint8Array(body.byteLength);
bytes.set(body);
const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
```

For refresh narrowing, handle all non-`ok` states before reading tokens:

```ts
if (refreshed.status !== "ok") {
  if (refreshed.status === "rate_limited" || refreshed.status === "unavailable") {
    return { session: null, headers: null, failure: refreshed.status };
  }
  const headers = new Headers();
  clearSessionCookies(headers, env);
  return { session: null, headers, failure: null };
}
```

Use the equivalent existing return type at each live call site. Do not double-cast or suppress errors.

- [ ] **Step 6: Validate the export against generated types**

End `index.ts` with:

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // existing dispatcher body
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: Wire repeatable commands**

Add package scripts:

```json
"worker:types": "cd cloudflare/edge-proxy && wrangler types worker-configuration.d.ts --config wrangler.toml --env-file .dev.vars.example --strict-vars false",
"worker:types:check": "cd cloudflare/edge-proxy && wrangler types worker-configuration.d.ts --config wrangler.toml --env-file .dev.vars.example --strict-vars false --check",
"worker:typecheck": "npm run worker:types:check && tsc -p cloudflare/edge-proxy/tsconfig.json",
"worker:test": "deno test --no-check --frozen cloudflare/edge-proxy/src/*_test.ts"
```

Use `npx wrangler` in scripts if the merged package does not expose the local bin through npm scripts.

- [ ] **Step 8: Add CI after the production build checks**

```yaml
      - name: Typecheck Cloudflare Worker
        run: npm run worker:typecheck

      - name: Test Cloudflare Worker
        run: npm run worker:test
```

Install Deno with the same pinned setup action/version used by other repository workflows; if CI Core has no Deno setup after merging main, add the already-used repository setup block rather than inventing a new pin.

- [ ] **Step 9: Verify and commit**

```bash
npm run worker:types:check
npm run worker:typecheck
npm run worker:test
npm run build
git diff --check
git add cloudflare/edge-proxy/.dev.vars.example cloudflare/edge-proxy/worker-configuration.d.ts cloudflare/edge-proxy/tsconfig.json cloudflare/edge-proxy/src/index.ts package.json package-lock.json .github/workflows/ci-core.yml
git commit -m "test: add cloudflare worker type gate"
```

---

### Task 2: Extract pure Worker routing, response, CORS, ingress, fallback, and observability modules

**Files:**
- Create: `cloudflare/edge-proxy/src/constants.ts`
- Create: `cloudflare/edge-proxy/src/responses.ts`
- Create: `cloudflare/edge-proxy/src/cors.ts`
- Create: `cloudflare/edge-proxy/src/routing.ts`
- Create: `cloudflare/edge-proxy/src/trustedIngress.ts`
- Create: `cloudflare/edge-proxy/src/maintenanceFallback.ts`
- Create: `cloudflare/edge-proxy/src/observability.ts`
- Create: focused `*_test.ts` files beside these modules
- Modify: `cloudflare/edge-proxy/src/index.ts`
- Modify: `cloudflare/edge-proxy/src/index_test.ts`

**Interfaces:**
- Consumes: existing constants and pure helpers from `index.ts`.
- Produces: focused modules with unchanged input/output contracts; `index.ts` retains request dispatch and `ctx.waitUntil` ownership.

- [ ] **Step 1: Add pure contract tests before each move**

Cover exact/wildcard/lookalike origins, localhost trust flag, CORS header set, function/session/RPC path parsing including encoded/trailing-slash blocks, JSON/error envelopes and request IDs, ingress signature/body hash fixtures, maintenance fallback selection, and Sentry envelope parsing. Use fixed timestamps/UUID dependencies where deterministic output is required.

- [ ] **Step 2: Move constants and response builders**

Move cookie names only later with the cookie module. Move CORS/security headers, allowed origins, trusted-ingress header names, kill-switch default message, maintenance key, and rate-limit retry seconds to `constants.ts`. Move `buildError`, `buildJson`, and `buildSessionRateLimitError` to `responses.ts` with signatures unchanged.

- [ ] **Step 3: Move CORS and route parsing**

`cors.ts` exports `parseCsv`, `isLocalhostOrigin`, `isAllowedOrigin`, `withCorsHeaders`, and `resolveRequestOrigin`. `routing.ts` exports `getFunctionName`, `getSessionAction`, `isRestProxyPath`, `isRpcProxyPath`, `getRpcFunctionName`, `isAllowedRpcProxyPath`, `isBlockedRpcProxyPath`, and `isUnauthorizedRpcProxyPath`. Keep the exact `consume_rate_limit` allowlist.

- [ ] **Step 4: Move trusted-ingress Web Crypto**

`trustedIngress.ts` exports only `applyTrustedIngressHeaders` plus pure helpers needed by direct tests. Preserve the signed message exactly:

```ts
`${timestamp}.${requestId}.${method.toUpperCase()}.${target}.${bodyHash}`
```

Do not change secret comparison/signing, timestamp source, body representation, target, or headers.

- [ ] **Step 5: Move maintenance fallback and observability**

`maintenanceFallback.ts` owns KV read/write/clear, payload extraction, and application to `system-status`. `observability.ts` owns Sentry DSN/envelope/report functions. `maybeReportWorkerResponse` continues accepting `ExecutionContext` and calls `ctx.waitUntil(...)`; never destructure `ctx` or await reporting on the response path.

- [ ] **Step 6: Verify each module extraction**

After each module:

```bash
npm run worker:typecheck
npm run worker:test
git diff --check
```

Commit the pure-module group:

```bash
git add cloudflare/edge-proxy/src
git commit -m "refactor: extract worker request primitives"
```

---

### Task 3: Extract Worker cookies, session handling, and Supabase proxies

**Files:**
- Create: `cloudflare/edge-proxy/src/cookies.ts`
- Create: `cloudflare/edge-proxy/src/session.ts`
- Create: `cloudflare/edge-proxy/src/supabaseApiProxy.ts`
- Create: `cloudflare/edge-proxy/src/functionProxy.ts`
- Create: `cloudflare/edge-proxy/src/requestHeaders.ts`
- Create: focused `*_test.ts` files
- Modify: `cloudflare/edge-proxy/src/index.ts`
- Modify: `cloudflare/edge-proxy/src/index_test.ts`

**Interfaces:**
- Consumes: generated `Env`, current session cookies, refresh/result types, Supabase URL/key bindings, incoming Request.
- Produces: `handleSessionRequest`, `proxySupabaseApiRequest`, `proxyFunctionRequest`; streamed `Response` objects with unchanged headers/status/body.

- [ ] **Step 1: Expand integration coverage before moving request code**

Add Worker tests for session exchange/refresh/me/logout, rate-limit allowed/limited/unavailable, invalid origin/session header, invalid/expired refresh, cookie set/clear attributes, direct and REST RPC auth/blocking, data-request mutation header, function allowlist, kill switch, trusted-ingress forwarding, upstream 401 refresh/retry, status fallback, upstream exception, and 5xx reporting scheduling.

Stub `globalThis.fetch` per test and restore it in `finally`; never store a request's stubbed result in module scope.

- [ ] **Step 2: Extract cookie parsing/writing unchanged**

`cookies.ts` owns `SessionCookies`, parse, append, clear/set, max-age, SameSite/domain, secure/httpOnly/path attributes, and Set-Cookie append behavior. Snapshot complete Set-Cookie strings in tests.

- [ ] **Step 3: Extract session flow**

`session.ts` owns profile/user summary, rate-limit check, token refresh, maybe-refresh, exchange, refresh, me, logout, validation, and action dispatch. Export `checkSessionRateLimit` for the existing tests. Keep refresh failures fail-closed and preserve best-effort upstream logout.

- [ ] **Step 4: Extract sanitized headers and proxies**

`requestHeaders.ts` owns caller auth, request-header sanitation, geo headers, and content headers. `supabaseApiProxy.ts` owns REST/RPC proxying. `functionProxy.ts` owns function body cloning, trusted-ingress signing, upstream refresh retry, response header merge, system-status fallback, and streaming return.

Only `system-status` may clone/read its bounded JSON response for fallback mutation; all other upstream bodies remain streamed:

```ts
return new Response(upstreamResponse.body, {
  status: upstreamResponse.status,
  headers: responseHeaders,
});
```

- [ ] **Step 5: Reduce `index.ts` to visible dispatch**

Keep in order: request ID and CORS, OPTIONS/origin denial, public turnstile policy, required config, session routes, blocked RPC, Data API proxy validation, function path, kill switch, function allowlist, function proxy, exception report/error response.

- [ ] **Step 6: Verify and commit**

```bash
npm run worker:types
npm run worker:typecheck
npm run worker:test
wc -l cloudflare/edge-proxy/src/index.ts cloudflare/edge-proxy/src/*.ts
git diff --check
git add cloudflare/edge-proxy/src cloudflare/edge-proxy/worker-configuration.d.ts
git commit -m "refactor: decompose cloudflare edge proxy"
```

Expected: entrypoint is at most 500 lines, focused modules normally remain below 400, all current 11-or-later runtime tests pass, and upstream behavior is byte/status/header compatible.

---

### Task 4: Extract only proven-identical shared Deno primitives

**Files:**
- Create: `supabase/functions/_shared/postgrestErrors.ts`
- Create: `supabase/functions/_shared/postgrestErrors_test.ts`
- Create only if matrix matches: `supabase/functions/_shared/requestMetadata.ts`
- Create corresponding test only if adopted
- Modify: adopting Edge Function files one family at a time

**Interfaces:**
- Consumes: PostgREST errors `{ code?, message? }` and bounded request headers.
- Produces: pure missing-relation/column classification; optional exact shared metadata sanitizer.

- [ ] **Step 1: Build a helper contract matrix**

For every current `isMissingRelation`/`isMissingColumn` implementation, record accepted codes, case behavior, relation/column match, `PGRST204`, and `schema cache` handling. For metadata, record header names, trust source, limits, title casing, login enum values, and null behavior. Do not share functions whose rows differ.

- [ ] **Step 2: Write failing PostgREST error tests**

```ts
import { isMissingPostgrestColumn, isMissingPostgrestRelation } from "./postgrestErrors.ts";

Deno.test("classifies missing relations without broadening other errors", () => {
  if (!isMissingPostgrestRelation({ code: "42P01", message: 'relation "tenant_admin_sessions" does not exist' }, "tenant_admin_sessions")) throw new Error("expected missing relation");
  if (isMissingPostgrestRelation({ code: "42501", message: "permission denied" }, "tenant_admin_sessions")) throw new Error("must not hide permissions");
});

Deno.test("schema-cache column fallback is opt-in", () => {
  const error = { code: "PGRST204", message: "Could not find the feature_flags column in the schema cache" };
  if (isMissingPostgrestColumn(error, "feature_flags")) throw new Error("strict mode must reject schema-cache fallback");
  if (!isMissingPostgrestColumn(error, "feature_flags", { allowSchemaCache: true })) throw new Error("compat mode must accept it");
});
```

- [ ] **Step 3: Implement the narrow helper**

```ts
export type PostgrestErrorLike = { code?: string; message?: string };

export const isMissingPostgrestRelation = (
  error: PostgrestErrorLike | null | undefined,
  relation: string
): boolean => Boolean(
  error?.code === "42P01" &&
  (error.message ?? "").toLowerCase().includes(relation.toLowerCase())
);

export const isMissingPostgrestColumn = (
  error: PostgrestErrorLike | null | undefined,
  column: string,
  options: { allowSchemaCache?: boolean } = {}
): boolean => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  if (!message.includes(column.toLowerCase())) return false;
  return error.code === "42703" ||
    (options.allowSchemaCache === true && (error.code === "PGRST204" || message.includes("schema cache")));
};
```

- [ ] **Step 4: Adopt only exact semantics**

Replace local helpers with strict calls where current code accepts only `42P01`/`42703`; pass `{ allowSchemaCache: true }` only at existing compatibility branches that already accept it. Preserve named constraint classifiers.

- [ ] **Step 5: Decide request metadata separately**

Extract it only if at least two call sites have identical trusted header names and normalization. In particular, do not merge the Worker's `x-itx-geo-*` trusted metadata with Edge Functions that read raw `cf-*` headers unless ingress already guarantees that exact trust boundary.

- [ ] **Step 6: Verify and commit**

```bash
deno test --allow-env --frozen supabase/functions/_shared/*_test.ts
deno check --frozen supabase/functions/admin-ops/index.ts supabase/functions/super-ops/index.ts supabase/functions/super-tenant-mutate/index.ts
git diff --check
git add supabase/functions/_shared supabase/functions/*/index.ts
git commit -m "refactor: share postgrest compatibility checks"
```

---

### Task 5: Decompose `super-ops` after authorization

**Files:**
- Create: `supabase/functions/super-ops/context.ts`
- Create: `supabase/functions/super-ops/actions/securitySessions.ts`
- Create: `supabase/functions/super-ops/actions/controlCenter.ts`
- Create: `supabase/functions/super-ops/actions/support.ts`
- Create: `supabase/functions/super-ops/actions/salesCustomers.ts`
- Create: `supabase/functions/super-ops/actions/internalOps.ts`
- Create: `supabase/functions/super-ops/actions/subprocessors.ts`
- Create: `supabase/functions/super-ops/actions_test.ts`
- Modify: `supabase/functions/super-ops/index.ts`

**Interfaces:**
- Consumes: an already authenticated/authorized/rate-limited `SuperOpsContext`.
- Produces: `dispatchSuperOpsAction(context): Promise<Response>` with the same 26 action names and envelopes.

- [ ] **Step 1: Add an exhaustive action-registry test**

Lock these current actions: `verify_password`, `touch_session`, `list_sessions`, `revoke_session`, `revoke_all_sessions`, `get_control_center`, `set_runtime_config`, `upsert_alert_rule`, `set_tenant_policy`, `set_tenant_force_reauth`, `create_approval`, `approve_request`, `list_support_requests`, `get_support_request`, `update_support_request`, `list_sales_leads`, `close_sales_lead`, `move_sales_lead_to_customer`, `set_sales_lead_stage`, `delete_sales_lead`, `list_customers`, `add_customer_status_entry`, `get_internal_ops_snapshot`, `preview_subprocessor_notice`, `announce_subprocessor_change`, and `list_subprocessor_notices`.

The merged file currently has 26 names; update the expected set only if merged-main evidence adds/removes a live action before extraction.

- [ ] **Step 2: Define the authorized context**

```ts
export type JsonResponse = (status: number, body: Record<string, unknown>) => Response;
export type WriteSuperAudit = (
  actionType: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown>
) => Promise<void>;

export type SuperOpsContext = {
  req: Request;
  action: string;
  payload: Record<string, unknown>;
  adminClient: SupabaseAdminClient;
  user: { id: string; email?: string | null };
  profile: { auth_email?: string | null };
  accessToken: string;
  supabaseUrl: string;
  publishableKey: string | null;
  jsonResponse: JsonResponse;
  writeAudit: WriteSuperAudit;
};
```

Use the actual Supabase client return type already declared in the live file. Do not put auth/role/step-up/rate limiting in this context module.

- [ ] **Step 3: Keep security ordering in `index.ts`**

The entrypoint retains, in order: CORS, trusted ingress, kill switch, auth header, env validation, user validation, super-admin active profile, body validation, security-action exception decision, privileged step-up for all other actions, rate limiting, audit closure, then action dispatch.

- [ ] **Step 4: Move one action family per commit**

Each family exports its exact action set and a handler returning `Response | null`; `null` means the action belongs to another family. Move helpers with the only family that uses them. Keep attachment path validation and email construction with support/subprocessor domains.

After each family:

```bash
deno check --frozen supabase/functions/super-ops/index.ts
deno test --allow-env --frozen supabase/functions/_shared/*_test.ts supabase/functions/super-ops/actions_test.ts
git diff --check
git commit -m "refactor: extract super ops security sessions"
git commit -m "refactor: extract super ops control center"
git commit -m "refactor: extract super ops support actions"
git commit -m "refactor: extract super ops sales actions"
git commit -m "refactor: extract super ops internal snapshot"
git commit -m "refactor: extract super ops subprocessor actions"
```

Create only the commit matching the family just moved; do not batch all six commands after one diff.

- [ ] **Step 5: Verify no action or audit behavior was lost**

Compare action registry against `src/services/superOpsService.ts` and generated edge contracts. Exercise representative read/write/error paths with the existing E2E/service mocks. Confirm unknown actions retain the same status/body.

---

### Task 6: Decompose `super-tenant-mutate` after authorization

**Files:**
- Create: `supabase/functions/super-tenant-mutate/context.ts`
- Create: `supabase/functions/super-tenant-mutate/actions/tenantQueries.ts`
- Create: `supabase/functions/super-tenant-mutate/actions/districts.ts`
- Create: `supabase/functions/super-tenant-mutate/actions/tenantWrites.ts`
- Create: `supabase/functions/super-tenant-mutate/actions/primaryAdmins.ts`
- Create: `supabase/functions/super-tenant-mutate/actions_test.ts`
- Modify: `supabase/functions/super-tenant-mutate/index.ts`

**Interfaces:**
- Consumes: already trusted, authenticated, active-super-admin, step-up-verified, rate-limited context.
- Produces: the unchanged actions `list_tenants`, `list_districts`, `create_district`, `update_district`, `get_district_details`, `create_tenant`, `update_tenant`, `set_tenant_status`, `send_primary_admin_reset`, `set_primary_admin`.

- [ ] **Step 1: Lock the action registry and error contracts**

Test exact action membership and invalid-action response. Add direct tests for district slug/plan/billing validators, tenant status/plan/account-category validators, duplicate slug/access code messages, missing-column fallback selection, and reset redirect allowlist before moving them.

- [ ] **Step 2: Define one context after the existing security gate**

Pass `req`, action, payload, `userClient`, `adminClient`, user/profile, `jsonResponse`, `writeAudit`, reset URL inputs, and service env values actually needed by action modules. Do not let child modules read authorization headers or perform the top-level role/step-up/rate checks.

- [ ] **Step 3: Move query/enrichment, district, tenant-write, and primary-admin families separately**

Keep `enrichTenants` with tenant queries and `enrichDistricts` with district actions. Keep auth user creation/update/reset and rollback behavior with primary-admin actions. Preserve transaction limitations and the order of database/auth/audit operations exactly.

- [ ] **Step 4: Verify each commit**

```bash
deno check --frozen supabase/functions/super-tenant-mutate/index.ts
deno test --allow-env --frozen supabase/functions/_shared/*_test.ts supabase/functions/super-tenant-mutate/actions_test.ts
npm run devops:check:edge-contract-drift
git diff --check
```

Expected end state: entrypoint visibly owns all security gates and normally remains below 500 lines; action modules remain domain-focused.

---

### Task 7: Decompose `admin-ops` after tenant authorization and session validation

**Files:**
- Create: `supabase/functions/admin-ops/context.ts`
- Create: `supabase/functions/admin-ops/actions/notifications.ts`
- Create: `supabase/functions/admin-ops/actions/settings.ts`
- Create: `supabase/functions/admin-ops/actions/statusTracking.ts`
- Create: `supabase/functions/admin-ops/actions/sessions.ts`
- Create: `supabase/functions/admin-ops/actions/bulkGear.ts`
- Create: `supabase/functions/admin-ops/actions_test.ts`
- Modify: `supabase/functions/admin-ops/index.ts`

**Interfaces:**
- Consumes: trusted ingress, active tenant profile/context, token/session binding, suspension state, feature policy, and action-specific step-up result already computed by the entrypoint.
- Produces: unchanged actions `get_notifications`, `get_tenant_settings`, `update_tenant_settings`, `get_status_tracking`, `touch_session`, `validate_session`, `list_sessions`, `revoke_session`, `revoke_current_session`, `revoke_all_sessions`, and `bulk_import_gear`.

- [ ] **Step 1: Lock session/security behavior before extraction**

Add tests for blocked token, missing session table fallback, missing auth-binding/metadata columns, revoked/current/all session actions, suspended tenant write denial, tenant-admin-only actions, missing privileged-step-up table, feature-flag missing-column fallback, and 1,000-row bulk limit.

- [ ] **Step 2: Keep gate order explicit**

The entrypoint retains CORS, request ID, trusted ingress, kill switch, auth token, env, admin client, auth-session binding/token hash, user/profile/role/active/tenant checks, rate limit, token/session revocation checks, tenant policy/maintenance resolution, action-specific role/suspension/step-up decision, then dispatch. Do not turn this into generic middleware.

- [ ] **Step 3: Move action families one at a time**

Keep session fallback classifiers and binding-specific updates with the sessions family; keep CSV/bulk validation and history writes with bulk gear; keep feature-flag normalization with settings. Pass `jsonResponse` so bodies/statuses remain exact.

- [ ] **Step 4: Verify and commit each family**

```bash
deno check --frozen supabase/functions/admin-ops/index.ts
deno test --allow-env --frozen supabase/functions/_shared/*_test.ts supabase/functions/admin-ops/actions_test.ts
npm run devops:check:edge-contract-drift
npx playwright test tests/e2e/admin-mutation-guards.spec.ts tests/e2e/auth-edge-cases.spec.ts
git diff --check
```

Expected: admin actions, role/suspension checks, session revocation, and feature fallbacks are behavior-compatible; the entrypoint is normally below 500 lines.

---

### Task 8: Evaluate remaining edge duplication without broadening scope

**Files:**
- Inspect: `supabase/functions/*/index.ts`
- Modify only proven clusters and their tests
- Preserve: SQL and deployment configuration

**Interfaces:**
- Consumes: post-Tasks 4-7 duplication report.
- Produces: narrow pure helper extractions or documented intentional differences.

- [ ] **Step 1: Re-run a Deno-aware duplication scan**

```bash
npx -y jscpd supabase/functions cloudflare/edge-proxy/src --min-lines 8 --min-tokens 70 --reporters console
```

Classify each cluster as pure-identical, security-order, action-specific database logic, compatibility fallback, or incidental text.

- [ ] **Step 2: Extract only pure-identical normalization/formatting**

Good candidates require at least two exact contracts and direct tests. Do not centralize trusted ingress/auth/role/step-up/rate-limit sequencing; those checks remain explicit per endpoint. Keep endpoint-specific CORS headers separate unless method/header sets match exactly.

- [ ] **Step 3: Record intentionally preserved duplication**

Capture endpoint names, lines/functions, and the concrete contract difference for Plan 4's report. Missing-table/column fallback, error status differences, and role-specific authorization are valid reasons to retain duplication.

---

### Task 9: Complete the edge checkpoint

**Files:**
- Verify: all Plan 3 changes
- Record later: final report in Plan 4

**Interfaces:**
- Consumes: decomposed Worker and Edge Functions.
- Produces: a clean security-sensitive checkpoint before styles/dependencies/generated-state cleanup.

- [ ] **Step 1: Run all Worker and shared Deno gates**

```bash
npm run worker:types:check
npm run worker:typecheck
npm run worker:test
deno fmt --check cloudflare/edge-proxy/src supabase/functions/_shared supabase/functions/super-ops supabase/functions/super-tenant-mutate supabase/functions/admin-ops
deno test --allow-env --frozen supabase/functions/_shared/*_test.ts supabase/functions/super-ops/*_test.ts supabase/functions/super-tenant-mutate/*_test.ts supabase/functions/admin-ops/*_test.ts
deno check --frozen supabase/functions/super-ops/index.ts supabase/functions/super-tenant-mutate/index.ts supabase/functions/admin-ops/index.ts
```

Expected: generated types are current; Worker source typechecks; all runtime/shared/action tests pass; frozen verification does not modify `deno.lock`.

- [ ] **Step 2: Run repository coupling and frontend regressions**

```bash
npm run devops:check:edge-coverage
npm run devops:check:edge-contract-drift
ITX_DIFF_BASE=origin/main ITX_DIFF_HEAD=HEAD npm run devops:check:sql-coupling
npm run build
npm run security:gate
npx playwright test
git diff --check
git status --short --branch
```

Expected: all commands pass and the worktree is clean.

- [ ] **Step 3: Review security order directly**

Read each final entrypoint top to bottom and confirm the required gates occur before any action module call. Compare trusted-ingress signature input, cookie attributes, rate-limit keys, audit writes, DB calls, error envelopes, and status codes against the pre-refactor diff/contract tests.

- [ ] **Step 4: Stop on any unexplained security or data-path difference**

Use the task-sized commits to isolate the discrepancy, restore the last proven behavior, rerun the affected Deno/Worker test plus coupling/security gates, and commit the narrow correction before Plan 4.
