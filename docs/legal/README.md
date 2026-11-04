# ItemTraxx legal documents

Canonical, publication-ready drafts of ItemTraxx's public legal documents. They were written from the code, configuration, and production metadata as of 2026-11-04, after the Phase A engineering changes, and they replace the earlier root-level `PRIVACY.md`, `TERMS.md`, `STUDENT_PRIVACY.md`, and `SECURITY.md` (now short pointers to this folder). See [`../legal-architecture-blueprint.md`](../legal-architecture-blueprint.md) for the audit behind them.

> These are drafts for counsel review, not legal advice. Have California counsel read them before publication. Every number in the "Decisions" table is a default I chose so the documents are complete; each is a commitment you are making, so confirm or change it.

## 1. Document map

### Drafted (this folder)

| File | Audience | Status |
|---|---|---|
| [`privacy-policy.md`](privacy-policy.md) | Website and app users | Drafted |
| [`terms-of-service.md`](terms-of-service.md) | Customers and users | Drafted |
| [`student-privacy-notice.md`](student-privacy-notice.md) (Part A notice; Part B FERPA/SOPIPA addendum) | Schools, parents, students | Drafted |
| [`vulnerability-disclosure-policy.md`](vulnerability-disclosure-policy.md) (includes `security.txt` spec) | Security researchers | Drafted; `security.txt` files updated |
| [`cookie-notice.md`](cookie-notice.md) | Website and app users | Drafted |
| [`subprocessor-directory.md`](subprocessor-directory.md) | Schools and customers | Drafted |

### Public-facing, not yet drafted (next, in this order)

1. Acceptable Use Policy (the Terms section 5 is the first version)
2. Privacy-request (DSAR) procedure
3. Parent-notice kit and the public summary of the retention schedule

### Customer-facing (signed or shared with schools)

Customer DPA with the California rider, Security Addendum, MSA / Order Form / quote, SLA, SSO addendum, support and escalation policy, business-continuity summary, HECVAT and VPAT, ISO 27001 letter, and (on demand) a GDPR addendum.

### Internal-only

Founder and contributor IP assignments, entity and trademark records, open-source inventory, NDAs, the Incident Response Plan (its customer breach-notice output is customer-facing), and the internal policy set. `DPA.md` and `LEGAL.md` at the repository root are **not** replaced yet; `LEGAL.md` still points at the replaced files.

## 2. Placeholders to fill before publishing

| Token | Fill with | Notes |
|---|---|---|
| `[[EFFECTIVE_DATE]]` | Publication date | Set the same date and version in the legal registry (section 5) |
| `[[ENTITY_DESCRIPTION]]` | Legal name and form, e.g. "ItemTraxx Co, a ___ corporation/LLC" | Only "ItemTraxx Co" appears in the repo; state and entity type are not recorded anywhere I can see |
| `[[MAILING_ADDRESS]]` | Postal address for notices | Required for CalOPPA/CCPA contact and the Terms' notice clause |
| `[[GOVERNING_COUNTY]]` | County for venue | Terms section 17 |
| `[[DATA_BREACH_CAP]]` | Multiple of fees for the data-breach liability cap | I recommend 2 (i.e. "2 times"); the clause reads "[N] times the fees in item 2" |
| `[[DATABASE_REGION]]` | The Supabase project's region, written as "in the United States" or the specific region | Not determinable from the repo |
| `[[BACKUP_LOCATION]]` | Where backups are stored (for example the Google Cloud region) | Subprocessor Directory, Group A |
| `[[BACKUP_RETENTION_DAYS]]` | How long backups are kept before overwrite | The backup VM and repo are outside this codebase |
| `[[ANALYTICS_RETENTION]]` | PostHog data retention you have configured | Check the PostHog project setting; I never read it |

Check that nothing is left: `grep -rn "\[\[" docs/legal/`.

## 3. Decisions I made that you must confirm

| Commitment | Where | Default |
|---|---|---|
| Breach notice to schools | Student addendum 9; Privacy 7 | Within 72 hours of confirmation |
| Deletion on a school's written request | Student addendum 7.2 | Within 30 days |
| Parent request referral and help | Student addendum 6 | 10 business days |
| Subprocessor change notice | Student addendum 4.3 | 30 days, with objection and refund right |
| Notice of material Terms changes | Terms 18 | 30 days, with exit and refund right |
| Payment terms | Terms 9 | Net 30; suspension after 15 days' notice on undisputed invoices > 30 days late |
| Renewal | Terms 9 | Auto-renew for the same term unless 30 days' notice |
| Liability cap | Terms 16 | Fees paid in prior 12 months (US$100 if none), with carve-outs and a higher data-breach cap |
| IP infringement indemnity by ItemTraxx | Terms 15 | Included, standard |
| Refund if functionality materially reduced | Terms 3 | Pro-rata, on request within 30 days |
| Governing law | Terms 17 | California, courts in `[[GOVERNING_COUNTY]]`, public-entity carve-out |
| Vulnerability response times | VDP 7 | Acknowledge 3 business days, assess 10, update every 14, 90-day disclosure window |
| No bug bounty | VDP 7 | Credit only |
| Intercom as "essential" | Privacy 4.3; Cookie Notice 4 | Disclosed; not behind a consent gate |
| Subprocessor change notice for Group B providers handling customer personal information | Subprocessor Directory 5 | 30 days, same as Group A |
| Cookie consent records for signed-out users | Cookie Notice 5 | Kept 730 days (matches the purge job) |

## 4. Facts to verify (I could not confirm them from the repo)

1. **Better Auth Infra (`sentinel`, `dash`).** The Privacy Policy lists Better Auth, Inc. as a provider receiving sign-in event data. Confirm what these plugins actually send and whether `BETTER_AUTH_API_KEY` is set in production. If you remove them, delete that row and the Student addendum has no change.
2. **Supabase region** and whether it is "in the United States."
3. **Backups on the Google Cloud VM**: retention, location, encryption. The documents promise only that backups roll off on a schedule.
4. **Slack payloads** for sales and support notifications (the Privacy Policy says contact details and message details).
5. **Intercom cookie lifetimes** ("typically up to 9 months") and its configured retention.
6. **Whether individual plans are billed automatically.** Terms 9 assumes invoicing with a renewal reminder.
7. **PostHog retention** (`[[ANALYTICS_RETENTION]]`).

## 5. Engineering work that makes the documents true

The documents describe the system as it will be once the Phase A changes are deployed. Before publishing:

1. **Apply the three migrations and deploy** `job-worker`, `legal-acceptance`, and the Worker. Until then production still has the borrower-purge bug and no workspace deletion, which the Privacy Policy and Student addendum describe as working.
2. **Add a "Cookie preferences" link** that reopens the banner (footer and app). Privacy 4.2 currently tells users to clear cookies, which is workable but weak for easy withdrawal.
3. **Render these documents on the site.** The `/privacy`, `/legal`, `/legal/student-privacy`, `/cookies`, and `/report-security-issue` pages still carry the old text, and there is no page for the Subprocessor Directory yet (the Privacy Policy and Student addendum link to it). `security.txt` now points at `/report-security-issue`, so that page must show the VDP and the report form.
4. **Seed the legal registry.** Hash each published document (SHA-256 of the exact text), then insert a row for each into `legal_document_versions` with the same version string, so clickwrap acceptance can be recorded. No acceptance prompt is mounted yet.
5. **Add retention purges** for support requests, sales leads, error reports, and email logs if you want a fixed period instead of "while needed" (Privacy section 6 deliberately promises only what the code does today).
6. **Publish the `privacy-request` page text** and keep the Privacy Policy and Subprocessor Directory tables in sync.

## 6. How the documents map to the code

| Statement | Evidence |
|---|---|
| Borrower username/ID are generated unless an admin types them (≤40 chars) | `supabase/functions/admin-borrower-mutate/index.ts` |
| No borrower email/phone/DOB/photo fields | `supabase/migrations/20260725221011_item_borrower_physical_rename.sql` (schema) |
| Camera never stored | `src/composables/useCameraBarcodeScanner.ts` |
| Analytics/diagnostics opt-in; replay needs both | `src/services/cookieConsentService.ts`, `src/services/posthogService.ts` |
| Session cookies `__Host-itx_session` (1 h) and `__Host-itx_refresh` (≤14 d), HttpOnly/Secure/Lax | `cloudflare/edge-proxy/src/cookies.ts` |
| Consent cookie names, 1-year duration, 2-second cross-tab sync | `src/services/cookieConsentService.ts` |
| Vercel Analytics and Speed Insights only with analytics consent | `src/App.vue`, `src/composables/useCookieConsentTelemetry.ts` |
| Intercom lazy, essential, loads for everyone | `src/composables/useIntercom.ts` |
| Self-hosted fonts, no GitHub version call | `src/main.ts`, `index.html`, `vite.config.ts`, `src/composables/useAppVersionStatus.ts` |
| Retention periods (365/730/730/1,095, 730, 7+24h, 30) | Production `data_retention_policies` and cron; consent and invitation migrations |
| Borrower purge keeps history, unlinks borrower | `20261104120000_preserve_item_history_on_borrower_purge.sql` |
| 30-day workspace purge and certificate | `20261104130000_workspace_purge_executor.sql`, `supabase/functions/job-worker/workspacePurge.ts` |
| Acceptance record fields | `20261104140000_legal_acceptance_audit_trail.sql` |
| Sessions up to 7 days; 12-character passwords | `cloudflare/edge-proxy/src/auth.ts` |
| Security headers, HSTS preload | `vercel.json` |
