# Changelog

Last updated (year-month-day): 2026-03-10

All notable changes to **ItemTraxx** will be documented in this file. This includes new features, improvements, bug fixes, and other updates.

Changes are dated based on the default timezone: America/Los_Angeles

---

## Documentation Links
- [README.md](README.md) – Product overview and details
- [LICENSE.md](LICENSE.md) – Legal ownership and usage rights
- [LEGAL.md](LEGAL.md) - Legal overview and governing documents
- [TERMS.md](TERMS.md) – Terms of service for users
- [PRIVACY.md](PRIVACY.md) – Privacy policy and data handling
- [SECURITY.md](SECURITY.md) – Security reporting and guidelines


---

### 1/30/2026 Development Update

- Development for ItemTraxx started with backend-first implementation (tables, permissions, security controls, and edge functions).
- Frontend implementation was queued after backend foundations were established.

---

### 2/3/2026 Development Update

- Fixed documentation location and structure issues.
- Imported and stabilized the first CodeSandbox-origin project snapshot.

---

### 2/9/2026 Development Update

- Shipped the first frontend beta release to main.
- Fixed auth header handling and edge function integration issues.
- Added environment safety updates (`.env`/build artifact ignore rules) and initial project hardening.

---

### 2/10/2026 Development Update

- Resolved QA findings related to env-driven links, legal/logo references, and tenant login behavior.
- Improved CORS/error handling paths in tenant login and related frontend flows.

---

### 2/11/2026 Development Update

- Added Cloudflare edge proxy and Cloudflare Turnstile verification for login protection.
- Fixed admin re-auth bypass via browser back navigation.
- Fixed Vercel SPA 404 on hard reload via history-route fallback config.
- Added Vercel Web Analytics and Speed Insights at app root.
- Added CSP and security headers for all Vercel routes.
- Completed Round 1 user-feedback fixes across admin navigation, transaction UX, spacing, and search/log tooling.
- Hardened auth/admin edge function validation and improved toast-based error feedback.

---

### 2/13/2026 Development Update

- Improved wording/labels and error clarity across major user flows.

---

### 2/15/2026 Development Update

- Improved login UX and dark-mode contrast.
- Integrated incident-backed system status behavior.

---

### 2/17/2026 Development Update

- Added/expanded landing page experience and related UI refinements.
- Fixed sign-in loading-state bug.
- Removed tenant-admin management feature end-to-end where no longer needed.
- Added platform control operations and broadcast capabilities.
- Stabilized app responsiveness with timeout guards and dashboard load improvements.

---

### 2/18/2026 Development Update

- Added SEO crawl/index assets (`robots.txt`, `sitemap.xml`) and indexing improvements.
- Added brand discoverability/alternate-name SEO updates.
- Added SLA/incident UX and tenant admin barcode sticker PDF generator.
- Hardened CSP policy to explicitly support Google Fonts while preserving security controls.
- Updated tenant login flow for Aikido scan compatibility and security scanning requirements.
- Performed dependency maintenance updates (`tar`, `jspdf`).

---

### 2/19/2026 Development Update

- Implemented advanced filters across key admin data views.
- Added/expanded bulk import UX with validation reporting.
- Added tenant-admin idle auto-logout behavior.
- Updated app terminology from “gear” to more general “item/items” where appropriate.
- Polished SLA text and maintenance/banner UX behavior.

---

### 2/20/2026 Development Update

- Added tenant-side UX and identity hardening updates.
- Added checkout transaction receipt download from completion toast (PDF).
- Expanded student codename pools and increased generated username entropy.
- Added tenant settings and tenant notification feed enhancements.
- Added undo-capable toast actions for safer archive/status operations.
- Fixed CodeQL insecure-randomness findings by replacing `Math.random()` with CSPRNG-based generation (`crypto.getRandomValues`) in student identity generators (frontend + edge functions).
- Applied support contact consistency fixes.
- Performed latest dependency maintenance update.

---

### 2/21/2026 Development Update

- Performed dependency upgrade pass and updated frontend/build packages to latest compatible versions.
- Upgraded core dependencies including Supabase JS, Vue, Zod, Vite, Vue TSC, TypeScript node typings, and Vite Vue plugin.
- Kept `vue-router` on `v4.x` for current compatibility with Vercel Analytics and Speed Insights peer dependency requirements.
- Regenerated lockfile and validated with clean security audit and successful production build output.

---

### 2/22/2026 Development Update

- Added unified legal agreement route/page and updated legal experience copy/style.
- Shipped expanded Playwright E2E coverage (auth edge cases, suspended tenant flows, super-admin flows, export actions, and mobile viewport checks).
- Added CI hardening workflows and gates: core build checks, environment parity checks, deployment health probes, and workflow permission tightening.
- Added security automation and governance assets: SBOM generation/upload, security gate workflow integration, and API contract alignment for edge actions.
- Completed broad hardening pass across RBAC/RLS/security controls and stricter edge auth fail-closed behavior.
- Added observability/incident readiness documentation: request correlation guidance, alerting playbook, runbook checklist, and failure drill package.
- Added accessibility pass improvements targeting WCAG 2.2 AA semantics and keyboard behavior.
- Added database tuning/governance artifacts including index baselines, conditional index migration safety, query-plan guidance, and data-retention lifecycle SQL.
- Improved deployment health handling for Cloudflare challenge scenarios to reduce false-negative CI failures.
- Updated status links to `https://status.itemtraxx.com/` across app/docs.

---

### 2/23/2026 Development Update

- Added fully automated Supabase backup pipeline via GitHub Actions with encrypted artifacts and private repo push.
- Iterated backup reliability hardening:
  - fallback DB URL support
  - PostgreSQL 17-compatible dump execution via Docker
  - auto-detected backup repo branch
  - GitHub token/repo preflight validation
  - HTTPS auth fallback formats
  - GitHub API upload fallback
- Updated backup cadence to run twice daily.
- Added one-year retention cleanup policy for backup artifacts.
- Added scheduled dependency automation with grouped Dependabot updates for npm packages and GitHub Actions.
- Completed frontend performance optimization pass:
  - shared cached `system-status` service with stale-while-revalidate behavior
  - visibility-aware polling (pause/resume on tab hide/show)
  - deferred telemetry mount for faster startup
  - responsive landing media (`webp` variants + `picture/srcset`)
  - expanded preconnect/dns-prefetch hints
  - lightweight route transition progress indicator
  - idle route prefetch on public/login flows
  - export/PDF code-path isolation and lazy service split
  - CI image-budget checks plus deterministic bundle-budget checks
  - runtime perf telemetry capture for route/navigation timing
- Removed `zod` from the client input sanitizer path and replaced with lightweight native validation checks to reduce frontend overhead.

---

### 2/24/2026 Development Update

- Fixed edge CORS header behavior for stricter request compatibility.
- Added localhost/private-network maintenance bypass behavior for development environments.
- Added tenant-admin device session controls:
  - active device listing in tenant settings
  - revoke selected device
  - revoke all other devices
  - server-enforced session validation/touch checks
  - automatic tenant-admin re-auth redirect when a device session is revoked
- Added SQL support for tenant admin session persistence and indexing.

---

### 2/25/2026 Development Update

- Added public pricing experience:
  - new `/pricing` route/page
  - landing page CTA update from Contact Sales to Pricing
  - pricing FAQ and onboarding/billing detail sections
  - legal-policy link integrations
- Added public contact-sales workflow:
  - new `/contact-sales` route/page with required lead fields
  - enterprise-specific schools input
  - anti-spam protections (Turnstile + honeypot + server-side rate limit)
  - support inbox delivery + requester auto-reply
- Added `contact-sales-submit` edge function and Cloudflare allowlist update.
- Added sales data model and governance SQL:
  - `sales_leads` lifecycle fields and constraints
  - `customer_status_logs` invoice/payment tracking table
  - RLS policies and indexes
- Expanded super-admin sales operations:
  - Sales Leads page with staged workflow controls
  - close-lead and move-to-customers actions
  - Customers page with latest status rollup
  - per-invoice status history entries (`paid_on_time`, `paid_late`, `awaiting_payment`, `canceling`)
  - lead/customer detail modals and action tooling
- Added super-admin navigation links for Sales Leads and Customers across super pages.
- Added support in contact-sales function for existing secret naming (`ITX_TURNSTILE_SECRET`, `ITX_EMAIL_FROM`) with fallback compatibility.

---

### 2/26/2026 Development Update

- Completed UI refinement pass for super-admin Sales Leads table/modal density and readability.
- Added lead-state filtering and workflow ergonomics to keep open/closed/customer-converted pipelines clean.
- Fixed CI regressions on preview:
  - patched high-severity Rollup advisory by moving to secure `rollup@4.59.0`
  - updated mobile E2E landing assertion from old "Contact Sales" CTA to current "Pricing" CTA
- Hardened mobile E2E assertions to be resilient to landing-page trust-strip copy updates.
- Improved mobile pricing page rendering:
  - removed side gutters/white borders with full-bleed layout adjustments
  - fixed right-edge tile overflow on small viewports
  - added consistent horizontal content padding for pricing tiles/text
- Added pricing clarity copy under Core and Growth plan prices:
  - "Listed price excludes the 1st year onboarding fee."
- Refreshed lockfile dependency set after local update run:
  - Supabase JS family updates (`@supabase/*` 2.97.x -> 2.98.0)
  - `@types/node` update to latest patch release in lockfile
- Updated enterprise pricing contact information on the public pricing page.

---

### 2/27/2026 Development Update

- Added a global refresh-required overlay to block outdated client versions and prompt users to reload before continuing.
- Updated GitHub Actions dependencies by bumping `actions/upload-artifact` to `v7`.

---

### 2/28/2026 Development Update

- feat: automate changelog updates and improve last updated formatting in documents.

---

### 3/1/2026 Development Update

- Added account recovery UX improvements:
  - new `/forgot-password` route/page and login shortcut link
  - reset-flow copy and spacing refinements
- Added first-time onboarding modal system for tenant flows:
  - 5-step onboarding experiences for checkout/admin contexts
  - one-time local completion tracking with replay via top-right menu (`Take tour`)
  - route-context-aware onboarding variant selection
- Added offline transaction buffering and reconnect sync for checkout/returns:
  - local offline queue storage with automatic retry on reconnect
  - buffered-transaction status messaging in checkout/admin quick return flows
  - top-menu offline queue indicator with explanatory tooltip
- Updated student identity generation to shorter username format (`NameNameNNN`) across frontend and edge generation paths.
- Fixed edge function auth/gateway behavior for tenant operations by deploying with `--no-verify-jwt` where function-level auth validation is enforced.
- Updated login notification delivery architecture:
  - moved `login-notify` from async-job enqueue to direct email send
  - added branded HTML “New Login Detected” email template with plaintext fallback
- Added branded, standardized HTML templates for Supabase auth emails (signup confirmation, invite, magic link, password reset/change, email/phone change, identity link/unlink, MFA enroll/unenroll, reauth code).
- Improved contact-sales submission success messaging to clearly confirm follow-up email delivery.
- Added observability/reliability foundations including async jobs, reporting views, and synthetic monitoring support.
- Included additional maintenance updates across CI stability, changelog hygiene, and dependency refreshes.

---

### 3/2/2026 Development Update

- Added operational and engineering documentation set under `/docs`:
  - incident response guide
  - network troubleshooting guide (including DNS sinkhole diagnosis)
  - support playbook
  - release checklist
  - tenant-admin performance guide
  - onboarding feature spec
  - offline queue design
  - email templates guide
  - tenant auth issues runbook
  - edge function deployment runbook
- Added architecture documentation under `/docs/architecture`:
  - high-level system overview spanning frontend, edge proxy/functions, and Supabase domains
  - request flow diagrams for tenant login, checkout/return + offline sync, tenant admin ops, and super/internal async processing
  - CI/CD, security boundary, and combined end-to-end architecture diagrams

---

### 3/3/2026 Development Update

- Performed dependency maintenance update (`supabase`, Vue/tooling group) with green CI validation.

---

### 3/4/2026 Development Update

- Completed cleanup/security maintenance:
  - normalized docs structure and CI artifact handling
  - allowlisted the known unreachable `dompurify` advisory in the security gate
  - overrode `tar` to `7.5.10` to clear the high-severity audit advisory

---

### 3/5/2026 Development Update

- Completed the first major district-separation rollout:
  - district-scoped app routing and public district lookup support
  - district management and admin tooling in super admin
  - district session handoff foundation for root-host to district-host sign-in
- Added and updated test coverage for super-admin and district flows.
- Applied additional dependency/security maintenance (`dompurify`, `supabase`) and bundle-budget adjustments required for the new routing/auth work.
- Improved tenant-admin session handling and related auth/session coordination.
- Updated public-home transaction history handling to include retention-policy details.

---

### 3/6/2026 Development Update

- Enabled row-level security on remaining internal helper tables related to data retention and rate limiting.
- Began the large UI rollout:
  - redesigned auth flows and marketing surfaces into the new visual system
  - introduced the new landing page concept and supporting page refinements

---

### 3/7/2026 Development Update

- Completed broad UI and platform rollout:
  - promoted the redesigned landing page direction and refreshed major auth/admin surfaces
  - added first-class individual-plan support across pricing, super admin, and tenant admin
  - converted `Contact Sales`, `Request Demo`, and `Contact Support` into form-driven flows
- Compressed landing screenshots and updated CI/E2E checks to match the new landing/admin copy and visuals.
- Performed platform cleanup/performance pass:
  - reduced background request churn
  - tightened polling behavior
  - cached repeated super-admin option loads

---

### 3/8/2026 Development Update

- Refined public commercial/legal flows:
  - improved demo-request behavior
  - updated billing/legal wording and related pricing guidance

---

### 3/9/2026 Development Update

- Performed dependency maintenance update (`supabase` and Vue group).
- Hardened district auth/bootstrap behavior:
  - removed plaintext password persistence from district handoff records
  - fixed district-route bootstrap and router-init blank-page cases
  - improved district refresh/reload reliability for protected routes

---

### 3/10/2026 Development Update

- Enhanced new landing-page hero copy/feature wording.

---

### 3/11/2026 Development Update

- Added CodeQL security analysis workflow with repo-managed configuration and Slack alerting integration.
- Implemented CI alerting to notify Slack on workflow failures.
- Improved CI permissions and workflow stability with explicit permission declarations.
- Performed dependency maintenance update (npm and yarn group).
- Held Vercel packages below vulnerable major versions.

---

### 3/12/2026 Development Update

- Added `security.txt` disclosure file for security vulnerability reporting guidance.

---

### 3/13/2026 Development Update

- Performed dependency maintenance update (npm and yarn group with 5 updates).

---

### 3/14/2026 Development Update

- Fixed UI layout issue where top banners were removed from document flow on public pages.
- Ensured consistent banner positioning across public experience.
- Completed database/backend updates, scheduled maintenance

---

### 3/15/2026 Development Update

- Performed comprehensive bugfix round including auth, email, and UI refinements:
  - Fixed auth sign-out to redirect to root login from custom hosts (district subdomains).
  - Fixed district handoff redirects to preserve same-tab navigation behavior.
- Applied styled HTML email templates for sales inquiry sends.
- Implemented email send throttling (1 req/sec) in background worker to prevent rate-limiting issues.
- Added Slack notification routing for inquiry/sales contact alerts.
- Updated `.gitignore` to exclude Supabase CLI temporary files.

---

### 3/17/2026 Development Update

- Fixed edge proxy to allow Vercel preview origins for deploy preview compatibility.
- Updated forgot-password reset email instructions to include support contact information.

---

### 3/18/2026 Development Update

- Enhanced Turnstile integration with improved error handling and user feedback on verification failures.
- Updated login flow to automatically redirect authenticated users to client area (preventing manual navigation to login).
- Added auth domain canonicalization to redirect `www` subdomain to apex domain before bootstrap.
- Implemented immediate redirect on home mount for already-logged-in users.
- Added performance telemetry and RUM (Real User Monitoring) ingestion documentation.
- Updated `.gitignore` to exclude system-generated files and artifacts.

---

### 3/19/2026 Development Update

- Completed a production security remediation pass:
  - enforced server-side Turnstile validation on privileged auth paths
  - removed raw token persistence from district handoff flows
  - reviewed and corrected production auth settings, DB grants/policies, and storage ACLs
  - removed an orphaned remote `create-tenant` edge function
  - completed live validation of the remediated findings
- Added an operations maintenance checklist runbook for recurring DevOps and security hygiene.

---

### 3/20/2026 Development Update

- Upgraded GitHub Actions Slack notifications:
  - added live run start/finish status reporting
  - matched deployment-style colored status attachments in Slack
  - added webhook fallback when bot-token posting is unavailable
- Pinned third-party GitHub Actions to immutable commit SHAs for CI supply-chain hardening.
- Expanded developer onboarding docs:
  - added a Windows/WSL2 onboarding guide
  - documented the personal dev-branch workflow (`dev/<github-username>`)

---

### 3/21/2026 Development Update

- Added Sentry monitoring with environment-driven frontend configuration.
- Added privacy-safe Sentry session replay for enhanced error monitoring
- Lazy-loaded Sentry bootstrap and Replay integration to preserve frontend bundle budgets and keep CI green.
- Updated public/login UX:
  - added app version display to the landing-page footer
  - added a compact-height `/login` back button when the story panel is hidden
  - hid the top-right `Log Out User` action on `/login`
  - disabled and greyed the `Sign in` button until credentials and Turnstile are ready, and kept it disabled during submit
- Applied small public-page copy/navigation refinements on Contact Sales, Contact Support, and the landing page.
- Completed checkout onboarding and auth UI refinements.
- Fixed sales request submission by updating Supabase dependencies and addressing dependency conflicts.
- Performed dependency maintenance update (npm and yarn group with 4 updates).
- Adjusted status label on org readme.md file
- Performed routine documentation updates


---

##### You have reached the bottom of the changelog.
---

**© 2026 ItemTraxx Co. All rights reserved.**
All changes documented here are subject to company internal guidelines and versioning standards.
