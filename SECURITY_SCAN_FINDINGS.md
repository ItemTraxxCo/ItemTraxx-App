# Security Review: itemtraxx-code

## Scope

Repository-wide Standard security scan of clean ItemTraxx revision covering tracked frontend, Edge Functions, SQL/migrations, Cloudflare Worker, workflows, dependencies, scripts, configuration, and SECURITY.md.

- Scan mode: repository
- Target kind: git_revision
- Target ID: target_sha256_591171bac08b952ce256b32732587a67a6393132b20dc420eaba101387e12143
- Revision: ddd019d277e55100d0b70780f65512fb60396817
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: Source/local validation only; no provider or production runtime access.
- Artifacts reviewed: SECURITY.md, package.json, package-lock.json, deno.lock, .env.example, src/, supabase/functions/, supabase/migrations/, cloudflare/edge-proxy/, .github/workflows/, scripts/, vercel.json, supabase/config.toml

Limitations and exclusions:
- TAC security-access connector was unavailable because the connector was not connected.
- GitHub protection/environment settings and deployed provider configuration were not verifiable from the repository.
- Local npm audit/security gate and lockfile checks passed; provider advisory dashboards were not queried.
- Excluded .git/: Git metadata/history were not part of source scope.
- Excluded node_modules/: Installed dependency source was used only for local implementation/build inspection; manifests and lockfiles are authoritative.
- Excluded dist/: Generated build output is not source-of-truth.
- Excluded artifacts/: Generated CI/security artifacts are outside committed source scope.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 11 |
| Severity mix | high: 2, medium: 6, low: 3 |
| Confidence mix | high: 10, medium: 1 |
| Coverage | partial |
| Validation mode | Parent-led static source traces, delegated surface reviews, repository security gate, Worker typecheck/tests, frontend unit tests, and production build. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

ItemTraxx is a multi-tenant Vue application with browser sessions, Cloudflare edge proxying, Supabase Edge Functions/Postgres/RLS, storage/email integrations, and GitHub Actions deployments. Objectives are tenant isolation, privileged-account integrity, session revocation, borrower/support confidentiality, safe edge routing, and supply-chain/deployment integrity.

### Assets

- tenant/workspace inventory and borrower data
- checkout and audit records
- super-admin credentials, passkeys, sessions, and step-up state
- browser cookies and access tokens
- support attachments and provider secrets
- production code/configuration
- observability data and CI credentials

### Trust Boundaries

- browser to Vercel/static app
- browser/session cookies to Cloudflare Worker
- Cloudflare Worker to Supabase APIs/functions
- Edge Functions/service role to Postgres/RLS/storage
- public forms/uploads to email/jobs
- GitHub checkout/dependencies to providers
- application telemetry to Sentry/PostHog/Intercom

### Attacker Capabilities

- unauthenticated caller
- authenticated tenant/workspace account
- former account with unexpired JWT after app revocation
- valid super-admin primary token without fresh step-up
- same-origin script or compromised browser session
- GitHub workflow-dispatch/write actor
- dependency or lockfile compromise

### Security Objectives

- server-enforced role/workspace/profile/device-session/step-up authorization
- protect borrower/support PII and privileged credentials
- bound public work and provider calls under failure
- prevent unreviewed/tampered production code
- avoid sensitive telemetry leakage

### Assumptions

- Exact reviewed target is clean commit ddd019d277e55100d0b70780f65512fb60396817.
- Archived/legacy SQL is not treated as deployed unless current configuration/migrations reference it.
- Provider dashboards, branch protection, environment reviewers, and production runtime were unavailable in this source-only scan.
- Local validation used bundled Node 24.19.0 plus repository Deno/tests; no production data/secrets were accessed.

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Super-admin passkey changes rely on a client-only reauthentication timer](#finding-1) | high | medium | inline below |
| [Manual production deployments use the caller-selected Git ref without a trusted-branch gate](#finding-2) | high | high | inline below |
| [Archived item and borrower list actions bypass account-session revocation and device binding](#finding-3) | medium | high | inline below |
| [PostHog session replay captures sensitive authenticated/admin DOM text](#finding-4) | medium | high | inline below |
| [Intercom JWT can be minted after profile disable/delete or custom session revocation](#finding-5) | medium | high | inline below |
| [Super-admin security-session actions bypass server-enforced secondary authentication](#finding-6) | medium | high | inline below |
| [Privileged deployment workflows execute dependency lifecycle scripts](#finding-7) | medium | high | inline below |
| [Public system-status rate limiting fails open on limiter errors](#finding-8) | medium | high | inline below |
| [Production Worker deployment is not gated on Worker typecheck or tests](#finding-9) | low | high | inline below |
| [Function routing fails open when `ALLOWED_FUNCTIONS` is empty](#finding-10) | low | high | inline below |
| [Error telemetry exports unsanitized request URLs, including query strings](#finding-11) | low | high | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Super-admin passkey changes rely on a client-only reauthentication timer

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | medium |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | client-side-security-enforcement |
| CWE | CWE-602, CWE-306 |
| Affected lines | src/pages/super/Settings.vue:338-340, src/pages/super/Settings.vue:397-405, src/pages/super/Settings.vue:448-477, supabase/functions/super-ops/actions/securitySessions.ts:56-88 |

#### Summary

Passkey registration/deletion are authorized by a mutable Vue `Date.now()` timer and then call Supabase Auth directly. The application does not use its server-side `verify_password` action to enforce the management window.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/pages/super/Settings.vue:338-340, src/pages/super/Settings.vue:397-405, src/pages/super/Settings.vue:448-477, supabase/functions/super-ops/actions/securitySessions.ts:56-88, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — Passkey registration/deletion are authorized by a mutable Vue `Date.now()` timer and then call Supabase Auth directly. The application does not use its server-side `verify_password` action to enforce the management window.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Move passkey add/delete behind a server action that verifies active super-admin status, a fresh token-bound step-up, and target ownership; do not use a client timer as authorization.

<a id="finding-2"></a>

### [2] Manual production deployments use the caller-selected Git ref without a trusted-branch gate

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | insecure-deployment-gate |
| CWE | CWE-284, CWE-829 |
| Affected lines | .github/workflows/deploy-supabase-target.yml:7-16, .github/workflows/deploy-supabase-target.yml:27-31, .github/workflows/deploy-supabase-target.yml:54-101, .github/workflows/deploy-supabase-functions.yml:7-21, .github/workflows/deploy-cloudflare-worker.yml:7-15, .github/workflows/manage-kill-switch.yml:7-9 |

#### Summary

Production-capable workflow dispatches check out the event-selected ref and deploy it with production credentials. `deploy-supabase-target.yml` selects production without a production environment declaration; sibling production deploy workflows also do not restrict manual dispatch to `main` in source.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at .github/workflows/deploy-supabase-target.yml:7-16, .github/workflows/deploy-supabase-target.yml:27-31, .github/workflows/deploy-supabase-target.yml:54-101, .github/workflows/deploy-supabase-functions.yml:7-21, .github/workflows/deploy-cloudflare-worker.yml:7-15, .github/workflows/manage-kill-switch.yml:7-9, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — Production-capable workflow dispatches check out the event-selected ref and deploy it with production credentials. `deploy-supabase-target.yml` selects production without a production environment declaration; sibling production deploy workflows also do not restrict manual dispatch to `main` in source.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

For production, require `github.ref == 'refs/heads/main'` or an explicit reviewed immutable SHA, add a protected production environment to `deploy-supabase-target.yml`, and require successful CI/security checks.

<a id="finding-3"></a>

### [3] Archived item and borrower list actions bypass account-session revocation and device binding

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | authorization-bypass |
| CWE | CWE-613, CWE-863 |
| Affected lines | supabase/functions/admin-item-mutate/index.ts:156-160, supabase/functions/admin-item-mutate/index.ts:205-252, supabase/functions/admin-item-mutate/index.ts:272-285, supabase/functions/admin-borrower-mutate/index.ts:499-504, supabase/functions/admin-borrower-mutate/index.ts:523-574, supabase/functions/admin-borrower-mutate/index.ts:594-607 |

#### Summary

Workspace-admin `list_deleted` actions are service-role reads excluded from the mutation guard. They require only a still-valid Supabase JWT, active workspace-admin profile, and workspace status, not the account-session/device revocation check used by privileged mutations.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at supabase/functions/admin-item-mutate/index.ts:156-160, supabase/functions/admin-item-mutate/index.ts:205-252, supabase/functions/admin-item-mutate/index.ts:272-285, supabase/functions/admin-borrower-mutate/index.ts:499-504, supabase/functions/admin-borrower-mutate/index.ts:523-574, supabase/functions/admin-borrower-mutate/index.ts:594-607, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Workspace-admin `list_deleted` actions are service-role reads excluded from the mutation guard. They require only a still-valid Supabase JWT, active workspace-admin profile, and workspace status, not the account-session/device revocation check used by privileged mutations.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Require device ID, `validateAccountDeviceSession`, rate limiting, and appropriate recent reauthentication for `list_deleted`.

<a id="finding-4"></a>

### [4] PostHog session replay captures sensitive authenticated/admin DOM text

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | sensitive-data-exposure |
| CWE | CWE-359, CWE-200 |
| Affected lines | src/services/posthogService.ts:85-119, src/bootstrap/clientMonitoring.ts:36-47, src/pages/super/SupportRequests.vue:55-105, src/pages/super/SupportRequests.vue:157-163 |

#### Summary

With analytics consent, PostHog session recording is explicitly enabled globally with only `maskAllInputs:true`; ordinary text on authenticated admin pages can include support requester emails, subjects, messages, assigned emails, and actor emails.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/services/posthogService.ts:85-119, src/bootstrap/clientMonitoring.ts:36-47, src/pages/super/SupportRequests.vue:55-105, src/pages/super/SupportRequests.vue:157-163, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — With analytics consent, PostHog session recording is explicitly enabled globally with only `maskAllInputs:true`; ordinary text on authenticated admin pages can include support requester emails, subjects, messages, assigned emails, and actor emails.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Disable PostHog recording on authenticated/admin routes or globally, or apply strict text masking/blocking to sensitive subtrees and separately disclose replay data sharing.

<a id="finding-5"></a>

### [5] Intercom JWT can be minted after profile disable/delete or custom session revocation

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | session-revocation-bypass |
| CWE | CWE-613, CWE-863 |
| Affected lines | supabase/functions/intercom-jwt/index.ts:68-92, supabase/functions/_shared/intercomJwt.ts:36-55, supabase/functions/_shared/accountSessions.ts:62-132 |

#### Summary

`intercom-jwt` validates only the Supabase access token before signing a 15-minute identity JWT; it does not check profile lifecycle, workspace status, or ItemTraxx account-session revocation.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at supabase/functions/intercom-jwt/index.ts:68-92, supabase/functions/_shared/intercomJwt.ts:36-55, supabase/functions/_shared/accountSessions.ts:62-132, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — `intercom-jwt` validates only the Supabase access token before signing a 15-minute identity JWT; it does not check profile lifecycle, workspace status, or ItemTraxx account-session revocation.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Before signing, require a current active/non-deleted profile and active workspace where applicable, and enforce the shared account-session revocation boundary.

<a id="finding-6"></a>

### [6] Super-admin security-session actions bypass server-enforced secondary authentication

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | missing-authentication-step |
| CWE | CWE-304, CWE-863 |
| Affected lines | supabase/functions/super-ops/index.ts:147-167, supabase/functions/super-ops/actions/securitySessions.ts:192-290, supabase/functions/super-ops/actions/securitySessions.ts:293-337, src/router/index.ts:742-755 |

#### Summary

`super-ops` exempts session/passkey metadata and revocation actions from `hasPrivilegedStepUp`; a valid primary super-admin token can therefore list or revoke same-account security state without the fresh factor required by other privileged paths.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at supabase/functions/super-ops/index.ts:147-167, supabase/functions/super-ops/actions/securitySessions.ts:192-290, supabase/functions/super-ops/actions/securitySessions.ts:293-337, src/router/index.ts:742-755, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — `super-ops` exempts session/passkey metadata and revocation actions from `hasPrivilegedStepUp`; a valid primary super-admin token can therefore list or revoke same-account security state without the fresh factor required by other privileged paths.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Require a server-recorded, token-bound privileged step-up for `list_sessions`, `list_passkeys`, `revoke_session`, and `revoke_all_sessions`; add endpoint tests for primary-token-without-step-up rejection.

<a id="finding-7"></a>

### [7] Privileged deployment workflows execute dependency lifecycle scripts

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | dependency-lifecycle-execution |
| CWE | CWE-829, CWE-494 |
| Affected lines | .github/workflows/deploy-cloudflare-worker.yml:68-75, .github/workflows/deploy-supabase-functions.yml:79-93, .github/workflows/manage-kill-switch.yml:68-69, .github/workflows/deploy-supabase-target.yml:94-101, package-lock.json:3356 |

#### Summary

Production deployment workflows run plain `npm ci`, executing lifecycle scripts from the locked dependency tree before deploying Supabase functions, the Worker, migrations, or kill-switch changes. CI already uses `npm ci --ignore-scripts`.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at .github/workflows/deploy-cloudflare-worker.yml:68-75, .github/workflows/deploy-supabase-functions.yml:79-93, .github/workflows/manage-kill-switch.yml:68-69, .github/workflows/deploy-supabase-target.yml:94-101, package-lock.json:3356, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Production deployment workflows run plain `npm ci`, executing lifecycle scripts from the locked dependency tree before deploying Supabase functions, the Worker, migrations, or kill-switch changes. CI already uses `npm ci --ignore-scripts`.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Use `npm ci --ignore-scripts` in deployment jobs and install only required trusted CLIs through separately pinned tooling, or isolate lifecycle execution in an unprivileged build job.

<a id="finding-8"></a>

### [8] Public system-status rate limiting fails open on limiter errors

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | resource-exhaustion |
| CWE | CWE-770, CWE-693 |
| Affected lines | supabase/functions/system-status/index.ts:180-198, supabase/functions/system-status/index.ts:209-253, supabase/functions/system-status/index.ts:298-345, cloudflare/edge-proxy/src/index.ts:141-170 |

#### Summary

Public `system-status` converts any prelogin rate-limiter error into `{ok:true}` and continues with service-role database probes and incident-provider work, removing the normal request bound during limiter degradation.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at supabase/functions/system-status/index.ts:180-198, supabase/functions/system-status/index.ts:209-253, supabase/functions/system-status/index.ts:298-345, cloudflare/edge-proxy/src/index.ts:141-170, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Public `system-status` converts any prelogin rate-limiter error into `{ok:true}` and continues with service-role database probes and incident-provider work, removing the normal request bound during limiter degradation.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Fail closed or use a bounded emergency fallback when the limiter is unavailable; add an edge-level limit/cache for `system-status`.

<a id="finding-9"></a>

### [9] Production Worker deployment is not gated on Worker typecheck or tests

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | insufficient-deployment-validation |
| CWE | CWE-693 |
| Affected lines | .github/workflows/deploy-cloudflare-worker.yml:46-75, .github/workflows/ci.yml:136-138 |

#### Summary

The production Worker deploy workflow installs dependencies and deploys on `push` to `main` or `workflow_dispatch`, but it does not require Worker validation or a successful CI job for the same commit.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at .github/workflows/deploy-cloudflare-worker.yml:46-75, .github/workflows/ci.yml:136-138, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Low** — The production Worker deploy workflow installs dependencies and deploys on `push` to `main` or `workflow_dispatch`, but it does not require Worker validation or a successful CI job for the same commit.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Make deployment depend on successful CI for the same commit, or run Worker typecheck/tests/security checks in the deploy workflow; require production approval for manual dispatch.

<a id="finding-10"></a>

### [10] Function routing fails open when `ALLOWED_FUNCTIONS` is empty

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | fail-open-configuration |
| CWE | CWE-693 |
| Affected lines | cloudflare/edge-proxy/src/index.ts:165-170, cloudflare/edge-proxy/wrangler.toml:21-31, cloudflare/edge-proxy/.dev.vars.example:1-8 |

#### Summary

The Worker enforces the function allowlist only when the parsed list is non-empty. A deployment that omits or clears `ALLOWED_FUNCTIONS` can proxy any single-segment function route, broadening the exposed surface even though the checked-in production config supplies a list.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at cloudflare/edge-proxy/src/index.ts:165-170, cloudflare/edge-proxy/wrangler.toml:21-31, cloudflare/edge-proxy/.dev.vars.example:1-8, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Low** — The Worker enforces the function allowlist only when the parsed list is non-empty. A deployment that omits or clears `ALLOWED_FUNCTIONS` can proxy any single-segment function route, broadening the exposed surface even though the checked-in production config supplies a list.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Reject missing/empty `ALLOWED_FUNCTIONS` at startup or return 503/404 for all function routes until an explicit allowlist is present.

<a id="finding-11"></a>

### [11] Error telemetry exports unsanitized request URLs, including query strings

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Confirmed by parent-led source review; provider-only uncertainty is documented in scope. |
| Category | sensitive-data-in-telemetry |
| CWE | CWE-532 |
| Affected lines | cloudflare/edge-proxy/src/observability.ts:79-125, cloudflare/edge-proxy/wrangler.toml:10-19 |

#### Summary

Worker exception and 5xx telemetry copies `request.url` verbatim into Sentry events while persistent invocation logs are enabled; sensitive query parameters reaching an error path can therefore be retained by observability systems.

#### Validation

Confirmed by parent-led source review; provider-only uncertainty is documented in scope. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at cloudflare/edge-proxy/src/observability.ts:79-125, cloudflare/edge-proxy/wrangler.toml:10-19, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Low** — Worker exception and 5xx telemetry copies `request.url` verbatim into Sentry events while persistent invocation logs are enabled; sensitive query parameters reaching an error path can therefore be retained by observability systems.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Send only method, pathname, status, and a redacted query allowlist; remove token-like keys and review log retention.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Supabase Edge Functions, shared auth/session helpers, and privileged service-role paths | authorization and session lifecycle | Reported | No additional canonical notes were recorded. |
| Super-admin router, security-session actions, passkey management, and step-up controls | privileged authentication | Reported | No additional canonical notes were recorded. |
| Vue client auth state, PostHog/Sentry/Intercom integrations, browser storage, and XSS/redirect sinks | privacy and client security | Reported | No additional canonical notes were recorded. |
| Cloudflare Worker routing, CORS, headers, cookies, ingress signing, observability, and configuration | edge boundary | Reported | No additional canonical notes were recorded. |
| Public system-status endpoint, rate limiting, provider calls, and fallback behavior | availability | Reported | No additional canonical notes were recorded. |
| GitHub Actions workflows, deployment refs, permissions, environments, and validation gates | CI/CD trust | Reported | No additional canonical notes were recorded. |
| package.json, package-lock.json, deno.lock, scripts, audit gate, and install lifecycle | supply chain | Reported | No additional canonical notes were recorded. |
| Current Supabase migrations, RLS policies, grants, and security-definer functions | database authorization | No issue found | No additional canonical notes were recorded. |
| Trusted ingress, CORS, Turnstile, bounded bodies, upload validation, and public forms | request validation | No issue found | No additional canonical notes were recorded. |
| Vue rendering, URL validation, redirects, token persistence, and offline queue scoping | browser attack surface | No issue found | No additional canonical notes were recorded. |
| Local npm audit, dependency tree, lock integrity, and static secret checks | dependency hygiene | No issue found | No additional canonical notes were recorded. |

## Open Questions And Follow Up

- Are GitHub production environment reviewers, branch restrictions, and repository write/dispatch permissions configured to compensate for the workflow gaps?
  - Follow-up prompt: Inspect GitHub environment protection and branch rules for production deployment workflows.
- Are Cloudflare/Supabase production secrets least-privilege and are provider-side rate limits/log retention configured?
  - Follow-up prompt: Verify provider dashboards and deployed configuration for token scope, route limits, and telemetry retention.
- Does deployed Supabase Auth impose a recent-auth requirement on passkey registration/deletion?
  - Follow-up prompt: Run an authorized staging test of direct passkey add/delete calls with and without a fresh server-side step-up.
