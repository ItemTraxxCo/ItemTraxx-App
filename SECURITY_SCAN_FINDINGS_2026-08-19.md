# Security Review: itemtraxx-code

## Scope

Repository-wide Standard source security audit of the current clean revision.

- Scan mode: repository
- Target kind: git_revision
- Target ID: target_sha256_591171bac08b952ce256b32732587a67a6393132b20dc420eaba101387e12143
- Revision: f21c274ba27f791cdf00d282b6d2e2fedf898ccf
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: Source and local validation only; provider/deployed runtime unavailable.
- Artifacts reviewed: SECURITY.md, package.json, package-lock.json, deno.lock, .env.example, src/, supabase/functions/, supabase/migrations/, supabase/sql/, supabase/config.toml, cloudflare/edge-proxy/, .github/workflows/, scripts/, vercel.json, SECURITY_SCAN_FINDINGS.md

Limitations and exclusions:
- TAC security-access connector unavailable because connector was not connected.
- GitHub protections, secret scopes, Cloudflare DNS/hosting/deployed vars, Supabase deployed configuration, provider dashboards, and production runtime were not queried.
- No production data, credentials, or state were changed.
- Excluded .git/: Git metadata/history outside source-scope review.
- Excluded node_modules/: Installed dependency source not authoritative; manifests/lockfiles reviewed.
- Excluded dist/: Generated build output not source of truth.
- Excluded artifacts/: Generated CI/security artifacts outside committed source scope.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 8 |
| Severity mix | high: 2, medium: 3, low: 3 |
| Confidence mix | high: 6, medium: 2 |
| Coverage | partial |
| Validation mode | Parent-led and delegated static source traces; npm audit/security gate; Worker typecheck/tests; focused Deno tests; frontend unit tests; git integrity checks. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

ItemTraxx is a multi-tenant Vue application with Cloudflare Worker edge proxying, Supabase Edge Functions/Postgres/RLS, browser cookies/tokens, storage/email/telemetry integrations, and GitHub Actions deployment workflows.

### Assets

- tenant/workspace inventory and borrower PII
- checkout and audit records
- super-admin credentials, passkeys, sessions, and step-up state
- browser session tokens
- support attachments and provider secrets
- production code/configuration
- telemetry and CI credentials

### Trust Boundaries

- browser to static frontend
- browser to Cloudflare Worker
- Worker to Supabase APIs/functions
- service-role Edge Functions to Postgres/storage
- public forms/uploads to email/jobs
- GitHub checkout/dependencies to providers
- application telemetry to Sentry/PostHog/Intercom

### Attacker Capabilities

- unauthenticated network client
- authenticated tenant/workspace account
- retained account with unexpired JWT
- same-site subdomain or compromised browser origin
- GitHub workflow-dispatch/write actor
- dependency or lockfile compromise

### Security Objectives

- tenant/access-grant isolation
- role/workspace/session/revocation integrity
- safe provider and edge bounds
- no secret or PII leakage
- deployment/workflow integrity

### Assumptions

- Exact reviewed target is clean revision f21c274ba27f791cdf00d282b6d2e2fedf898ccf.
- Active migrations/configuration define runtime; archived/manual SQL is not treated as deployed unless referenced.
- GitHub protection, provider settings, DNS, and production runtime require separate verification.

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Manual Supabase function deployment accepts option-injected workflow input](#finding-1) | high | high | inline below |
| [Secret-bearing manual workflows execute caller-selected branch code](#finding-2) | high | high | inline below |
| [Workspace-admin identity-management writes ignore suspended workspace status](#finding-3) | medium | high | inline below |
| [Tenant accounts can read workspace-wide notification item and status data](#finding-4) | medium | high | inline below |
| [Wildcard workspace CORS trusts unprovisioned hosts while session cookies cover every subdomain](#finding-5) | medium | medium | inline below |
| [Malformed percent-encoded cookies turn public Worker requests into 500s and telemetry events](#finding-6) | low | high | inline below |
| [Session exchange parses an unbounded request body](#finding-7) | low | high | inline below |
| [Workspace suspension checks fail open on status lookup errors](#finding-8) | low | medium | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Manual Supabase function deployment accepts option-injected workflow input

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | The input declaration, unquoted expansion, argparse options, and deployment sink are present in the exact revision; duplicate `--project-ref` behavior was observed with the local helper in `--dry-run` mode. |
| Category | deployment-integrity |
| CWE | CWE-20, CWE-284, CWE-829 |
| Affected lines | .github/workflows/deploy-supabase-functions.yml:16-21, .github/workflows/deploy-supabase-functions.yml:93-103, scripts/deploy-supabase-functions.py:61-70, scripts/deploy-supabase-functions.py:84-95 |

#### Summary

The production-capable function deployment workflow expands a free-form workflow_dispatch input directly into the Python deployment command. argparse treats values such as `--project-ref attacker-project` or `--dry-run` as options, so a dispatch caller can override the fixed production project reference or deployment behavior.

#### Root Cause

A manual deployment selector is treated as raw command-line text. The workflow does not delimit positional function names or validate them before invoking a parser that also accepts deployment-control flags.

#### Validation

The local command with duplicate project options printed `target project: attacker-project` and a deploy command for that project.

Validation method: static source trace plus local dry-run reproduction

Evidence:
- The input is shell-split after the fixed project option.
- Unknown positional function names are checked, but option injection is not.

#### Dataflow

The canonical finding records the affected path at .github/workflows/deploy-supabase-functions.yml:16-21, .github/workflows/deploy-supabase-functions.yml:93-103, scripts/deploy-supabase-functions.py:61-70, scripts/deploy-supabase-functions.py:84-95, but no expanded source-to-sink narrative was recorded.

- **Source:** workflow_dispatch.functions

- **Sink:** Supabase CLI `--project-ref` with `SUPABASE_ACCESS_TOKEN`

- **Outcome:** deployment targets an attacker-selected project

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

- **Attacker:** GitHub workflow-dispatch/write actor

- **Entry point:** Deploy Supabase Functions manual dispatch

- **Outcome:** redirected or altered deployment

#### Severity

**High** — A caller authorized to dispatch the protected production workflow can redirect the production Supabase access token and deployment operation to an attacker-selected project. This is option injection, not shell metacharacter execution.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Parse a dedicated function-list input, reject values outside the discovered function allowlist, pass positional arguments only after `--`, and reject user-supplied project/deployment flags. Keep the production project reference fixed by the protected environment.

Tests:
- Dispatch with `--project-ref`, `--dry-run`, and unknown names and assert rejection before the CLI.
- Assert the effective project reference always equals the protected environment value.

<a id="finding-2"></a>

### [2] Secret-bearing manual workflows execute caller-selected branch code

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | The workflows enable workflow_dispatch, checkout without a fixed trusted ref, and expose secrets to commands sourced from checkout. Actual provider token scopes remain external uncertainty. |
| Category | ci-secret-exposure |
| CWE | CWE-522, CWE-829, CWE-284 |
| Affected lines | .github/workflows/vercel-analytics-report.yml:11-16, .github/workflows/vercel-analytics-report.yml:48-65, scripts/vercel-analytics-agent.mjs:33-38, .github/workflows/strix-security.yml:10, .github/workflows/strix-security.yml:39-66 |

#### Summary

Several workflow_dispatch jobs check out the event-selected ref and run repository-controlled code while exposing provider secrets. Vercel Analytics runs `scripts/vercel-analytics-agent.mjs` with Vercel and Slack credentials, and Strix runs over the checked-out tree with `NVIDIA_API_KEY`; neither manual path has a trusted-ref gate.

#### Root Cause

Manual workflows rely on the caller-selected ref while treating checkout as trusted. The missing ref gate lets a write actor choose code that runs in a secret-bearing job without merge or protected-environment review.

#### Validation

The definitions expose secrets after checkout and execute repository code; the analytics script performs authenticated outbound fetches.

Validation method: static workflow and source trace

Evidence:
- No trusted-ref condition is present in the affected jobs.
- The analytics script receives provider secrets and performs network requests.

#### Dataflow

The canonical finding records the affected path at .github/workflows/vercel-analytics-report.yml:11-16, .github/workflows/vercel-analytics-report.yml:48-65, scripts/vercel-analytics-agent.mjs:33-38, .github/workflows/strix-security.yml:10, .github/workflows/strix-security.yml:39-66, but no expanded source-to-sink narrative was recorded.

- **Source:** workflow_dispatch selected ref

- **Sink:** script-controlled network request

- **Outcome:** provider credentials or data are exfiltrated or abused

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

- **Attacker:** GitHub repository write actor

- **Entry point:** Vercel Analytics or Strix manual dispatch

- **Outcome:** secret-bearing execution of unreviewed branch code

#### Severity

**High** — A write actor can push an unmerged branch and run the job so branch-controlled code can send provider secrets to an arbitrary network destination. The direct examples expose meaningful credentials; production deployment workflows are separately guarded.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Restrict secret-bearing manual jobs to `refs/heads/main` or an immutable reviewed SHA, or move secret-bearing logic into a protected reusable workflow. Do not execute caller-selected branch code in jobs that receive provider secrets; require protected-environment approval and short-lived credentials.

Tests:
- Lint secret-bearing workflow_dispatch jobs for a trusted-ref condition.
- Add a negative test proving a non-main ref exits before secret-bearing steps.

<a id="finding-3"></a>

### [3] Workspace-admin identity-management writes ignore suspended workspace status

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | The suspension setter, missing status selection, and service-role mutation branches are directly visible; sibling admin mutation surfaces already contain the intended status guard. |
| Category | authorization-bypass |
| CWE | CWE-863 |
| Affected lines | supabase/functions/workspace-admin-mutate/index.ts:117-147, supabase/functions/workspace-admin-mutate/index.ts:202-232, supabase/functions/workspace-admin-mutate/index.ts:277-292, supabase/functions/workspace-admin-mutate/index.ts:299-404, supabase/functions/super-workspace-mutate/index.ts:302-326 |

#### Summary

The `workspace-admin-mutate` function authenticates a workspace admin and validates device/re-auth controls, but its service-role workspace lookup omits `status` and never calls the shared workspace-access resolver. Existing workspace-admin sessions can therefore create, modify, reset, or remove identity records after a Super Admin suspends the workspace.

#### Root Cause

The identity endpoint applies session and recent-auth controls but does not carry the workspace lifecycle invariant into service-role mutation branches. Suspension changes the database state elsewhere, yet the endpoint never reads it.

#### Validation

No workspace status query or resolver call occurs before any identity-management write. Shared workspace-access tests and sibling guards demonstrate the intended fail-closed control, but no endpoint regression test covers this path.

Validation method: static source trace

Evidence:
- Tenant creation, status/email changes, removal, workspace-admin creation/status/email, and reset paths remain after common checks.

#### Dataflow

The canonical finding records the affected path at supabase/functions/workspace-admin-mutate/index.ts:117-147, supabase/functions/workspace-admin-mutate/index.ts:202-232, supabase/functions/workspace-admin-mutate/index.ts:277-292, supabase/functions/workspace-admin-mutate/index.ts:299-404, supabase/functions/super-workspace-mutate/index.ts:302-326, but no expanded source-to-sink narrative was recorded.

- **Source:** workspace suspension plus retained admin session

- **Sink:** profiles/Auth/account_sessions writes

- **Outcome:** identity and credential changes continue in suspended workspace

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

- **Attacker:** workspace administrator

- **Entry point:** `workspace-admin-mutate` identity action

- **Outcome:** lifecycle suspension bypass

#### Severity

**Medium** — This is a lifecycle authorization bypass for an already-authorized workspace administrator. It does not create anonymous or cross-workspace access, but permits account persistence and credential-management writes while suspended.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Select `status` and call `resolveWorkspaceAccess` before every workspace-admin identity action; reject suspended/unavailable workspaces with 403/503 or define a separate authorized recovery action. Consider revoking existing sessions on suspension.

Tests:
- Run every identity write with `workspaces.status='suspended'` and assert rejection.
- Test suspension immediately after a valid admin session is established.

<a id="finding-4"></a>

### [4] Tenant accounts can read workspace-wide notification item and status data

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | The role acceptance, omitted allowlist entry, active-session gate, and service-role queries are directly connected. Existing tests do not cover tenant denial for `get_notifications`. |
| Category | authorization-bypass |
| CWE | CWE-862, CWE-863, CWE-200 |
| Affected lines | supabase/functions/admin-ops/actions/index.ts:45-51, supabase/functions/admin-ops/index.ts:132-147, supabase/functions/admin-ops/index.ts:202-215, supabase/functions/admin-ops/actions/notifications.ts:10-31, src/App.vue:213 |

#### Summary

The `admin-ops` role gate omits `get_notifications` from its workspace-admin-only set. A valid `tenant_account` with an active device session can reach a handler that uses the service-role client to return workspace-wide item counts and recent item names, barcodes, and status history without access-grant filtering.

#### Root Cause

The action registry assumes notifications are an admin-only dashboard feature, but the role allowlist does not encode that assumption. Once a tenant session passes common checks, service-role workspace-wide reads are returned.

#### Validation

A tenant role can reach `get_notifications`; focused admin-ops and notification tests pass but do not assert tenant denial for this action.

Validation method: static source trace plus focused Deno tests

Evidence:
- The response returns item names/barcodes through `recent_status_events`.
- No access-grant predicate is present in the service-role queries.

#### Dataflow

The canonical finding records the affected path at supabase/functions/admin-ops/actions/index.ts:45-51, supabase/functions/admin-ops/index.ts:132-147, supabase/functions/admin-ops/index.ts:202-215, supabase/functions/admin-ops/actions/notifications.ts:10-31, src/App.vue:213, but no expanded source-to-sink narrative was recorded.

- **Source:** authenticated tenant account

- **Sink:** service-role item/status queries

- **Outcome:** restricted inventory/status metadata is readable

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

- **Attacker:** authenticated tenant account

- **Entry point:** `admin-ops` action `get_notifications`

- **Outcome:** same-workspace access-grant boundary is bypassed

#### Severity

**Medium** — The issue crosses the tenant-account access boundary within one workspace and discloses inventory/status metadata, but does not provide cross-workspace access, writes, or secrets.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Add `get_notifications` to `WORKSPACE_ADMIN_ONLY_ACTIONS` and test tenant 403. If tenant notifications are intended, use explicit access-grant filtering for every returned item and status row.

Tests:
- Assert `authorizeAdminOpsAction` denies `get_notifications` for `tenant_account`.
- Verify a restricted item is absent from notification history for a tenant account.

<a id="finding-5"></a>

### [5] Wildcard workspace CORS trusts unprovisioned hosts while session cookies cover every subdomain

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Origin and cookie behavior are direct source facts; whether an unprovisioned subdomain can be attacker-controlled depends on unavailable DNS/hosting state. |
| Category | origin-and-session-boundary |
| CWE | CWE-942, CWE-1275 |
| Affected lines | cloudflare/edge-proxy/src/cors.ts:36-45, cloudflare/edge-proxy/src/cors.ts:64-68, cloudflare/edge-proxy/src/cookies.ts:59-63, cloudflare/edge-proxy/wrangler.toml:22-27, docs/workspace-model-rollout.md:35-37 |

#### Summary

The Worker and Supabase CORS helpers accept any syntactically valid `*.app.itemtraxx.com` origin, while the production Worker sets HttpOnly session cookies with `Domain=.itemtraxx.com`. Rollout documentation instead requires an exact per-workspace allowlist and removal during archive/purge, so a stale or compromised workspace host would become a credentialed browser origin.

#### Root Cause

CORS and cookie trust are based on the parent-domain naming convention rather than active provisioning. Any non-reserved syntactically valid subdomain is treated as a credentialed origin although rollout control expects lifecycle synchronization.

#### Validation

Worker tests confirm syntax-only wildcard behavior, including `https://new-workspace.app.itemtraxx.com`, while checked-in production vars set `SESSION_COOKIE_DOMAIN=.itemtraxx.com`.

Validation method: static source/config review plus Worker tests

Evidence:
- The CORS rule does not consult an active-workspace set.
- The cookie writer emits the configured parent domain.

#### Dataflow

The canonical finding records the affected path at cloudflare/edge-proxy/src/cors.ts:36-45, cloudflare/edge-proxy/src/cors.ts:64-68, cloudflare/edge-proxy/src/cookies.ts:59-63, cloudflare/edge-proxy/wrangler.toml:22-27, docs/workspace-model-rollout.md:35-37, but no expanded source-to-sink narrative was recorded.

- **Source:** attacker-controlled `*.app.itemtraxx.com` origin

- **Sink:** credentialed Worker/Supabase responses

- **Outcome:** session actions/data reachable from compromised subdomain

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

- **Attacker:** same-site subdomain or stale-host attacker

- **Entry point:** browser CORS request to edge proxy

- **Outcome:** cross-subdomain session use

#### Severity

**Medium** — If an unprovisioned or hijacked workspace subdomain serves attacker-controlled JavaScript, reflected credentialed CORS and parent-domain cookies permit same-site session use. DNS/hosting reachability is not proven locally.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Generate CORS origins from active provisioned workspace records and remove them on archive/purge. Prefer host-only `__Host-` cookies or a narrowly scoped handoff cookie instead of `Domain=.itemtraxx.com`.

Tests:
- Reject unknown syntactically valid slugs absent from the active provisioned set.
- Verify archived origins lose CORS and cookie access after lifecycle removal.

<a id="finding-6"></a>

### [6] Malformed percent-encoded cookies turn public Worker requests into 500s and telemetry events

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | The parser, shared call sites, top-level 500 handling, and Sentry exception path are direct facts; current cookie tests do not cover malformed percent encoding. |
| Category | availability-and-observability |
| CWE | CWE-400, CWE-20 |
| Affected lines | cloudflare/edge-proxy/src/cookies.ts:12-23, cloudflare/edge-proxy/src/functionProxy.ts:55-63, cloudflare/edge-proxy/src/index.ts:191-194, cloudflare/edge-proxy/src/observability.ts:88-113 |

#### Summary

The shared Worker cookie parser calls `decodeURIComponent` without a per-cookie exception boundary. A request containing `itx_session=%ZZ` throws before authentication/upstream handling, the Worker returns 500, and the exception path schedules one Sentry event for each request.

#### Root Cause

Cookie parsing treats untrusted percent encoding as trusted input. The thrown decoder error crosses the request boundary and is handled as an internal failure instead of a malformed-cookie rejection.

#### Validation

Worker tests pass (105 tests) and cover malformed pairs, but no test supplies a malformed percent escape. Source establishes the uncaught throw and 500/telemetry path.

Validation method: static source trace plus Worker tests

Evidence:
- Malformed cookies can fail requests before upstream authorization.
- Exception reporting is reached for each caught request.

#### Dataflow

The canonical finding records the affected path at cloudflare/edge-proxy/src/cookies.ts:12-23, cloudflare/edge-proxy/src/functionProxy.ts:55-63, cloudflare/edge-proxy/src/index.ts:191-194, cloudflare/edge-proxy/src/observability.ts:88-113, but no expanded source-to-sink narrative was recorded.

- **Source:** attacker-controlled Cookie header

- **Sink:** Worker response and Sentry event

- **Outcome:** request failure and telemetry amplification

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

- **Attacker:** unauthenticated network client

- **Entry point:** public Worker function/REST/session route

- **Outcome:** repeated malformed-cookie failures

#### Severity

**Low** — This is unauthenticated availability and observability amplification. It does not bypass authentication or disclose data, but repeated crafted requests can consume parsing/Worker work and create error noise.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Decode each cookie pair inside a try/catch and ignore or reject only the malformed pair; optionally return a bounded 400. Add malformed-percent tests and rate-limit/sample repeated Worker exception reporting.

Tests:
- Send `itx_session=%ZZ` and assert controlled 4xx or unauthenticated response, not 500.
- Assert malformed cookies do not schedule repeated Sentry events.

<a id="finding-7"></a>

### [7] Session exchange parses an unbounded request body

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | The direct `request.json()` call and available bounded-body helper are present in source; the missing control is unambiguous although the platform outer size limit was not queried. |
| Category | resource-exhaustion |
| CWE | CWE-400 |
| Affected lines | cloudflare/edge-proxy/src/session.ts:287-317, cloudflare/edge-proxy/src/session.ts:438-472, cloudflare/edge-proxy/src/requestBody.ts:36-71 |

#### Summary

The unauthenticated Worker session-exchange handler calls `request.json()` directly without the shared bounded-body helper or a declared-length check. A distributed client can send large streamed JSON bodies that are allocated and parsed before token validation.

#### Root Cause

Session exchange uses convenience JSON parsing instead of the repository bounded reader, so the untrusted body is fully allocated before rejection.

#### Validation

Worker tests confirm rate limiting runs before payload parsing, but no size cap is applied after the rate check.

Validation method: static source trace plus Worker tests

Evidence:
- Oversized bodies are read by `request.json()` regardless of declared length.
- The available proxy cap is not reused.

#### Dataflow

The canonical finding records the affected path at cloudflare/edge-proxy/src/session.ts:287-317, cloudflare/edge-proxy/src/session.ts:438-472, cloudflare/edge-proxy/src/requestBody.ts:36-71, but no expanded source-to-sink narrative was recorded.

- **Source:** public exchange request body

- **Sink:** Worker isolate parsing/memory

- **Outcome:** resource consumption and transient availability degradation

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

- **Attacker:** unauthenticated network client

- **Entry point:** `/auth/session/exchange`

- **Outcome:** unbounded body work

#### Severity

**Low** — This is a public resource-boundary defect. The route has a rate limiter and valid tokens are still required, so likely impact is transient Worker CPU/memory/upstream load rather than compromise.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Reject oversized `Content-Length` values and parse exchange through `readBoundedRequestBody` with a small cap before JSON decoding; retain the fail-closed rate limiter.

Tests:
- Send declared and streamed bodies over the cap and assert 413 before JSON parsing.
- Add a normal small exchange body regression test.

<a id="finding-8"></a>

### [8] Workspace suspension checks fail open on status lookup errors

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | medium |
| Confidence rationale | The boolean interpretation is direct, but the triggering query failure is environmental and the active schema declares status NOT NULL. |
| Category | fail-open-authorization |
| CWE | CWE-636, CWE-703 |
| Affected lines | supabase/functions/admin-ops/index.ts:181-188, supabase/functions/admin-ops/actions/index.ts:63-95, supabase/functions/admin-item-mutate/index.ts:141-149, supabase/migrations/20260725194622_workspace_model_role_redesign.sql:72-99 |

#### Summary

The `admin-ops` and `admin-item-mutate` handlers ignore workspace-status query errors and treat a missing row as not suspended. During a database/provider failure or unexpected empty result, suspension guards can continue into privileged operations instead of returning an unavailable response.

#### Root Cause

The handlers collapse `error`, `null`, and `active` into the same falsey branch, violating the fail-closed lifecycle invariant whenever status is unavailable.

#### Validation

The source directly shows ignored query errors and guards that test only a boolean. The shared `resolveWorkspaceAccess` helper already defines a fail-closed result but these handlers do not use it.

Validation method: static source trace

Evidence:
- A status query failure does not produce 503 or another blocking response.
- The NOT NULL schema constraint does not protect against provider/query errors.

#### Dataflow

The canonical finding records the affected path at supabase/functions/admin-ops/index.ts:181-188, supabase/functions/admin-ops/actions/index.ts:63-95, supabase/functions/admin-item-mutate/index.ts:141-149, supabase/migrations/20260725194622_workspace_model_role_redesign.sql:72-99, but no expanded source-to-sink narrative was recorded.

- **Source:** database/provider status-read failure

- **Sink:** admin-ops or item mutation action

- **Outcome:** lifecycle enforcement bypassed during fault window

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

- **Attacker:** authenticated workspace account

- **Entry point:** admin-ops or admin-item-mutate

- **Outcome:** write proceeds while state is indeterminate

#### Severity

**Low** — The issue is conditional on a status-read failure and affects lifecycle enforcement rather than normal-state cross-tenant access. It is a low-severity fail-closed control defect.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Use `resolveWorkspaceAccess` (or equivalent) and return 503 on status errors or missing rows; continue only when the workspace row exists and `status === 'active'`.

Tests:
- Mock status query errors and missing rows in both handlers and assert blocking 503.
- Keep suspended=403 and active=proceed regression tests.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Frontend auth, routing, telemetry, and data calls | not recorded | No issue found | Focused source/unit-test review; no dangerous HTML/URL sink found. |
| Supabase ingress, role/session/step-up checks, public forms, and service-role handlers | not recorded | Reported | Two authorization findings reported; other reviewed paths had no confirmed bypass. |
| Active SQL migrations, RLS, SECURITY DEFINER, and checkout/return | not recorded | No issue found | Active migration/RLS invariants and security gate passed. |
| Cloudflare routing, CORS, cookies, body limits, ingress, and observability | not recorded | Reported | Origin-boundary, malformed-cookie, and session-body findings reported. |
| GitHub Actions workflows, deployment scripts, action pinning, and secret-bearing jobs | not recorded | Reported | Two workflow/deployment findings reported; external action refs are full SHAs. |
| Dependency manifests/lockfiles, security scripts, env examples, and policy | not recorded | No issue found | Local npm audit/security gate passed; provider advisories unavailable. |

## Open Questions And Follow Up

- Are active workspace subdomains DNS/hosting-controlled and synchronized with the exact origin lifecycle documented in docs/workspace-model-rollout.md?
- Which GitHub actors can dispatch workflows, and which repository/org/environment secrets are available?
- Are checked-in migrations and Worker vars deployed to production providers at this revision?
- TAC, GitHub protections/secrets, Cloudflare DNS/hosting/deployed vars, Supabase deployed schema/config, and provider advisory dashboards unavailable.
  - Follow-up prompt: Review deferred unit provider-runtime and close its stated proof gap.
- Byte/signature bounds exist but no browser-specific reproduction established material impact.
  - Follow-up prompt: Review deferred unit support-upload-resource-bounds and close its stated proof gap. Paths: supabase/functions/contact-support-submit/index.ts, src/pages/super/SupportRequests.vue.
- Only demonstrated effect is self-directed notification/delivery log; suppressed under self-only impact policy.
  - Follow-up prompt: Review deferred unit login-notify-profile-lifecycle and close its stated proof gap. Paths: supabase/functions/login-notify/index.ts.
- Legacy/archive SQL and generated artifacts not treated as active runtime without current references.
  - Follow-up prompt: Review deferred unit legacy-runtime-sql and close its stated proof gap. Paths: supabase/sql/, supabase/migrations/.
