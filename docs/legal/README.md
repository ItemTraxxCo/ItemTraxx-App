# ItemTraxx legal documents

Source of truth for ItemTraxx's public legal documents. Each `*.md` file here is rendered on the website as plain Markdown. Editing a file here changes the live page after the next deploy.

These are drafts for counsel review, not legal advice. Open questions and the full change history are in [`../legal-revision-log.md`](../legal-revision-log.md). The audit behind the structure is in [`../legal-architecture-blueprint.md`](../legal-architecture-blueprint.md).

## 1. The seven documents

| File | Page | What it covers |
|---|---|---|
| [`terms-of-service.md`](terms-of-service.md) | `/legal/terms` (`/terms` redirects) | The contract with every Customer: the service, accounts, acceptable use, fees and renewal, warranties, liability, DMCA, governing law. Section 2 sets the order of precedence. |
| [`privacy-policy.md`](privacy-policy.md) | `/legal/privacy`, `/privacy` | What personal information we collect and why, for website visitors, staff users, and borrowers; retention; rights (including the California Notice at Collection and the appeal process). |
| [`dpa.md`](dpa.md) | `/legal/dpa` | The **general** Data Processing Addendum. It applies to every Customer (school or business): roles, security, subprocessors, incidents, deletion, CCPA/CPRA service-provider terms, Annex A (processing description), Annex B (directory link). |
| [`student-privacy-notice.md`](student-privacy-notice.md) | `/legal/student-privacy` | Part A: plain-language notice for schools, parents, and students. Part B: the **Student Data Addendum** (FERPA, COPPA, SOPIPA, Cal. Ed. Code 49073.1), which adds to the DPA when a Customer submits Student Data. |
| [`subprocessor-directory.md`](subprocessor-directory.md) | `/legal/subprocessors` | The single current list of subprocessors (vendor, purpose, data, location) and the 30-day change-notice and objection process. |
| [`cookie-notice.md`](cookie-notice.md) | `/legal/cookies`, `/cookies` | Every cookie and kind of browser storage, essential vs consent-gated, and how consent is recorded. |
| [`vulnerability-disclosure-policy.md`](vulnerability-disclosure-policy.md) | `/legal/vdp` | Rules and safe harbor for security researchers; the `security.txt` fields. |

`/legal` is an index page that links to all seven. Old URLs (`/privacy`, `/cookies`, `/terms`) are kept as aliases.

### How the DPA and the Student Data Addendum fit together

- `dpa.md` is the **general business-to-business DPA**. It is complete for any Customer and does not repeat Student Data rules.
- Part B of `student-privacy-notice.md` is the **Student Data Addendum**. It governs the purposes and limits for Student Data, parent and student access, the 72-hour incident notice, and Student Data deletion. DPA Sections 2, 3, and 5.4 point to it.
- Precedence when documents conflict on a data protection matter (the same six levels appear in Terms Section 2, DPA Section 11, and Part B): (1) the executed agreement or Order Form; (2) a signed Student Data Privacy Agreement or California school rider, if one has been executed; (3) the Student Data Addendum; (4) the DPA; (5) the Terms of Service; (6) the Privacy Policy and Part A of the Student Privacy Notice.
- The subprocessor list lives only in `subprocessor-directory.md`. Other documents link to it and do not repeat it.
- Root `DPA.md` is a short pointer to `dpa.md`.

## 2. How the files reach the site

- `src/legal/sources.ts` uses `import.meta.glob(["../../docs/legal/*.md", "!../../docs/legal/README.md"], { query: "?raw" })`. Every Markdown file in this folder **except this README** is bundled as a lazy chunk, loaded only when someone opens a legal page. The README is never bundled or routed.
- `src/legal/documents.ts` is the registry (slug, title, path, source file). A new document must be added there and to the route-title map in `src/legal/routeTitles.ts`, or it will not be routable.
- `src/legal/markdown.ts` converts Markdown with `marked`, sanitizes with DOMPurify, rewrites links between documents (`other-doc.md` becomes `/legal/<slug>`), and substitutes tokens. HTML comments are stripped, so `<!-- VERIFY ... -->` notes never appear on the site.
- `src/pages/LegalDocumentPage.vue` renders the result as plain prose and tables. Most `/legal/*` pages are prerendered by `scripts/prerender-public.mjs` and listed in `public/sitemap.xml` (`dpa` is not prerendered yet).
- The bundle budget is tight (`npm run perf:initial`), so keep the markdown libraries inside the lazy page and out of the router.

### `docs/legal-revision-log.md`

[`../legal-revision-log.md`](../legal-revision-log.md) sits **outside** this folder on purpose, so the glob never bundles it and it is never published. It records, per file, what changed and why, the open items, and the cross-document consistency report. Update it whenever a legal document changes.

## 3. Placeholder tokens

Write `[[TOKEN]]` in a document. Values are set in `src/legal/legalTokens.ts`.

- A token with a value renders as that text.
- A token with no value renders as a yellow "pending" mark on the live page, so unfinished text is never mistaken for final text.
- `LEGAL_PENDING_TOKENS` lists the tokens that are deliberately still open (currently none). A unit test allows only those to stay unresolved and fails on any other.

Current tokens: `EFFECTIVE_DATE`, `ENTITY_DESCRIPTION`, `MAILING_ADDRESS`, `GOVERNING_COUNTY`, `DATABASE_REGION`, `BACKUP_LOCATION`, `BACKUP_RETENTION_DAYS`, `ANALYTICS_RETENTION`, `DATA_BREACH_CAP`, `OTHER_DATA_INCIDENT_NOTICE`, and `ERROR_REPORT_RETENTION_DAYS`.

## 4. Editing rules

1. Do not state a fact that is not true of the code or the infrastructure. Check the code first and note the change in the revision log.
2. Use "workspace" (not "tenant"), "Customer Data", and "Student Data".
3. Do not publish internal detail: no storage key names beyond what the cookie notice needs, no endpoint or host names, no thresholds, no vendor configuration.
4. Keep `<!-- VERIFY ... -->` and `<!-- E-DEPENDENCY ... -->` comments for anything unconfirmed. Search for them before publishing: `grep -rn "VERIFY\|E-DEPENDENCY" docs/legal`.
5. After any edit run `npm run build`, `npx vitest run src/legal`, and `npm run perf:initial`.

## 5. Status of unresolved items (checked 2026-11-04)

- **Workspace deletion is not live in production.** The migrations `20261104120000`, `20261104130000`, and `20261104140000` are not applied to the production database, and the deployed `job-worker` predates them. The 30-day recovery and automated purge described in the Terms, DPA, Privacy Policy, and Student Data Addendum depend on both.
- **Backup pruning is pending.** The backup workflow, script default, and README in `itemtraxx-backups` now say 30 days (checked 2026-11-04), but older releases are deleted only after the next backup run. Until then the 30-day statement is not yet true.
- **Open tokens:** none. `OTHER_DATA_INCIDENT_NOTICE` is 72 hours and `ERROR_REPORT_RETENTION_DAYS` is 90.
- **Error-report retention is not enforced in production.** No job deletes `client_error_reports` at 90 days; see the revision log.
- **For counsel:** the California school rider reference (no template exists in the repo), Civil Code 1798.82 timing against the 72-hour deadline, the SOPIPA / Ed. Code 49073.1 characterization, DMCA agent registration, and the survival clause in Terms Section 14.
- **Not verified:** subprocessors' own contract terms on model training (ItemTraxx itself uses no AI in production, confirmed 2026-11-04); provider locations for Better Auth, Intercom, Resend, Slack, incident.io, and GitHub (listed as "United States").

## 6. Where the statements come from

| Statement | Evidence |
|---|---|
| Sign-in cookies `__Secure-better-auth.session_token` (up to 7 days), `.two_factor` (10 min), `.better-auth-passkey` (5 min), `__infra-rid` (10 min) | `cloudflare/edge-proxy/src/auth.ts` (`session`, `advanced`, `twoFactor`, `passkey` config) and the installed Better Auth defaults |
| Sessions up to 7 days; passwords of at least 12 characters | `cloudflare/edge-proxy/src/auth.ts` |
| Offline conflicts resolve only on the creating account and device; Quick Return needs a Workspace Admin | `supabase/functions/offline-checkout/index.ts` |
| Emails and incident alerts carry no borrower fields | `cloudflare/edge-proxy/src/{passwordResetDelivery,accountEmailDelivery,observability}.ts`, `supabase/functions/{job-worker,login-notify}/index.ts` |
| Error reports store hashes of a network identifier; always on | `supabase/functions/client-error-report/index.ts`, `src/services/clientErrorReportService.ts` |
| Production database region | Supabase project `us-west-1`; backup job VM zone `us-west1-b`; encrypted backups stored as GitHub release assets (`itemtraxx-backups` repository) |
| No AI or machine-learning provider receives Customer Data | No such integration in `src`, `supabase/functions`, or `cloudflare/edge-proxy/src` |
| Consent cookie names, 1-year duration, cross-tab sync | `src/services/cookieConsentService.ts` |
| Analytics and diagnostics opt-in; replay needs both | `src/services/cookieConsentService.ts`, `src/services/posthogService.ts` |
| Offline pack: 24-hour expiry, encrypted queue, 25 MB cap | `src/services/offlineCheckoutWorkflow.ts`, `supabase/functions/offline-checkout/index.ts` |
| Borrower purge keeps history; 30-day workspace purge and certificate | `supabase/migrations/20261104120000_*.sql`, `20261104130000_*.sql`, `supabase/functions/job-worker/workspacePurge.ts` |
| Acceptance record fields | `supabase/migrations/20261104140000_legal_acceptance_audit_trail.sql` |
| Security headers, HSTS preload | `vercel.json` |
