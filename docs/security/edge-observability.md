# ItemTraxx edge security observability

This change adds structured request/security events to the Cloudflare Worker
and all Supabase Edge Functions, durable server-owned audit rows for sensitive
reads and mutations, and deployable alert/WAF specifications.

## Event and audit flow

- Supabase functions register through `supabase/functions/_shared/serve.ts`.
  It records method, normalized route, request ID, query keys/value lengths,
  user agent, latency, status, safe error code, rejected field names, and
  fixed suspicious-input signatures. The Worker also inspects at most 8 KiB of
  JSON/form/text request bodies for safe field names and fixed signatures;
  attacker-provided values are never exported. It emits `edge_request` and
  categorized `security_event` PostHog events.
- The Cloudflare proxy emits the same `edge_request` and security categories
  for requests it handles before Supabase. Worker and Supabase events carry
  the same validated request ID so alert queries count one request across both
  layers.
- Cloudflare Workers Observability continues to forward structured console
  records through `itemtraxx-log-bridge`. Firewall Logpush records are
  normalized by the bridge; the bridge HMACs client IPs and sends non-allow
  actions to PostHog as `security_event` / `waf_action`.
- Audit rows are persisted in `public.security_audit_logs`. Database rows keep
  actor, workspace, target UUID, action, request ID, and database timestamp.
  PostHog receives only HMAC hashes for actor/workspace/target IDs.
- Targeted reads, including denied cross-workspace ID probes, are recorded
  against the authenticated actor's workspace. The signed audit request keeps
  IDs found in the upstream response separate from IDs present only in query
  filters. A cross-workspace ID in a filter is an attempted access; an ID
  found in the successful upstream response and verified by the server to
  belong to a different workspace is recorded as
  `confirmed_unauthorized_read`. Denied target UUIDs are kept only in the
  access-controlled audit table; the audit sidecar's 403 does not rewrite the
  original API response status. Session enumeration is included in the same
  distinct-target tripwire.
- Request bodies, query values, IP addresses, JWTs, cookies, passwords, and
  email addresses are never exported. Rejected-input snippets are fixed
  signatures such as `<script`, `union-select`, and `../`, never attacker text.

## Runtime configuration

Configure the same random `ITX_EDGE_PROXY_SHARED_SECRET` in the Cloudflare
edge-proxy Worker, Supabase Edge Function secrets, and log-bridge Worker. It
signs trusted Worker ingress and keys the shared IP/session/actor/resource
hashes. Configure the PostHog **project token**, never a personal API key, as
`ITX_POSTHOG_PROJECT_TOKEN` in the edge-proxy, Supabase, and log-bridge
Workers. The default event endpoint is
`https://us.i.posthog.com/i/v0/e/`; set each component's endpoint to the
project region if it differs. The capture endpoint is converted to PostHog's
batch endpoint by the code. Events use stable service distinct IDs and disable
person-profile processing.

Apply [the PostHog event schema and alert queries](posthog-security-alerts.json)
to `itemtraxx-web`. Save each HogQL query as an insight, then create an alert
with the threshold/evaluation mode in the JSON and attach the approved Slack
destination or authenticated webhook. Probe/auth alerts count unique request
IDs so the Worker and Supabase records do not double-count a request. The
enumeration alert has a direct SQL tripwire companion because a 60-second
window can expire between alert evaluations.

Apply [the Cloudflare WAF, rate-limit, and Logpush API payloads](cloudflare-security-config.json)
to the existing zone entrypoint rulesets. The custom ruleset must be executed
from the custom-firewall entrypoint; rate limits must be appended to the
existing `http_ratelimit` entrypoint. Logpush sends HTTPS POST requests to the
bridge's authenticated firewall Logpush route. Keep the raw `ClientIP` field
inside the authenticated bridge only; it hashes that value before PostHog.

For immediate critical paging, configure `INCIDENT_IO_SECURITY_WEBHOOK_URL`
and `INCIDENT_IO_SECURITY_API_KEY` as server-side secrets in both the Supabase
Edge Function environment and the Cloudflare edge-proxy Worker. The URL must
be HTTPS. The wrapper sends a bounded, non-blocking JSON POST with Bearer
authentication for SQLi/XSS signatures, denied cross-tenant target reads, and
the 16-distinct-target enumeration tripwire. The payload uses the supplied
incident.io webhook endpoint, a stable route-based deduplication key, a keyed
client IP hash, and a keyed actor identifier; raw IPs, actor UUIDs, tokens, and
request bodies are not sent. Missing or unavailable paging configuration
does not affect the client response. Each alert includes `request_id`,
`http_status` (or the literal `unknown`), `outcome`, and
`exploitation_status` in metadata, with visible `Exploitation Status` and
`Security Outcome` lines in its description. Suspicious SQLi/XSS signatures
paired with 2xx are `SUSPECTED SUCCESS`, never confirmed by status alone. A
400/401/403/422/429 rejection is `BLOCKED` at the observed layer. A cross-workspace target
merely requested is an attempt; `CONFIRMED UNAUTHORIZED ACCESS` requires the
target ID to have appeared in the successful upstream response and to fail the
actor-workspace check. Enumeration-only tripwires remain undetermined. The
stable deduplication key is preserved for follow-up updates. Configure the
endpoint to accept `title`, `description`, `deduplication_key`, `status`,
`severity`, and `metadata` JSON fields.

Run migrations `20261102110000_security_audit_logs.sql` and
`20261102120000_count_confirmed_unauthorized_reads_in_tripwire.sql` before
deploying the Edge Functions. The Supabase `security-audit` function has platform JWT
verification disabled because it validates Better Auth JWTs internally and
requires the signed Worker-ingress headers.

`security-audit` is Worker-internal. Its payload (item IDs, returned IDs,
upstream status) is evidence only the Worker can observe, so the function must
be able to tell a Worker-authored audit from a request a signed-in user relayed
through the function proxy. Three controls enforce that:

- The Worker signs its audit call with the trusted-ingress target
  `security-audit:internal` (`SECURITY_AUDIT_INGRESS_TARGET` in
  `supabase/functions/_shared/securityAuditIngress.ts`, imported by both
  runtimes). The function accepts only that target. The generic function proxy
  signs with the routed function name, so a relayed request fails with 403.
- `security-audit` is not listed in the Worker's `ALLOWED_FUNCTIONS`.
- `isInternalOnlyFunction` in `cloudflare/edge-proxy/src/routing.ts` refuses the
  name before the allowlist is read, so a dashboard-side `ALLOWED_FUNCTIONS`
  value that drifts from `wrangler.toml` cannot re-expose it.

The Worker and the Edge Function deploy through separate pipelines. A change to
the signing target must land in both; while only one side is deployed, audit
writes are rejected and logged as `security_audit.proxy_write_failed` (reads are
unaffected, but audit rows for that window are not written).

`job-worker` is likewise not routed through the Worker. The scheduled workflow
calls it directly on the Supabase functions host with `ITX_JOB_WORKER_SECRET`.

## Verification

Run the focused tests from the repository root:

```sh
npm run security:verify

deno test --allow-env --allow-net \
  supabase/functions/_shared/observability_test.ts \
  supabase/functions/_shared/securityAudit_test.ts \
  supabase/functions/admin-ops/actions/sessions_test.ts \
  supabase/functions/admin-ops/actions/statusTracking_test.ts

cd cloudflare/edge-proxy
deno test --no-check --allow-env --allow-net \
  src/observability_test.ts src/supabaseApiProxy_test.ts
npm run typecheck
```

`security:verify` exercises both wrappers, the Worker rate-limit helper, the
configured authentication alert threshold, and mocked PostHog/incident.io
receivers. It has no network permission. The `x-test-simulation: true` marker
is exported as `attack_type: "simulation"` only when `ITX_ENVIRONMENT=test`;
it does not change authorization, validation, or rate-limit decisions.

To check the shared Supabase code and targeted handlers independently, run
`deno check --node-modules-dir=auto` against their `_shared` modules and
`security-audit`/`admin-ops` entrypoints.

For an end-to-end staging check, use a disposable tenant and test identity:

1. Send a rejected `admin-ops` request with an invalid action and a benign
   `x-request-id` UUID. Confirm an `edge_request` with 4xx status, latency,
   route, request ID, and `validation_failure` event.
2. Send an encoded `<script>` query to the staging item route. Confirm only the
   marker name and fixed `<script` signature appear, with no query value,
   bearer token, or raw client IP.
3. Make 11 unauthorized staging requests from one test client in two minutes;
   confirm the auth alert crosses `> 10` once per distinct request ID.
4. Read 16 distinct item IDs through the targeted PostgREST `id` filter within
   60 seconds. Include a disposable out-of-workspace UUID to exercise the IDOR
   path. Confirm denied targets are logged only to the audit table, the
   original request's `request_id` is preserved, and the PostHog stream emits
   the `enumeration_tripwire`/`auth_forbidden` events.
5. Review the Cloudflare firewall Logpush route with one blocked test event and
   one allowed event. Confirm the bridge forwards only the blocked action and
   PostHog receives an HMAC IP hash with no raw IP.
6. Simulate the 5xx insight against test data before enabling its alert. Do not
   generate artificial 5xx traffic on production.

Live Cloudflare rules, PostHog alerts/destinations, Supabase migration, and
Worker/function deployments are not applied by this source/configuration
change; follow the staged setup above after reviewing the concrete payloads.
