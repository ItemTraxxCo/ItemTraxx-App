# Security Review: itemtraxx-code

## Scope

Repository-wide final post-remediation static security verification of the current dirty Git worktree. All second-scan fixes, the broader manual workflow gate class, borrower workspace status handling, first-session bootstrap path, and JSON-null session handling were re-reviewed against current source and tests. The workspace-origin allowlist issue remains intentionally unchanged.

- Scan mode: repository
- Target kind: git_worktree
- Target ID: target_sha256_591171bac08b952ce256b32732587a67a6393132b20dc420eaba101387e12143
- Revision: f21c274ba27f791cdf00d282b6d2e2fedf898ccf
- Snapshot digest: codex-security-snapshot/v1:sha256:054d70da32cb83c0e8bafd03351083fb6beaed5d516f31ebb21f4cfd32cb4d98
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: Local source, unit, Worker, Deno, build, audit, and security-gate validation completed; provider and deployed-runtime state was not queried.
- Artifacts reviewed: SECURITY.md, package.json, package-lock.json, deno.lock, .env.example, src/, supabase/functions/, supabase/migrations/, supabase/sql/, supabase/config.toml, cloudflare/edge-proxy/, .github/workflows/, scripts/, vercel.json
- Scan context: Not CodeRabbit. Exact ALLOWED_ORIGINS and ITX_ALLOWED_ORIGINS lists exist, but workspace-origin handling intentionally remains unchanged.

Limitations and exclusions:
- TAC security-access connector was not connected.
- GitHub branch protections and environment reviewers, Cloudflare DNS/hosting and deployed variables, Supabase deployed configuration, provider dashboards, and production runtime were unavailable.
- The independent baseline worker did not return before the final draft; current-tree focused audits plus parent source review and validation were used.
- Excluded .git/: Git metadata and history are outside the source audit scope.
- Excluded node_modules/: Installed dependency trees are not authoritative; manifests and lockfiles were reviewed.
- Excluded dist/: Generated build output is not source of truth.
- Excluded artifacts/: Generated artifacts are not committed product source.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 1 |
| Severity mix | medium: 1 |
| Confidence mix | medium: 1 |
| Coverage | partial |
| Validation mode | Parent-led source trace with focused current-tree audits, regression tests, workflow YAML validation, typecheck/build, npm audit, and scripts/security-audit.sh. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

ItemTraxx is a multi-tenant Vue application using a Cloudflare Worker edge proxy, Supabase Edge Functions/Postgres/RLS, browser cookies, storage/email/telemetry integrations, and GitHub Actions.

### Assets

- tenant and workspace data
- role/session/revocation state
- browser session cookies
- support attachments
- provider and CI credentials
- deployment integrity

### Trust Boundaries

- browser to Cloudflare Worker
- Worker to Supabase APIs/functions
- service-role functions to Postgres/storage
- public forms to email/jobs
- GitHub workflow source to provider credentials

### Attacker Capabilities

- unauthenticated network client
- authenticated tenant or workspace account
- compromised or unprovisioned same-site origin
- GitHub workflow-dispatch/write actor
- dependency or lockfile compromise

### Security Objectives

- preserve tenant and role isolation
- enforce workspace lifecycle and session controls
- bound untrusted inputs
- protect credentials and sensitive data
- preserve deployment and edge trust boundaries

### Assumptions

- The reviewed target is the current dirty Git worktree represented by the registered snapshot.
- Active migrations and checked-in configuration define intended runtime behavior.
- Provider and deployed-runtime settings require separate verification.

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Wildcard workspace CORS trusts unprovisioned hosts while session cookies cover every subdomain](#finding-1) | medium | medium | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Wildcard workspace CORS trusts unprovisioned hosts while session cookies cover every subdomain

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | The bypass is directly visible in both helpers and the credentialed cookie/CORS configuration, while the external DNS/hosting condition remains unverified. |
| Category | cors-origin-validation |
| CWE | CWE-942 |
| Affected lines | cloudflare/edge-proxy/src/cors.ts:36-45, cloudflare/edge-proxy/src/cors.ts:51-68, supabase/functions/_shared/cors.ts:19-38, cloudflare/edge-proxy/src/index.ts:50-68, cloudflare/edge-proxy/src/constants.ts:12-18, cloudflare/edge-proxy/src/cookies.ts:64-67, cloudflare/edge-proxy/wrangler.toml:21-27, docs/workspace-model-rollout.md:35-37 |

#### Summary

The repository contains strict exact origin lists, but both the Cloudflare Worker and shared Supabase CORS helpers return true for any syntactically valid non-reserved \*.app.itemtraxx.com origin before consulting those lists. Credentialed CORS is enabled and session cookies can be scoped to .itemtraxx.com, so an unprovisioned or compromised accepted host can participate in a privileged browser trust boundary.

#### Root Cause

The intended invariant is that only active, operator-approved workspace origins receive credentialed CORS. The helper implements a syntax-only workspace-host shortcut that returns true before the configured exact list is checked, so the strict list and documented provisioning lifecycle do not govern those origins.

**Worker accepts any non-reserved workspace hostname** — `cloudflare/edge-proxy/src/cors.ts:36-45`

Syntax and a short reserved-slug list are treated as origin approval; membership in the configured exact list is not required.

```typescript
const isWorkspaceAppOrigin = (origin: string) => {
  const url = new URL(origin);
  const match = url.hostname.toLowerCase().match(
    /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.app\.itemtraxx\.com$/,
  );
  return url.protocol === "https:" && url.port === "" && !!match?.[1] &&
    !RESERVED_WORKSPACE_SLUGS.has(match[1]);
};
```

**Workspace branch returns before exact list comparison** — `cloudflare/edge-proxy/src/cors.ts:51-68`

The exact ALLOWED_ORIGINS array is consulted only after the workspace branch, so an unlisted workspace origin is accepted.

```typescript
if (isWorkspaceAppOrigin(origin)) {
  return true;
}

return allowedOrigins.some((candidate) => candidate === origin);
```

**Supabase shared helper mirrors the bypass** — `supabase/functions/_shared/cors.ts:32-38`

Supabase function CORS independently accepts the same unlisted workspace-origin pattern.

```typescript
if (!origin) return false;
if (isWorkspaceAppOrigin(origin)) return true;
return allowedOrigins.some((candidate) => candidate === origin);
```

**Strict list exists but is bypassed** — `cloudflare/edge-proxy/wrangler.toml:21-27`

The exact list exists, but the wildcard branch returns true before this configuration is compared.

```toml
ALLOWED_ORIGINS = "https://itemtraxx.com,https://www.itemtraxx.com,https://status.itemtraxx.com,https://internal.itemtraxx.com,https://app.itemtraxx.com,https://preview.itemtraxx.com,https://staging.itemtraxx.com"
SESSION_COOKIE_DOMAIN = ".itemtraxx.com"
```

#### Validation

Current source and tests confirm that https://new-workspace.app.itemtraxx.com is accepted with an empty allowlist by both helpers, while reserved, malformed, and attacker-suffix hosts are rejected. The exact production list is therefore not an effective control for the workspace-origin branch.

Validation method: static source trace plus focused local tests

#### Dataflow

attacker-controlled workspace host -\> Origin validation -\> credentialed Worker/Supabase response

- **Source:** browser request from an unlisted https://\<slug\>.app.itemtraxx.com origin

- **Sink:** credentialed CORS responses and session/API operations

- **Outcome:** accepted same-site origin can read or invoke responses using the victim's browser credentials

#### Reachability

The attacker needs control of a stale/unprovisioned workspace host or a compromise of content served there, plus a victim who visits it. The code establishes acceptance; external DNS/hosting control is the unresolved prerequisite.

- **Attacker:** attacker controlling or compromising an accepted workspace-origin host

- **Entry point:** browser API/session request carrying Origin https://\<slug\>.app.itemtraxx.com

- **Outcome:** credentialed cross-origin access within the Worker's allowed API surface

#### Severity

**Medium** — A compromised or unprovisioned same-site workspace host could receive credentialed cross-origin responses and invoke browser-session operations. Impact is meaningful, but exploitability depends on DNS/hosting and workspace-origin provisioning state that were not available locally.

Raise severity if arbitrary workspace subdomains resolve to attacker-controlled content or are provisioned without the documented lifecycle; lower it if deployed routing proves every accepted subdomain is operator-controlled and active.

#### Remediation

Make workspace origin approval data-driven and exact: require the origin to be present in the active provisioned-origin list, remove it on archive/purge, and keep DNS/hosting lifecycle synchronized. Prefer host-only __Host- cookies or a narrowly scoped handoff instead of Domain=.itemtraxx.com.

Tests:
- Assert an unlisted https://new-workspace.app.itemtraxx.com origin is rejected with an empty allowlist in both helpers.
- Assert archived or removed workspace origins are rejected after the provisioning list changes.
- Assert accepted credentialed session requests use a narrowly scoped cookie boundary.

Preventive controls:
- Review workspace-origin provisioning and removal together with Cloudflare DNS/hosting changes.
- Keep exact origin-list tests in CI for both Worker and Supabase helpers.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Worker and Supabase CORS, origin allowlists, and session-cookie scope | browser trust boundary | Reported | Finding 5 remains intentionally unchanged. |
| Deployment and secret-bearing GitHub workflows | CI/CD integrity | No issue found | All repository-local manual secret-bearing workflow paths now have a trusted-ref dependency; provider protections remain unverified. |
| Worker cookie and session-exchange parsing | availability and parser robustness | No issue found | Malformed cookie, body-limit, and JSON-null regressions pass. |
| Workspace lifecycle, admin action, borrower, and session bootstrap authorization | tenant isolation and lifecycle | No issue found | Fail-closed workspace resolution and service-role status lookup pass focused validation. |
| Frontend, Edge Functions, SQL/RLS, storage, email, and telemetry | application security | No issue found | No additional reportable source issue survived validation. |

## Open Questions And Follow Up

- Which workspace subdomains currently resolve to operator-controlled content, and is SESSION_COOKIE_DOMAIN deployed as .itemtraxx.com?
  - Follow-up prompt: Verify Cloudflare DNS/Pages/Worker routes and deployed vars, then rerun the origin/cookie boundary check against the active workspace inventory.
- Are GitHub workflow_dispatch refs, environment reviewers, and secret scopes configured to prevent branch-controlled secret execution?
  - Follow-up prompt: Inspect repository branch protections and environment rules for all secret-bearing manual workflows.
- Provider, deployment, DNS/hosting, GitHub protection, and production runtime state were unavailable.
  - Follow-up prompt: Review deferred unit provider-runtime-verification and close its stated proof gap. Paths: cloudflare/edge-proxy/, supabase/, .github/workflows/. Surfaces: provider-runtime.
