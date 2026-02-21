# Changelog

Last updated (year-month-day): 2026-02-21

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

##### You have reached the bottom of the changelog.
---

**© 2026 ItemTraxx Co. All rights reserved.**
All changes documented here are subject to company internal guidelines and versioning standards.
