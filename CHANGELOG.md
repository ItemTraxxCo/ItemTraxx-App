# Changelog

Last updated (year-month-day): 2026-02-27

All notable changes to **ItemTraxx** will be documented in this file. This includes new features, improvements, bug fixes, and other updates.

This project adheres to **Semantic Versioning** where possible.

---

## Documentation Links
- [README.md](README.md) – Product overview and details
- [LICENSE.md](LICENSE.md) – Legal ownership and usage rights
- [LEGAL.md](LEGAL.md) - Legal overview and governing documents
- [TERMS.md](TERMS.md) – Terms of service for users
- [PRIVACY.md](PRIVACY.md) – Privacy policy and data handling
- [SECURITY.md](SECURITY.md) – Security reporting and guidelines

---

## Release Tags
- `v0.1.0-beta` — Initial frontend beta release and core tenant/admin workflows.
- `v0.2.0-beta` — Security hardening, proxy/Turnstile rollout, analytics, and admin UX stabilization.
- `v0.3.0-beta` — Super admin operations expansion, broadcast/status tooling, and advanced tenant controls.
- `v0.4.0-beta` — Identity hardening, tenant-side UX improvements, and CodeQL security fixes.

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
- Improved contact-sales submission success messaging to clearly confirm follow-up email delivery.
- Added observability/reliability foundations including async jobs, reporting views, and synthetic monitoring support.

---

##### You have reached the bottom of the changelog.
---

**© 2026 ItemTraxx Co. All rights reserved.**
All changes documented here are subject to company internal guidelines and versioning standards.
