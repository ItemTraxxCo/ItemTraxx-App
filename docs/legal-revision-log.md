# Legal documents revision log

Internal working note. Draft for counsel review, not legal advice. Not published on the site (it lives outside `docs/legal/`).

Source IDs: **CF** = confirmed code fact, **CX** = cross-document conflict, **D** = decision (all from the revision brief). **R** = the earlier-round instruction to prune technical over-sharing.

HTML comments (`<!-- VERIFY ... -->`, `<!-- E-DEPENDENCY ... -->`) in the documents are invisible on the site and are listed under each file's open items.

## 1. terms-of-service.md

| Section | Old | New | Reason | Source |
|---|---|---|---|---|
| 1, 4 | "tenant accounts" | "workspace user accounts" | Terminology | D6, CX-7 |
| 2 | 4-tier order with "California rider" | 6-level order: Order Form; signed Student Data Privacy Agreement or California school rider "if one has been executed"; Student Data Addendum; general DPA; Terms; Privacy Policy and Part A | One order everywhere; rider reference made conditional | D7, CX-6, CX-18, CF-9 |
| 5.2 | Prohibited list without photos | Adds "photographs" | Align with Part B Section 10 | per-file |
| 6 | "student information" | "Student Data"; VERIFY comment on the "no training of generalized models" statement | Terminology; claim unverified | D6 |
| 7 | School-official text | Links to the Student Data Addendum (Part B) and the DPA; no restated FERPA terms | Single source for student terms | D1 |
| 8 | "conflicts are shown to an administrator" | "flagged for review by authorized staff" + VERIFY | Code shows a review/resolution flow; the role is not confirmed | offline workflow code |
| 10 | "Privacy Policy and our subprocessor directory" | Links to the Subprocessor Directory | Single source of truth | D2 |
| 14 | Deletion text; survival list | Cross-refs DPA 8 and Part B 7; E-DEPENDENCY comment; survival list adds 9 (fees owed), 19 and the data return and deletion terms | Align retention; confirm survival | D8, CX-5 |
| 16.3 | No incident-timing link | Links DPA 7 and Part B 9 | Per-file | D3 |
| 18 | 30 days' notice | Unchanged | Per-file | n/a |

Open items: counsel to confirm the survival-clause additions; **VERIFY** the no-training statement and the offline conflict role; **COUNSEL** the conditional rider reference.

## 2. privacy-policy.md

| Section | Old | New | Reason | Source |
|---|---|---|---|---|
| 1.1 | "Workspace Data" only | Notes it is Customer Data in the Terms and DPA | Term alignment | D6 |
| 2.1, 2.3, 4.3, 9, 11 | "student information" | "Student Data" | Terminology | D6 |
| 2.2 | "tenant account" | "workspace user account" | Terminology | D6, CX-7 |
| 2.5 | "error reports" listed as optional | "diagnostic logs" | Error reports are essential | D5, CX-1 |
| 2.7 | Error reports contained hashed IP; "technical diagnostics" | Full field list; always on; stored in Supabase; Slack summary fields; designed to exclude borrower data; free text only length-limited; rate-limited; diagnostics attachments consent-gated; not sent to PostHog; VERIFY on hashed identifier | Match code | CF-1, CF-2, CF-3, CF-4, CX-8, CX-15 |
| 4.1 | Short table | Adds sign-in (2FA) cookies, Cloudflare `cf_clearance` and `__cf_bm`, localStorage, sessionStorage, IndexedDB with 25 MB offline pack, consent-sync marker (described, not named), Secure over https | Per-file | CF-5, CF-7, CX-13 |
| 4.2 | Diagnostics controls "error reporting and diagnostic logs sent to PostHog" | Diagnostics controls PostHog diagnostics and diagnostic attachments, not the core error report | Decouple | D5, CX-1 |
| 4.3 | "a moment after the page finishes loading" | "shortly after the page has loaded and the browser is idle (typically within a few seconds)" | Same wording as cookie notice | CX-19 |
| 5.1 | Directory pointer | Adds 30-day notice and objection reference; "Student Data" | Single source | D2, D4, CX-3 |
| 6 | No error-report row | Adds `[[ERROR_REPORT_RETENTION_DAYS]]` row | Per-file | D5 |
| 7 | "promptly" | 72 hours for Student Data, `[[OTHER_DATA_INCIDENT_NOTICE]]` for other Customer Data | One timeline | D3, CX-2, CX-16 |
| 7 | "tenant isolation" | "workspace isolation" | Terminology | CX-7 |

Open items: **DECISION** `[[OTHER_DATA_INCIDENT_NOTICE]]`; **DECISION** `[[ERROR_REPORT_RETENTION_DAYS]]` (no purge exists in code for error reports other than workspace deletion); **VERIFY** whether the stored report or rate limiter keeps a hashed network identifier.

## 3. subprocessor-directory.md

| Section | Old | New | Reason | Source |
|---|---|---|---|---|
| Intro | "customer Data Processing Addendum" | Links `dpa.md` | Link | D1 |
| 1 Supabase | No error reports | Adds support attachments and error reports | Per-file | CF-2 |
| 1 PostHog | "error tracking" | "consent-gated diagnostic logs" and session replay (with consent) | Error reports are not sent to PostHog | CF-4, D5 |
| 1 Slack | "error-report metadata" | Lists summary fields | Per-file | CF-2 |
| 2 | Tools receiving no data | Names GitHub as excluded | Per-file | CF-8, CX-4 |
| 3 | 30-day notice and objection | Unchanged; notes it matches DPA 5 and Part B 4 | Align | D4, CX-3 |

Open items: **VERIFY** Resend and incident.io exclude Student Data (CX-10); **VERIFY** provider locations (only Supabase, Google Cloud, Cloudflare, Vercel and PostHog are grounded; the others are "United States" by assumption).

## 4. vulnerability-disclosure-policy.md

| Section | Old | New | Reason | Source |
|---|---|---|---|---|
| 2 | "tenant isolation" | "workspace isolation" | Terminology | CX-7 |
| 7 | "as our customer agreements and the law require" | 72 hours for Student Data, DPA 7 otherwise, plus Civ. Code 1798.82 | One timeline | D3, CX-16 |
| 1, 2, 6, security.txt | n/a | Checked: safe harbor unchanged; no financial bounty; `/report-security-issue` route exists; `security.txt` expires 2027-10-31 | Per-file | n/a |

Open items: **VERIFY** a reminder to renew `security.txt` before 2027-10-31; **VERIFY** `/.well-known/security.txt` is served in production.

## 5. cookie-notice.md

| Section | Old | New | Reason | Source |
|---|---|---|---|---|
| 1 | No error-report line | Adds essential error reports; Intercom timing aligned | D5, CX-19 | |
| 2.1 | "Secure" always stated; subject cookie unexplained | Secure applies over https; subject cookie is created when the choice is first recorded on the server | Match code | CF-5, CX-12, CX-13 |
| 2.1 | 2FA cookie sentence | Adds VERIFY comment | Names not confirmed | |
| 2.2 | Purpose / what / how long | Adds Storage type column (localStorage, IndexedDB, sessionStorage); adds cookie choice sync and 25 MB offline pack, without key names | Per-file | CF-5, CF-7, R |
| 2.3 | n/a | New: error reports are essential, no cookie, not in PostHog | D5 | CF-1 to CF-4, CX-1 |
| 3 | One "error reports and diagnostic logs (PostHog)" row | Two rows: PostHog diagnostic logs; diagnostic attachments to error reports | D5 | CF-3, CF-4 |
| 4 | "about a second or two" | Same wording as Privacy Policy | CX-19 | |
| 5 | Withdrawal removes analytics storage | Verified in code: `clearAnalyticsPersistence()` runs when telemetry consent is withdrawn | CX-14 | CF-6 |

## 6. dpa.md

Rewritten as a general DPA with 12 sections and Annexes A and B. Header now uses `[[EFFECTIVE_DATE]]` (CX-20).

| Section | Old | New | Reason | Source |
|---|---|---|---|---|
| 2, 3 | Educational purpose; FERPA and COPPA text | Short cross-references to Part B | No duplication | D1 |
| 4 | "tenant-scoped" | "workspace-scoped"; personnel confidentiality sentence | Terminology; align Part B | CX-7 |
| 5 | Provider list incl. GitHub; "no notice or objection" | Directory is the single list; 30-day notice and objection; Part B 4 for Student Data | D2, D4 | CX-3, CX-4, CF-8 |
| 7 | 30 calendar days | 72 hours after confirmation for Student Data; `[[OTHER_DATA_INCIDENT_NOTICE]]` otherwise | D3 | CX-2 |
| 8 | "automated retention disabled by default" | 30-day recovery then automated permanent deletion; E-DEPENDENCY | D8 | CX-5 |
| 9 | Audit on request | Once a year unless incident, matching Part B 11 | Align | |
| 11 | "executed DPA controls" | 6-level order | D7 | CX-6, CX-18 |
| Annex A, B | n/a | New processing description; directory link | D1 | |

Open items: **DECISION** `[[OTHER_DATA_INCIDENT_NOTICE]]`; **E-DEPENDENCY** deletion automation; **COUNSEL** the 30-day deletion on request (matches Part B 7.2) and the conditional rider.

## 7. student-privacy-notice.md

| Section | Old | New | Reason | Source |
|---|---|---|---|---|
| Intro | Part B "supplements any DPA" | Part B is the Student Data Addendum; points to Section 12 | D1 | |
| A.3 | "do not take or store photos or video" | "of students"; staff-attached support images are stored with support records | Match support form | CX-9 |
| A.5 | Names Supabase, Cloudflare; "error reports contain no borrower data"; points to Privacy Policy | Names no vendors, points to the directory; "designed to exclude borrower data" | D2, CF-3 | CX-8 |
| B.1.4 | n/a | VERIFY comment: keep SOPIPA operator and 49073.1 characterization for counsel | | CX-17 |
| B.4.1 | Lists three providers | Points to the directory | D2 | |
| B.4.2 | "alerting, and paging" | "internal alerting" + VERIFY on Resend and incident.io | | CX-10 |
| B.4.3 | 30-day notice | Unchanged; adds link to DPA 5 | D4 | |
| B.5 | "tenant isolation" | "workspace isolation" | | CX-7 |
| B.9 | 72 hours | Unchanged | D3 | |
| B.12 | 3-item order | 6-level order | D7 | CX-6 |

## Cross-document consistency report

The brief lists 7 checks; "Checks 1-11" in the output instructions has no definition for 8 to 11, so only the seven are reported.

| # | Check | Result |
|---|---|---|
| 1 | Error reporting: Supabase and Slack essential reporting separate from PostHog consent diagnostics | **PASS** in Privacy 2.7/4.2, Cookie 1/2.3/3, Directory. DPA, Terms and Part A mention error reports only as deleted data or "designed to exclude borrower data". |
| 2 | Incident notice: 72 hours for Student Data | **PASS** in DPA 7, Part B 9, VDP 7, Privacy 7. Other Customer Data is **OPEN** (`[[OTHER_DATA_INCIDENT_NOTICE]]`). |
| 3 | Subprocessors: directory is single source | **PASS** in Privacy 5.1, DPA 5/Annex B, Part A.5, Part B.4, Terms 10. |
| 4 | Retention: 30-day recovery then purge | **PASS** in Terms 14, Privacy 6, DPA 8, Part B 7. Depends on the engineering item below (**OPEN**). |
| 5 | Precedence: identical 6-level order | **PASS** in Terms 2, DPA 11, Part B 12. |
| 6 | No "tenant" for workspaces | **PASS** (zero matches in docs/legal). |
| 7 | Placeholders preserved | **PASS**. Existing tokens unchanged; two new tokens added (`ERROR_REPORT_RETENTION_DAYS` as instructed, `OTHER_DATA_INCIDENT_NOTICE` for D3). |

## Cross-cutting open items

1. **DECISION** `[[OTHER_DATA_INCIDENT_NOTICE]]` and `[[ERROR_REPORT_RETENTION_DAYS]]`. Both render as a yellow "pending" marker on the site until set in `src/legal/legalTokens.ts` (a test allows only these two).
2. **E-DEPENDENCY** The 30-day purge needs the workspace-purge migration applied and `job-worker` deployed. Until then production does not match Terms 14, DPA 8, Privacy 6, Part B 7.
3. **CONFLICT WITH EARLIER ROUND** The brief asks to list storage key names (for example the consent-sync key) and Slack and Supabase payload details; the earlier round asked to remove exact key names and keep the subprocessor directory to Vendor, Purpose, Data, Location. I described storage by type and purpose without key names, and listed Slack and Supabase data in the Data column only. Tell me if you want exact key names back.
4. **VERIFY** Resend and incident.io exclude Student Data; locations of Better Auth, PostHog (US cloud is confirmed), Intercom, Resend, Slack, incident.io; exact sign-in (2FA) cookie names.
5. **COUNSEL** No California school rider or Student Data Privacy Agreement template exists; references are conditional. 1798.82 "immediately after discovery" versus the 72-hour contract deadline. SOPIPA and Ed. Code 49073.1 characterization. DMCA agent registration. Survival clause additions in Terms 14.
6. `docs/legal/README.md` was not updated for these changes.

---

## Addendum 2026-11-04: VERIFY resolution against code and infrastructure

| # | VERIFY item | Result | Evidence | Change |
|---|---|---|---|---|
| 1 | Sign-in and 2FA cookie names | **Corrected.** The Worker no longer sets `__Host-itx_session` / `__Host-itx_refresh` (it only reads them and clears the old names). Real cookies: `__Secure-better-auth.session_token` (7 days), `.two_factor` (600 s), `.better-auth-passkey` (300 s), `__infra-rid` (600 s). No remember-me, trusted-device, or session-cache cookie is set. | `cloudflare/edge-proxy/src/auth.ts` (`session.expiresIn`, `advanced.useSecureCookies`, `crossSubDomainCookies: false`), `cookies.ts` (no `setSessionCookies` caller), Better Auth `dist` defaults | `cookie-notice.md` 2.1, `privacy-policy.md` 4.1 |
| 2 | Offline conflict role | Resolved on the account and device that made the checkout (`profile_id` + `device_id` match). Roles allowed: `tenant_account`, `workspace_admin`, `individual_account`. Quick Return needs Workspace Admin (or an individual account). | `supabase/functions/offline-checkout/index.ts` (resolve branch) | `terms-of-service.md` Section 6 sentence |
| 3 | Resend / incident.io exclude Student Data | Confirmed by templates: no borrower, student, or checkout fields in any Resend sender or incident.io payload. incident.io gets alert type, route, request ID, status, a keyed hash of the network address, and CI workflow status. | See README Section 6 | Directory rows and intro, DPA 5.4, Student notice Part B 4.2 |
| 4 | No AI training | No AI/LLM integration receives Customer Data in `src`, `supabase/functions`, or the Worker. Founder confirmed 2026-11-04: no AI is used in production. Subprocessor contract terms were not reviewed. | grep; `supabase/config.toml` OpenAI key is for local Studio only | Terms comment updated; statement kept |
| 5 | Locations | Supabase prod `us-west-1`; backup-job VM `us-west1-b`. Others remain "United States" assumptions. | Supabase project list; `itemtraxx-backups` workflow | Tokens already `US-West`; no change |
| 6 | Hashed network identifier in error reports | Yes: `ip_hash` (SHA-256 of the IP) and `client_fingerprint_hash` are stored. | `supabase/functions/client-error-report/index.ts` | `privacy-policy.md` 2.7 |
| 7 | E-DEPENDENCY (workspace purge) | **Not in production.** Prod migrations stop at `20261102015238`; `20261104120000/130000/140000` are not applied; `job-worker` v146 predates them. | Supabase `list_migrations`, `list_edge_functions` | Comments updated in `dpa.md`, `terms-of-service.md` |

### New findings that need a decision

1. **Backup retention conflict. DECIDED 2026-11-04: keep 30 days; the documents stay as written.** The infrastructure must now be changed to match: in `ItemTraxxCo/itemtraxx-backups`, set `SUPABASE_BACKUP_RETENTION_DAYS` from `"365"` to `"30"` (`.github/workflows/supabase-backup.yml` line 106) and update the `Retention` section of that README (default 365). The next successful backup run then permanently deletes every release older than 30 days, so existing older backups are lost. Until that change is merged and has run, the published 30-day statement is not true. Original finding: The documents say backups are overwritten within `[[BACKUP_RETENTION_DAYS]]` = 30 days. The production backup workflow sets `SUPABASE_BACKUP_RETENTION_DAYS: "365"`. Either change the workflow to 30 or change the token to 365 (and the deletion promises). Not changed here.
2. **Backups are stored on GitHub, not Google Cloud.** The Google Cloud VM runs the dump; the AES-256 encrypted archive is published as release assets of the private `itemtraxx-backups` repository. The directory said Google Cloud stored backups and that GitHub never receives customer data. The directory now lists both (GitHub as encrypted backup storage, location "United States", unverified). Adding GitHub triggers the 30-day subprocessor notice the documents promise; counsel should say whether prior notice is owed because the practice already exists.
3. DPA Annex A backup location text changed to "created in US-West and stored in encrypted form with GitHub in the United States".

### Final pass 2026-11-04

- Tokens set: `OTHER_DATA_INCIDENT_NOTICE` = "72 hours", `ERROR_REPORT_RETENTION_DAYS` = "90". `LEGAL_PENDING_TOKENS` is now empty, so no pending (yellow) marks remain.
- Terms: hidden AI note removed (founder confirmed 2026-11-04 that production uses no AI models or APIs).
- Directory and DPA keep GitHub listed as encrypted backup storage. `itemtraxx-backups` `main` has retention 30 in the workflow, the script default, and the README. Pruning has not happened yet (272 releases, oldest 2026-06-25) and is expected after the next backup run.
- **Open: error-report retention is not enforced.** Privacy Policy Section 6 says error reports are kept 90 days. Production has no such job: `public.run_data_retention` does not touch `client_error_reports` (or `email_delivery_logs`), `data_retention_policies` has only `audit_logs` and `soft_delete`, and the only cron jobs are audit-log retention and Turnstile token cleanup. Reports are deleted only by the workspace purge, which is itself not yet applied in production. Add a 90-day purge for `client_error_reports`, or change the wording, before publishing.

### Counsel wording cleanup 2026-11-04

- Privacy Policy 5.1: names Supabase, Cloudflare, Google Cloud, and GitHub (AES-256 encrypted backup archives only) as the providers that process Student Data; says source code, build pipelines, and developer tools receive no production customer data; GitHub is described as encrypted backup storage, not "cold" storage, which would be inaccurate for GitHub release assets.
- Precedence level 2 (Terms 2, DPA 11, Student Data Addendum 12, README) now reads "any Student Data Privacy Agreement, school-district rider, or state-specific data protection addendum signed with the Customer, and any term that applicable law requires to govern". No California-specific rider template is assumed.
- Student Data Addendum 3.4 (SOPIPA / Ed. Code 49073.1) is conditional: "to the extent the following laws apply".
- Incident timing: DPA 7 and Student Data Addendum 9 treat the notice periods as outside limits and commit to earlier notice where a law such as Civil Code 1798.82 requires it.
- All counsel `VERIFY` comments and the directory's editorial comment are removed. Two `E-DEPENDENCY` comments remain (DPA 8.3, Terms 14): they guard the workspace-purge dependency, which is still not live in production. The request referred to `docs/legal/student-data-addendum.md`; no such file exists, the Student Data Addendum is Part B of `student-privacy-notice.md`.
