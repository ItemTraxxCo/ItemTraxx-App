# ItemTraxx Legal Architecture Blueprint

**Basis:** code, config, migrations, CI, and read-only production metadata as of 2026-11-04 (branch `dev/mmango10`). Existing legal markdown (PRIVACY.md, DPA.md, TERMS.md, LEGAL.md, SECURITY.md, STUDENT_PRIVACY.md) was deliberately **not** read or relied on.

**Not legal advice.** This is an engineering-grounded drafting map. Statutory citations reflect my understanding as of the audit date; have California counsel confirm each before it goes into a signed document (SB 446's 2026 breach-timing changes and the 2025 COPPA amendments are the ones most worth double-checking).

**Evidence convention:** `file:line` = verified in working tree. "PROD" = read-only query of the production Supabase project (metadata only, no customer content read). "UNVERIFIED" = could not confirm from code; needs a human check.

---

## 0. Plain-English summary (what this means for us)

1. **ItemTraxx is a school-records processor.** Schools (and a few individuals) put borrower records and checkout history into our system. In law that makes us a "school official / service provider / operator" holding student information on behalf of schools. Our paper has to say that in the exact words California school districts expect (Ed. Code § 49073.1, SOPIPA, FERPA 34 CFR 99.31(a)(1)).
2. **The data is pseudonymous, not anonymous.** Borrower records default to randomly generated codenames and IDs (e.g. `TideFox481` / `4821KQ`), but workspace admins can type any 4–40 character value, including a real name or school ID, and CSV-import them. The school holds the roster that links codename to child. Treat all of it as student personal information.
3. **Our real subprocessor list is longer than the product surface suggests.** I found vendors that receive data from servers, CI, and an auth plugin, not just from the browser. At least one (Better Auth's hosted "Infra" services) is invisible in the CSP and package-level review. A DPA with an incomplete subprocessor list is a breach of the DPA on day one.
4. **Biggest immediate exposures:** (a) Intercom loads for every visitor with no cookie consent gate; (b) the deletion/retention story we can promise is narrower than what the code actually does; (c) there is no durable record of who accepted which Terms/DPA version in the current migration chain; (d) undisclosed or unconfirmed subprocessors.
5. **Production is not empty:** PROD has 10 workspaces and 230 borrower rows. If these are all demo/test, say so in writing; if any are real schools, DPA obligations are already live.

---

## 0.1 Phase A implementation status (2026-11-04, uncommitted on `dev/mmango10`)

| Gap | Status | What changed |
|---|---|---|
| G1 Intercom | **Code done (disclosure model)** | Support chat is classified and disclosed as an essential support service, so it is not behind a consent gate. It is lazy-loaded: signed-in sessions boot immediately with the signed JWT; anonymous visitors boot app-id-only about 1.5 seconds after the page is idle (`requestIdleCallback`, 3 s timeout), and only after auth has finished initializing. The service is a dynamic import, out of the initial bundle. The Cookies Notice and cookie banner disclose it; the new Privacy Policy and Cookie Notice must say the same. |
| G10 Google Fonts | **Code done** | Inter bundled via `@fontsource/inter` (latin 400-800); Google hosts removed from `index.html` and the CSP. |
| G11 GitHub version check | **Code done** | Browser reads first-party `/version.json` emitted by the Vite build; `api.github.com` removed from HTML hints and CSP `connect-src`. |
| G5 Borrower purge FK | **Migration written, not applied** | `20261104120000_preserve_item_history_on_borrower_purge.sql`: `item_logs.checked_out_by` nullable + `ON DELETE SET NULL`; `run_data_retention()` isolates each step and reports errors. |
| G6 Workspace deletion | **Code + migration written, not applied** | `20261104130000_workspace_purge_executor.sql` + `job-worker/workspacePurge.ts`. Correction to the original audit: no hard-delete path existed at all (the deletes in `super-workspace-mutate` are only create-failure rollbacks). |
| G3 Legal assent | **Code + migration written, not applied** | `20261104140000_legal_acceptance_audit_trail.sql`, `legal-acceptance` edge function, client service + composable. Correction: `legal_acceptances` does exist in production (0 rows) but was outside the migration chain. **No document is acceptable until rows are inserted into `legal_document_versions`**, and no UI prompt is mounted yet. |

Decisions you should know about: `security_audit_logs` foreign keys were dropped so workspace deletion is possible (rows stay as uuid-only records); `ip_address` is stored raw (as requested) alongside the legacy `ip_hash` column; acceptance rows keep their evidence when an account is deleted (identity links become NULL).

---

## 1. High-level architecture and data-flow summary

### 1.1 What we process, and for whom

| Data subject | Fields (source) | Direct identifier? | Our role |
|---|---|---|---|
| **Borrowers** (students/staff who borrow equipment) | `borrowers.username` (generated codename or admin-supplied, ≤40 chars), `borrower_id` (generated `4 digits + 2 letters` or admin-supplied), `access_mode`, soft-delete timestamps. Table renamed from `students` (`supabase/migrations/20260725221011_item_borrower_physical_rename.sql`; generator at `supabase/functions/admin-borrower-mutate/index.ts:261-272`, manual/CSV paths at `:621-657`, `:703-790`) | **No by default; yes if the school enters real names/IDs.** No email, DOB, grade, or photo columns exist. | Processor / school-official vendor |
| **Checkout history** | `item_logs` (borrower↔item↔time↔performing admin), `item_status_history`, `admin_audit_logs` (metadata jsonb) | Linked to borrower pseudonym | Processor |
| **Workspace staff** (admins, tenant accounts) | `profiles.auth_email`, role, `is_active`; Better Auth `user`/`account`/`session` (`ipAddress`, `userAgent` columns, `20260907210000_better_auth_foundation.sql:17`), passkeys, TOTP, SSO provider config | **Yes** (email, IP, device) | Processor for the school's staff accounts; **controller/business** for our own account security, abuse prevention, billing contact |
| **Device sessions** | `account_sessions`: `device_id`, `device_label`, `user_agent`, `login_method`, `login_location`, `general_location` (CF-derived coarse geo), token hash | Yes (device/behavioral) | Controller-ish (security) |
| **Individual accounts** | `20260919120000_individual_accounts.sql` – single-user plan, `account_category` | Yes | Controller (consumer-facing); different rules (see § 4.4) |
| **Sales/demo leads** | `sales_leads`: name, organization, `reply_email`, details, `ip_hash`, `user_agent`; `customer_status_logs` (invoice IDs/status) | Yes | Controller |
| **Support requests** | `support_requests` + private bucket `support-request-attachments` (PNG/JPG/WEBP/GIF, ≤2 files; `contact-support-submit/index.ts:182,364`) | Yes; **attachments are screenshots and may contain student data** | Processor when sent from inside a workspace; controller otherwise |
| **Consent records** | `cookie_consent_records`: random `subject_id`, `profile_id`, analytics/diagnostics booleans, timestamps (no IP) | Pseudonymous | Controller |
| **Error reports** | `client_error_reports`: stack, page URL, UA, `ip_hash`, `workspace_id`, `auth_role`, diagnostics blob | Pseudonymous | Controller |
| **Security telemetry** | `security_audit_logs`, HMAC'd client-IP and session hashes, request IDs (`supabase/functions/_shared/observability.ts:176-199`) | Pseudonymous (keyed hash; we hold the key) | Controller |
| **Org branding** | Workspace logos in private R2 bucket `ORGANIZATION_LOGOS` (`cloudflare/edge-proxy/wrangler.toml`) | No | Processor |

### 1.2 What does *not* exist (good facts to state in policies, because they are verified)

- **No image capture.** The camera scanner draws video frames to an off-screen canvas for barcode detection only; no `toDataURL`/`toBlob`/upload path and tracks are stopped on close (`src/composables/useCameraBarcodeScanner.ts:199,223,270,512-542`). `Permissions-Policy: camera=(self), microphone=(), geolocation=()` (`vercel.json`).
- **No student logins.** Borrowers never authenticate; staff operate the kiosk on their behalf. This sharply limits COPPA "direct collection from children" exposure.
- **No ads, no marketing pixels, no data sale/sharing.** No Meta/Google Ads/LinkedIn/Hotjar/Mixpanel/Stripe in code. PostHog is configured with `save_campaign_params: false`, `save_referrer: false`, autocapture off, surveys/web-experiments/flags off (`src/services/posthogService.ts:584-693`).
- **No payments processed in-app.** Billing is quote → invoice (`sales_leads.stage`); no card data. (Which accounting/invoicing tool issues invoices is outside the repo: UNVERIFIED.)
- **Offline data is encrypted at rest in the browser.** AES-GCM 256, key in IndexedDB (`src/services/offlineCheckoutQueue.ts:52-60,375-470`, `offlineCheckoutWorkflow.ts:126-269`). Server side, offline packs hard-expire at ≤24h (`20260728190902_offline_checkout_mvp_server.sql`, `20260920102000_enforce_offline_pack_expiry.sql`); expired pack rows purged after 7 days (`20261004100000_…sql`). The server stores only item state per pack, not borrower names.

### 1.3 Where the data lives and who holds it (system of record + copies)

```
Browser (Vue SPA on Vercel; Cloudflare in front)
  ├─ itemtraxx.com / *.itemtraxx.com  → Vercel (static host; Analytics + Speed Insights)
  ├─ /functions, /auth, /rest, /rpc   → Cloudflare Worker "edge-proxy" (edge.itemtraxx.com)
  │     ├─ Better Auth (sessions, passkeys, TOTP, SSO/SAML, org, JWT issuer)
  │     │     └─ @better-auth/infra  sentinel() + dash()  → Better Auth Inc (kv.better-auth.com / dash)
  │     ├─ Cloudflare KV (maintenance fallback), R2 (logos), Rate Limiters, Turnstile (CAPTCHA)
  │     ├─ Resend (invitation, email-change, password-reset mail)
  │     ├─ PostHog US (server-side event capture, us.i.posthog.com)
  │     └─ incident.io (security paging; HMAC'd IP/actor only)
  └─ Supabase (Postgres + Edge Functions + Storage, project ref mlaspkufocikfcbjgpof)
        ├─ Resend (login-notify, sales/support confirmation + internal mail, delivery logs)
        ├─ Slack incoming webhooks (client-error reports; sales/support alerts)
        ├─ PostHog (OTel logs/traces/events)
        └─ pg_cron: retention jobs (PROD)
Browser-direct (consent-gated unless noted):
  PostHog via first-party proxy j.itemtraxx.com (US cloud) — replay needs analytics AND diagnostics consent
  Intercom (messenger, widget CDN, websockets) — NOT consent-gated (see Gap G1)
  Google Fonts (fonts.googleapis.com / gstatic) — loaded from index.html:15-28 for every visitor
  GitHub REST (api.github.com) — version check, src/composables/useAppVersionStatus.ts:4
Back office / CI (no customer content intended; see § 2):
  GitHub Actions, Slack (CI status), incident.io (alerts), Aikido (SAST/SCA), NVIDIA NIM (Strix pentest LLM),
  GCP VM + itemtraxx-backups repo (backups), Infisical (self-hosted secrets), Linear (work tracking; no code reference)
```

---

## 2. Third-party data-flow catalog (what each vendor receives)

Confidence: **V** verified in code, **P** inferred from vendor behavior / config, **U** unverified.

| # | Vendor | Role | Data that reaches them | Trigger / consent | Conf. |
|---|---|---|---|---|---|
| 1 | **Supabase** (US region per project; confirm) | Core processor: Postgres, Auth-adjacent RPC, Edge Functions, Storage | Everything in § 1.1 | Always | V |
| 2 | **Cloudflare** | Edge proxy/WAF/CDN/DNS, Workers Logs (invocation logs 100% sampled, persisted), KV, R2, Turnstile, rate limiting, SaaS app launcher (SSO) | All request metadata (IP, UA, URL, headers), proxied bodies in transit, logo files, Turnstile tokens + IP/UA | Always. `[observability] persist = true, head_sampling_rate = 1` | V |
| 3 | **Vercel** | Static hosting, rewrites, Web Analytics + Speed Insights (cookieless), CI deploy | IP, UA, URL, Web Vitals for every page view | Always (verify whether Analytics is behind consent: UNVERIFIED) | V/U |
| 4 | **PostHog Cloud US** (first-party domain `j.itemtraxx.com`) | Analytics, error tracking, replay, logs; also server telemetry | Browser: pageviews (history_change), `identify(user_id, {role})`, exceptions (scrubbed), replay (inputs masked, text masked only where `data-session-replay-mask` is set), `ph_*` cookie shared across `.itemtraxx.com` (1 yr). Server: route, method, status, request ID, HMAC'd IP + session hash, UA (`observability.ts:176-199`) | Browser: **opt-in** (analytics; diagnostics; replay needs both) (`cookieConsentService.ts:184-190`). Server telemetry: **always, no consent** | V |
| 5 | **Intercom** | Support messenger | Anonymous: Intercom cookie/device ID, page context, IP, UA. Signed-in: `user_id` + **email** via signed JWT (`intercomService.ts:53-65`, `_shared/intercomJwt.ts`) | **No consent check** (`useIntercom.ts:11-31`, `App.vue:247`) | V |
| 6 | **Resend** | Transactional + sales/support email | Recipient email, names, invite/reset links, org name, sales form content (name, reply email, free-text details); delivery logs in our `email_delivery_logs` | Always when triggered | V |
| 7 | **Slack** (incoming webhooks) | Ops alerting | Client error report summary (error name, env, release, role, workspace UUID, request ID); sales/support alerts (see `contact-sales-submit` / `contact-support-submit`; confirm whether free-text and email are included: U) | Always | V/U |
| 8 | **Better Auth Inc – `@better-auth/infra`** | `sentinel()` (abuse/credential-stuffing/bot checks) and `dash()` (admin dashboard + analytics) on the auth Worker (`cloudflare/edge-proxy/src/auth.ts:7,849,944`). Package calls `kv.better-auth.com` / `dash.better-auth.com`. | **P:** sign-in/sign-up events with email, IP, UA, device fingerprint headers; user/session/org objects for dash. Exact fields must be confirmed against vendor docs/DPA. | Always for `sentinel` (`BETTER_AUTH_API_KEY` presence in PROD: U); `dash` only if key set | V (call-out), P (payload) |
| 9 | **Cloudflare Turnstile** | CAPTCHA on sign-in/reset (`auth.ts` captcha plugin; `20261008120000_enforce_turnstile_token_single_use.sql`) | IP, UA, browser signals | Always on those flows | V |
| 10 | **Google (Fonts)** | Font CDN | Visitor IP + UA to Google on every page load | Always (`index.html:15-28`) | V |
| 11 | **GitHub** | Browser version check (`api.github.com/repos/ItemTraxxCo/ItemTraxx-App/commits/main`); also source + CI | Visitor IP to GitHub | Always when the check runs | V |
| 12 | **incident.io** | Security/uptime paging (`observability.ts` `emitIncidentIoSecurityPage`) | Attack type, route, request ID, HMAC'd IP, hashed actor ID | Event-driven | V |
| 13 | **Aikido Security** | SAST/SCA/secrets scanning | Source code + dependency manifests (CI/MCP). No production data intended | CI | V (use), U (data scope) |
| 14 | **NVIDIA NIM** (Strix AI pentest in CI) | LLM inference for security testing (`.github/workflows/strix-security.yml`) | Source/targets + probe traffic to the app under test. **Must never be pointed at production data** | CI | V |
| 15 | **GCP VM / itemtraxx-backups** | Backups | Database backups (full customer data) | Scheduled | U (not in this repo; confirm region, encryption, retention) |
| 16 | **Infisical (self-hosted)** | Secrets | Credentials only | n/a | per AGENTS.md |
| 17 | **Linear** | Issue tracking | No code reference; engineering metadata only. Do **not** list as a customer-data subprocessor unless tickets include customer data | n/a | V (absence) |
| 18 | **Cloudflare Access / SaaS App Launcher** | SSO IdP-initiated flow (`auth.ts` saml block) | Staff identity assertions | When customer uses it | V |

Customer-supplied IdPs (Google Workspace, Entra ID, Okta, etc.) for SSO are **customer** vendors, not our subprocessors, but we process their assertions (email, name, groups).

---

## 3. Flagged compliance gaps and high-risk conflicts

Severity: **Critical** = fix before next school signs; **High** = fix before DPA goes out; **Medium** = fix this quarter.

| ID | Sev | Finding (plain English first) | Evidence | Legal hook | Fix |
|---|---|---|---|---|---|
| **G1** | **Critical** | **Intercom runs on every visit with no opt-in.** Anonymous visitors get Intercom's cookies/device ID and a third-party connection; signed-in admins send email + user ID to Intercom. Our own cookie logic only gates PostHog. A privacy notice that claims "optional cookies only after consent" would be false. | `src/composables/useIntercom.ts:11-31`; `src/App.vue:247`; consent predicates only in `cookieConsentService.ts:184-190`; CSP allows Intercom (`vercel.json`) | CalOPPA § 22575; CCPA notice at collection; Cal. Penal Code §§ 631/638.51 (CIPA) wiretap/trap-and-trace claims are the live litigation risk for third-party chat/replay tools; ePrivacy-style expectations for EU visitors | Gate Intercom behind a "support/functional" consent category or load it only after the user clicks "Help"; document under Cookie Notice either way |
| **G2** | **Critical** | **Subprocessor list incompleteness.** Better Auth Infra (sentinel/dash), Slack webhooks, Resend, Google Fonts, GitHub, NVIDIA NIM, backups VM are not obviously surfaced anywhere customers see. A DPA that lists only Supabase/Cloudflare/Vercel/PostHog is inaccurate. | `auth.ts:7,849,944`; `client-error-report/index.ts:118`; `accountEmailDelivery.ts:78`; `index.html:15-28` | FERPA 99.31(a)(1)(i)(B); Cal. Ed. Code § 49073.1; Illinois SOPPA (public subprocessor list); NDPA Exhibit | Publish a complete subprocessor directory (§ 5, Doc 12). Decide per vendor: keep, remove, or add DPA. Strongly consider removing `sentinel`/`dash` or confirming zero student data and signing Better Auth's DPA |
| **G3** | **High** | **No durable acceptance record in the current schema.** Code references `CURRENT_TERMS_VERSION = "2026-06-11"` and a student-privacy attestation context, but no `legal_acceptances`/`terms_accepted` table exists in `supabase/migrations`; the only definition is in `supabase/archive/sql-legacy/legal_acceptances.sql`. If prod lacks it, we cannot prove assent to the new suite. | `supabase/functions/_shared/studentPrivacy.ts:1-16`; grep of migrations: none; archive file present. PROD table existence: UNVERIFIED | Contract formation; DPA enforceability; FERPA "direct control" evidence | Add a migration for `legal_acceptances` (doc, version, hash, actor, workspace, IP-hash, timestamp); re-prompt on version bump |
| **G4** | **High** | **Retention promises vs. reality.** Real: nightly `run_data_retention` at 03:30 UTC (PROD, succeeding); soft-deleted borrowers purged after 365 d, items 730 d, admin audit 730 d, super-admin audit 1,095 d (PROD policy rows); anonymous consent 730 d; invitations/email-change 30 d after expiry; offline packs 7 d after expiry. **Not covered by any scheduled purge I can find:** `item_logs` (the borrower↔item history), `security_audit_logs`, `account_sessions`, `client_error_reports`, `email_delivery_logs`, `support_requests` + attachments, `sales_leads`, Better Auth session/verification rows, PostHog/Intercom/Slack/Resend copies, backups. | `20260725221011_…sql:287-344`; PROD `cron.job`; absent: grep for purge on those tables | CA Ed. Code § 49073.1(b)(7) (no retention after contract end); SOPIPA deletion on request; COPPA 2025 amendment written retention policy; CCPA retention disclosure | Define one retention schedule (§ 5, Doc 11) and add the missing purges, or state the true periods |
| **G5** | **High** | **Latent failure in borrower purge.** `item_logs.checked_out_by` references `borrowers(id)` with no ON DELETE rule (NO ACTION). The first time a soft-deleted borrower with any history hits 365 days, `DELETE FROM borrowers` will raise an FK error and abort the **entire** `run_data_retention()` call, so audit-log purges stop too. Nothing has aged out yet (PROD runs succeed), so this is invisible today. | PROD FK list (`item_logs → borrowers`, confdeltype `a`); function body `20260725221011_…sql:308-334` runs all deletes in one transaction | Retention/erasure promises become false silently | Decide semantics: anonymize logs (set `checked_out_by` null / tombstone) or cascade-delete; wrap each purge step in its own exception block |
| **G6** | **High** | **No automated workspace-deletion executor.** Archiving sets `purge_after = +30 days`, `purge_state = 'grace'`, but only a manual super-admin hard delete exists; nothing flips `grace→purged` on schedule. Contract-end deletion SLAs ("within 30/60 days") cannot be met by design. Backups and vendor copies are unaddressed. | `super-workspace-mutate/index.ts:278-285,664-671` set state; deletes at `:362-418,584` are manual paths; no cron for `purge_after` | § 49073.1 certification of non-retention; DPA return/deletion clause | Add a scheduled purge job + deletion certificate; document backup roll-off |
| **G7** | **High** | **Pseudonymization is a convention, not a control.** Admin- and CSV-supplied usernames/IDs accept arbitrary text; no UI or server guard prevents real names/student numbers. Replay masking is allowlist-based (`data-session-replay-mask` on chosen elements), so any new borrower-bearing UI that forgets the attribute leaks to PostHog replay. A coverage spec exists (`sessionReplayMaskCoverage.spec.ts`) and the borrower views I checked are masked (`Logs.vue:91`, `Borrowers.vue:16`, scanner overlays), so this is a process risk, not a current leak. | `admin-borrower-mutate/index.ts:621-657,703-790`; `posthogService.ts:669-686` | FERPA/§ 49073.1 "pupil records" definition covers anything linkable; SOPIPA "covered information" | Contract: schools must not enter more identity than needed; Product: add helper text, server-side warning on name-like patterns; consider default-mask (`maskAllText`) for replay |
| **G8** | **High** | **Server-side telemetry has no opt-out.** Edge/Worker/PostHog/incident.io telemetry (HMAC'd IP, session hash, UA, route, request IDs) is sent regardless of cookie choices. That is defensible as security logging, but it must be disclosed as such and not described as "only with consent." Keyed hashes are still personal data. | `observability.ts:176-199`; `wrangler.toml` `ITX_LOG_SUCCESS_SAMPLE_RATE = "1"`, `ITX_OTEL_TRACE_SAMPLE_RATE = "1"` | CCPA/CPRA notice at collection; "security/integrity" purpose limitation | Disclose; define retention for PostHog/Workers Logs; keep PII out of log bodies |
| **G9** | **Medium** | **Consent cookie and PostHog cookies are cross-subdomain for 1 year**, including on customer workspace subdomains (`*.app.itemtraxx.com`). Students are not users, but staff on school devices share browsers with students. Replay (when both consents given) records staff screens that show borrower names unless masked. | `cookieConsentService.ts:14,23-30`; `posthogService.ts:600` | CIPA; school-device context | Default replay off for workspace roles; scope consent per-role |
| **G10** | **Medium** | **Google Fonts from Google's CDN for every visitor.** Transfers visitor IP to Google without consent; EU courts have ordered damages for this. Trivial to self-host. | `index.html:15-28` | GDPR/ePrivacy (if any EU visitors); CalOPPA disclosure | Self-host Inter; remove `fonts.googleapis.com` from CSP |
| **G11** | **Medium** | **Browser calls GitHub API** to compare versions, leaking visitor IPs to GitHub and tying our product to a public repo URL. | `useAppVersionStatus.ts:4` | Disclosure only | Serve version from own `/version.json` |
| **G12** | **Medium** | **Support attachments may contain student data** (screenshots) and sit in a private bucket with no stated retention; ticket text flows to email + Slack. | `contact-support-submit/index.ts:182,364-460` | § 49073.1; SOPIPA | Attachment retention (e.g., 90 d after close); warning text "do not include student information" |
| **G13** | **Medium** | **Security reporting channel is thin.** `security.txt` exists (`public/.well-known/security.txt`, expires 2027-03-12) and `/report-security-issue` route exists, but a VDP with **safe harbor** is a separate legal instrument; "Policy:" points to `/legal`. | `public/.well-known/security.txt`; `router/index.ts:171-178` | DOJ CFAA policy; DMCA § 1201 exemption; Cal. Penal Code § 502 | Standalone VDP with explicit authorization language (Doc 5) |
| **G14** | **Medium** | **Prod data present.** 10 workspaces, 230 borrowers (PROD counts only). Your standing note says "no real customer data"; if any are real schools, DPA/privacy commitments are already binding. | PROD counts | All of Tier 2 | Confirm which workspaces are real; paper them first |
| **G15** | **Info** | **Breach-notice readiness is strong technically** (security audit logs, incident outcome classification "attempted vs successful," incident.io paging) but the *legal* playbook (who decides, 72-hour customer notice, AG filing) is not in code. | `security_audit_logs` migration; `incidentOutcome.ts` | Cal. Civ. Code § 1798.82 | Doc 9 (IRP) |

**Positive controls worth citing in the security addendum (all verified):** HSTS preload, CSP with `frame-ancestors 'none'`, COOP same-origin, XFO DENY (`vercel.json`); Better Auth 7-day sessions, 12-char minimum passwords, passkeys, TOTP, SAML/OIDC SSO with domain verification, ES256 JWTs 5 min (`auth.ts:578-586,834-935`); host-only session cookies, `cf-connecting-ip` trust (`auth.ts:621-627`); Turnstile single-use tokens; RLS enabled across 30 table migrations with 69 policies and a least-privilege PostgREST surface (`20260726120000_…sql`), service-role-only mutation paths; privileged step-up for super admins; kill switch; rate limits on public routes (`wrangler.toml`); offline queue encryption.

---

## 4. Legal requirements analysis

### 4.1 California – general privacy

- **CCPA/CPRA (Civ. Code § 1798.100 et seq.).** Applies to a "business" meeting a threshold (≈ $25M-class revenue, 100k+ consumers/households, or ≥50% revenue from selling/sharing). **ItemTraxx likely does not meet any threshold today**, and public school districts are government bodies outside "business." Still draft CCPA-ready language because (i) private/charter schools and later enterprise customers will ask, (ii) you will cross thresholds, (iii) it costs little. Required content when it applies: notice at collection (categories, purposes, retention), rights (know, delete, correct, limit, opt-out of sale/share), no sale/share statement (true today: no ads/pixels), service-provider contract terms (§ 1798.140(ag), § 1798.100(d)), and "Do Not Sell/Share" mechanics if PostHog/Intercom ever count as "sharing."
- **CalOPPA (Bus. & Prof. Code §§ 22575–22579).** Applies to any commercial site collecting PII from California consumers. Privacy policy must be conspicuous, list categories collected, third parties, how users review/correct, effective date, and **disclose how you respond to Do Not Track**. Applies to us now.
- **Reasonable security (Civ. Code § 1798.81.5)** and **data-destruction (§ 1798.81)** apply to any business holding California residents' personal information, including as processor.
- **Breach notification (Civ. Code § 1798.82).** Notify affected California residents "in the most expedient time possible and without unreasonable delay." **As amended by SB 446 (effective Jan 1, 2026), individual notice is due within 30 calendar days of discovery, and if >500 California residents are affected a sample copy goes to the Attorney General within 15 days of notifying individuals** (counsel to confirm). § 1798.82(b): a business that **maintains but does not own** the data (our posture for school data) must notify the **owner/licensee immediately following discovery**. This drives a contractual customer-notice clock much shorter than the statute. Personal-information triggers: name + (SSN, license, account number, medical, biometric, etc.) or **username/email + password or security answer**. Our staff accounts (email + credential) are the realistic trigger.
- **Wiretap/CIPA (Penal Code §§ 631, 632.7, 638.51).** The active plaintiff theory against session replay, chat widgets, and tracking pixels used without prior consent. Our PostHog setup is consent-gated (good); Intercom (G1) and Google Fonts (G10) are the soft spots.

### 4.2 K-12 student privacy

- **FERPA (20 U.S.C. § 1232g; 34 CFR Part 99).** ItemTraxx receives "education records" (or records directly related to a student maintained by a party acting for the school). Disclosure without parent consent is lawful under the **school-official exception (99.31(a)(1)(i)(B))** only if we perform an institutional service the school would otherwise do itself, are under **direct control** of the school for use/maintenance of records, and use records only for authorized purposes (99.33(a) redisclosure limits). The contract must say all of that, and the school (not us) provides annual FERPA notice. Offer record-access/amendment assistance (99.10–99.22) and the 99.32 disclosure log (our audit tables help).
- **COPPA (15 U.S.C. §§ 6501–6506; 16 CFR 312).** Children under 13: we do not collect directly from children (borrowers do not log in), but a borrower code tied to a child is data about a child collected via the school. FTC guidance permits schools to consent on parents' behalf for **educational-purpose** use only, with the operator not using the data for commercial purposes. The 2025 COPPA Rule amendments (compliance deadline spring 2026; confirm date) add a **written data-retention policy** and **written information-security program** for children's data, plus separate consent for third-party disclosures. State: school authorizes, we use only for the service, we delete when no longer needed.
- **SOPIPA (Bus. & Prof. Code § 22584).** Operators of services **marketed and used primarily for K-12 purposes** may not: target advertising using covered student information; build profiles for non-school purposes; sell it; or disclose it except narrow exceptions (service providers bound by the same limits, legal process, safety). Must maintain reasonable security and **delete a student's covered information at the school's request**. ItemTraxx markets to schools, so it applies.
- **Ed. Code § 49073.1 (AB 1584).** A California local educational agency contract with a third party that receives pupil records must include: (1) pupil records remain property of/under control of the LEA; (2) how students may retain their own content (N/A here, say so); (3) prohibition on using records for any purpose other than the contract; (4) procedure for parents/guardians to review and correct records; (5) security and confidentiality measures; (6) breach notification procedure; (7) certification that records won't be retained after the contract ends and how it's enforced; (8) FERPA compliance statement; (9) prohibition on using personally identifiable information from pupil records to target advertising. A non-compliant contract is **void and unenforceable** once the LEA gives notice. This is the template for the DPA's California rider.
- **Other regimes that will hit the first out-of-state customer:** Illinois SOPPA (public subprocessor list, breach notice, deletion), New York Ed. Law § 2-d (parents' bill of rights supplement, short breach timelines), Student Data Privacy Consortium **NDPA / California CSDPA** (many CA districts require signing their standard; adopting it as our base saves months).

### 4.3 Vulnerability disclosure and safe harbor

Under the CFAA (as read by DOJ's 2022 charging policy), Cal. Penal Code § 502, and DMCA § 1201, researchers need written authorization to be reasonably safe. A VDP should: define scope (production hostnames), prohibit data exfiltration/pivoting/DoS/social engineering/physical attacks, **forbid access to real student data and require immediate stop-and-report if encountered**, promise not to pursue legal action or object to third-party claims for good-faith compliance, state a response SLA, and say no bounty (unless you decide otherwise). Because Strix (autonomous pentest) already runs against your surface, the VDP must also bind your own contractors/tools to the same rules.

### 4.4 Individual accounts

`individual_accounts` plans (single-user) are consumer-facing: CCPA applicability is the same as above, but you are the controller, there is no school-official exception, and a minimum-age gate (18+, aligned with COPPA) should be in the Terms. Do not let individuals enter minors' data without a stated adult responsibility clause.

---

## 5. Master document inventory (ranked)

Governing-law default: California; venue per counsel (recommend your home county or arbitration for individuals, courts for public-school customers because many cannot agree to arbitration or foreign law).

### Tier 0 – Corporate and Founder IP (chain of title)

Not code-derived; included because Aikido/ISO auditors, enterprise procurement, and any acquirer ask first.

| # | Document | Purpose / law | Must name | Key clauses |
|---|---|---|---|---|
| 0.1 | **Founder IP Assignment (and any contractor/employee PIIA)** | Cal. Lab. Code § 2870 carve-out; 17 U.S.C. § 204 (written transfer) | Dennis Frenkel; every contributor in git history (e.g., `dev/mmango10`, `leo-dev` environments imply at least one more developer); repos `ItemTraxxCo/itemtraxx-app`, `devops`, `itemtraxx-backups`, internal-docs repos; domains itemtraxx.com | Present assignment of all code/design/brand/domain, moral-rights waiver, prior-inventions schedule, OSS inbound-license representations, confidentiality |
| 0.2 | **Entity, bylaws/operating agreement, cap table, 83(b)** | Corporate hygiene | Legal entity name as it will sign DPAs | Authority to sign; officer titles |
| 0.3 | **Trademark filings (ITEMTRAXX word + logo) and domain/registrar ownership record** | Lanham Act | Brand assets in `public/brand` | Ownership in company not founder personally |
| 0.4 | **Open-source license inventory + SBOM statement** | License compliance | Output of `npm run security:sbom` (CycloneDX) | Notice file; no copyleft in distributed bundle |
| 0.5 | **Contributor/vendor NDAs and AI-tooling policy** | Trade secrets (Cal. Civ. Code § 3426) | AI vendors in CI (NVIDIA NIM, Aikido) | No customer data in prompts |

### Tier 1 – Public user-facing and platform gatekeepers

| # | Document | Purpose / statutes | Fields & vendors to name explicitly | Key clauses driven by our stack |
|---|---|---|---|---|
| 1 | **Terms of Service (website + app, clickwrap)** | Contract formation; auto-renewal law (Bus. & Prof. Code § 17600 et seq.) for individual subscriptions | Workspace admins, tenant accounts, individual accounts; plan names (`workspace_core/growth/enterprise`, `education`, `individual_*`) | Account roles (`tenant_user`, `tenant_admin`, `district_admin`, `super_admin`); customer owns its data; acceptable use (no unnecessary student identifiers; no real-name codes); fees/invoicing; suspension via kill switch; SSO responsibility; adult-only for individuals; liability cap/warranty disclaimer; order of precedence (MSA > DPA > ToS); assent logged (G3) |
| 2 | **Privacy Policy** | CalOPPA § 22575; CCPA § 1798.130 (notice at collection, if applicable); DNT disclosure | Staff email, role, device/session data (UA, general location), IP (hashed for telemetry; raw at Cloudflare/Better Auth), sales-lead fields, support requests + screenshots, consent record, error reports; vendors: Supabase, Cloudflare, Vercel, PostHog, Intercom, Resend, Slack, Better Auth Infra, Google Fonts (until removed), incident.io | Processor vs controller split; server-side security telemetry w/o opt-out (G8); retention table; rights process (`/privacy-request`); no sale/share; Do-Not-Track; contact; effective-date history |
| 3 | **Student Privacy Notice / Pledge** | SOPIPA § 22584; § 49073.1; FERPA; COPPA; also fulfills Illinois/NY public-notice duties | Borrower `username`, `borrower_id`, checkout history, who borrowed what/when; **no** images, grades, health, location, biometrics, or contact data | Pledge (no ads, profiling, sale, or non-school use); school-official/direct-control language; parent review via the school; deletion on school request; subprocessor link; no student logins; camera is barcode-only and not recorded; breach notice to school |
| 4 | **Cookie and Tracking Notice** | CalOPPA; CIPA defense; ePrivacy-style practice | Cookies: `itemtraxx-cookie-consent`, `itemtraxx-cookie-consent-subject` (1 yr, `.itemtraxx.com`), `ph_*` (PostHog), Intercom cookies, Better Auth session cookie (host-only), `itemtraxx-replay-session-handoff` (legacy clear); storage: offline queue (encrypted IndexedDB), theme, device ID; Cloudflare Turnstile | Categories: essential / analytics / diagnostics (replay = both) / **support (Intercom, once gated)**; how to withdraw; table with duration and vendor; statement that server security logs are not cookie-based |
| 5 | **Vulnerability Disclosure Policy with Safe Harbor** | CFAA, Cal. Penal Code § 502, DMCA § 1201 | Scope: `itemtraxx.com`, `www`, `app`, `edge`, `status`, `internal` (CF-Access gated); out of scope: customer IdPs, Supabase/Cloudflare/Vercel platform infrastructure, third-party SaaS | Authorization statement; no data access beyond proof; stop on student-data contact; 90-day coordinated disclosure; response SLAs; contact `security@itemtraxx.com`; align with `security.txt`; bind own pentest tooling |
| 6 | **Acceptable Use / Anti-Abuse Policy** | Protects platform | Public forms: sales, support, consent-record, client-error-report | Rate-limit notice, prohibited content, attachment rules |
| 7 | **Privacy Request intake (DSAR) procedure** | CCPA § 1798.130; § 49073.1 parent-review flow | `/privacy-request` route | Verification, 45-day clock, route school-held requests back to the school |

### Tier 2 – Customer B2B / school enterprise

| # | Document | Purpose / statutes | Must name | Key clauses |
|---|---|---|---|---|
| 8 | **Customer DPA + California rider (adopt CSDPA/NDPA exhibits)** | FERPA 99.31; § 49073.1; SOPIPA; COPPA; CCPA service-provider terms; NY § 2-d supplement as needed | Data categories (Exhibit B: borrower code, borrower ID, checkout logs, staff email, device/session data); data NOT collected (names unless entered by school, DOB, grades, images, location, biometrics); the full subprocessor list (Doc 12); regions | LEA owns records; purpose limitation; school-official/direct control; no ads/profiling/sale; subprocessor flow-down + notice + objection; breach notice **without undue delay and within 72 hours of confirmation** (shorter than statute because we are not the data owner); assistance with parent requests; deletion/return within 30–60 days of termination + **deletion certificate** (§ 49073.1(b)(7)); backup roll-off period stated; audit rights via reports (ISO 27001, Aikido) not on-site; liability allocation; precedence over any click-through |
| 9 | **Incident Response Plan (internal) + customer breach-notice template** | Civ. Code § 1798.82, § 1798.29 (public agency customers), SB 446 timing, § 49073.1(b)(6), contractual 72-hour clock | Tools: `security_audit_logs`, incident.io paging, attempted-vs-successful classification (`incidentOutcome.ts`), kill switch (KV), Supabase/CF logs | Roles; severity matrix; decision tree for "acquisition of unencrypted PI"; customer-first notice (owner/licensee, § 1798.82(b)); AG sample filing; evidence preservation; post-mortem; tabletop cadence |
| 10 | **Security Addendum / Technical and Organizational Measures** | Contractual representations; ISO 27001 mapping | Controls in § 3 "positive controls"; vendor attestations (Supabase, Cloudflare, Vercel SOC 2/ISO) | Encryption in transit (HSTS) and at rest (provider); MFA/passkeys/SSO; RLS tenant isolation; least-privilege service roles; step-up for privileged actions; logging; vulnerability management (CodeQL, Aikido, Strix); backup scope; **do not overclaim** (e.g., don't promise "all data encrypted client-side") |
| 11 | **Data Retention and Deletion Schedule** | § 49073.1(b)(7); SOPIPA; COPPA written retention policy; CCPA retention disclosure | Table-by-table: borrowers (soft-delete 365 d), items (730 d), `item_logs` (**decide**), admin audit (730 d), super audit (1,095 d), consent (730 d anon), offline packs (≤24 h + 7 d), invitations (30 d), sessions, error reports, email logs, support + attachments, leads, backups, vendor copies (PostHog, Intercom, Slack, Resend) | Customer-initiated deletion SLA; end-of-contract flow (archive → 30-day grace → purge → certificate); legal-hold exception; fixes for G4–G6 first |
| 12 | **Subprocessor Directory (public) + change-notice procedure** | Illinois SOPPA; NDPA; DPA flow-down | See § 2: name, entity, purpose, data, location, safeguards, DPA status | 30-day advance notice + objection right (the repo already has `subprocessorNotice.ts` and a `subprocessor_changes` archive; wire it to the directory) |
| 13 | **Master Services Agreement / Order Form / Quote** | Commercial terms; public-entity statutory riders | Plan keys, `schools_count`, seats limits (`max_students`, `max_gear`, `max_admins`), `checkout_due_hours`, billing/renewal/invoice fields in `workspace_policies` | Term/renewal, payment net terms, price changes, support hours, sandbox/test data, public-agency clauses (no indemnity beyond law, governing law CA, CPRA/public-records carve-out), publicity, assignment |
| 14 | **Education Data Certification / Parent-notice kit** | Helps schools meet FERPA annual notice, COPPA school authorization | One-page FERPA/COPPA summary schools can paste into parent handbooks | Plain-English data list; contact route |

### Tier 3 – Enterprise procurement, SLA, scale

| # | Document | Purpose | Notes |
|---|---|---|---|
| 15 | **Service Level Agreement** | Uptime credits | Base on measured data: status page (`status.itemtraxx.com`), synthetic probes, `system-status`; exclude maintenance mode and kill-switch events; RPO/RTO from backup design |
| 16 | **Business Continuity / DR summary** | RFP requirement | Supabase PITR + GCP VM backups (confirm), kill switch, maintenance fallback KV |
| 17 | **HECVAT Lite/Full and SIG-Lite answers; VPAT/ACR (WCAG 2.2)** | Higher-ed and district procurement | VPAT needs an accessibility audit of the Vue app; ISO 27001 report from Aikido supports most security rows |
| 18 | **Security attestation letter (only if and when a certification or audit report exists)** | Evidence | Do not publish certification claims until verified |
| 19 | **Enterprise SSO addendum** | Customer IdP responsibility | SAML/OIDC, domain verification TXT, IdP-initiated flow caveat (`allowIdpInitiated`), JIT provisioning role (`tenant_account`) |
| 20 | **Support and Escalation Policy; Professional-services/Data-import terms** | Operational | Intercom + email; CSV import guidance (do not upload unneeded identifiers) |
| 21 | **International/GDPR addendum + SCCs** (only when a non-US customer appears) | GDPR Ch. V | Triggered by Google Fonts/GitHub/IP flows too; deferred until needed |
| 22 | **Internal policy set** (access control, vendor management, key rotation per Infisical runbook, change management, AI-use policy) | ISO 27001 evidence and enterprise questionnaires | Several already exist in `itemtraxx-internal-docs`; refresh to match this blueprint |

---

## 6. Recommended build order

**Phase A – Stop the bleeding (engineering, 1–2 weeks, before drafting)**
1. Gate Intercom behind consent or user action (G1). Self-host fonts (G10). Replace GitHub version check with first-party file (G11).
2. Confirm Better Auth Infra payload and prod key status; decide remove vs. paper (G2).
3. Confirm which of the 10 PROD workspaces are real; classify each as demo/test/customer (G14).
4. Fix retention bugs: per-step exception handling and borrower-log anonymization (G5); add scheduled workspace purge (G6); add missing purges or decide to retain (G4).
5. Add `legal_acceptances` migration + acceptance UI hooks with version/hash (G3).

**Phase B – Fact sheet and decisions (counsel + you, 1 week)**
6. Finalize the subprocessor table (§ 2) and the retention table (Doc 11). These two sheets are the source of truth every other document quotes.
7. Decide: SDPC NDPA/CSDPA as DPA base (recommended), breach-notice SLA (72 h), deletion SLA (30 days + 90-day backup roll-off), governing law/venue.

**Phase C – Draft in dependency order**
8. Tier 0.1 IP assignments (unblocks everything; cheapest to do now).
9. Doc 12 Subprocessor Directory → Doc 11 Retention Schedule → Doc 8 DPA + California rider → Doc 10 Security Addendum.
10. Doc 3 Student Privacy Notice → Doc 2 Privacy Policy → Doc 4 Cookie Notice (these must match the DPA verbatim on data lists).
11. Doc 1 ToS + Doc 13 MSA/Order Form; Doc 6 AUP.
12. Doc 5 VDP + safe harbor and Doc 9 IRP (with a tabletop exercise).

**Phase D – Wire into product**
13. Clickwrap on signup/invitation acceptance and on workspace creation (admin accepts DPA); re-accept on version change.
14. Publish `/legal/*` pages from the new suite; update `security.txt` `Policy:` to the VDP URL; add subprocessor-change email using existing `subprocessorNotice.ts`.
15. Add a "data minimization" hint to borrower creation/import UI (G7).

**Phase E – Scale (as deals appear)**
16. SLA, DR summary, HECVAT, VPAT, SSO addendum, GDPR addendum on demand (Tier 3).

---

## 7. Open questions only you can answer

1. Are any of the 10 PROD workspaces / 230 borrowers real school data?
2. Is `BETTER_AUTH_API_KEY` set in production (activating sentinel/dash telemetry)?
3. Is Vercel Web Analytics / Speed Insights behind consent, and is it enabled in the Vercel project?
4. Where are backups (GCP region), how long are they kept, are they encrypted, and do they include Storage objects?
5. Which tool issues invoices/quotes, and does it receive school contact data?
6. Do sales/support Slack messages include names, emails, or free-text bodies?
7. Is there a second developer (the `leo-dev` environment suggests one) with signed IP assignment?
8. Does a `legal_acceptances` table exist in production today?
