# ItemTraxx

Last updated: 2026-03-10 (year-month-day)

**ItemTraxx** is a cloud-based inventory, checkout, and administrative control platform built for schools, districts, organizations, and individual operators. It supports root-domain access on `itemtraxx.com`, district-routed workspaces on `*.app.itemtraxx.com`, and role-based admin tooling across tenant, district, and super-admin surfaces.

---

## 1. Product Overview
ItemTraxx is designed to manage real-world gear and inventory workflows without spreadsheet headaches. The platform currently supports:

- Member and operator checkout / return flows
- Tenant-admin inventory, student, and reporting tools
- District-scoped workspaces and district admin controls
- Super-admin management for tenants, districts, admins, and plan metadata
- Organization, district, and individual account structures
- Contact sales, request demo, and contact support form flows

---

## 2. Core Capabilities
- **Checkout and Return:** Fast barcode-based transaction flows with offline-aware handling
- **Inventory Management:** Track active, archived, lost, damaged, and returned assets
- **Student and User Management:** Maintain student rosters, admin access, and tenant-level controls
- **District Separation:** Route users to district-specific workspaces on `*.app.itemtraxx.com` when applicable
- **Reporting and Auditability:** Usage reports, audit logs, and operational history for admins
- **Support and Intake Flows:** Built-in sales, demo, and support submission forms with styled transactional emails
- **Plan Support:** District, organization, and individual pricing structures reflected on the pricing page

---

## 3. Roles and Access Model
ItemTraxx currently supports multiple operating roles:

- **Tenant Admin:** Manages inventory, students, settings, and tenant reporting
- **District Admin:** Oversees district-linked tenants and district-level operations
- **Super Admin:** Manages districts, tenants, admins, plans, and platform controls
- **Individual / Root-Domain Accounts:** Non-district usage on `itemtraxx.com` without district routing

---

## 4. Tech Stack
- **Frontend:** Vue 3, Vite, TypeScript, scoped CSS
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Edge and Security:** Cloudflare Turnstile, Cloudflare Worker edge proxy, CSP/security headers
- **Hosting and Delivery:** Vercel, GitHub
- **Observability:** Vercel Web Analytics, Vercel Speed Insights

---

## 5. Operations and Docs
Primary documentation index:

- [`docs/README.md`](docs/README.md) — Central docs index
- [`docs/architecture/system-overview.md`](docs/architecture/system-overview.md) — System architecture and request flows
- [`docs/release-checklist.md`](docs/release-checklist.md) — Release and rollback process
- [`docs/network-troubleshooting.md`](docs/network-troubleshooting.md) — DNS / firewall / sinkhole troubleshooting
- [`docs/support-playbook.md`](docs/support-playbook.md) — Support triage and escalation guidance
- [`docs/runbooks/edge-function-deploy.md`](docs/runbooks/edge-function-deploy.md) — Edge function deployment workflow
- [`docs/runbooks/tenant-auth-issues.md`](docs/runbooks/tenant-auth-issues.md) — Auth and login troubleshooting

---

## 6. Governance and Legal
- [`CHANGELOG.md`](CHANGELOG.md) — Product and engineering changes
- [`LICENSE.md`](LICENSE.md) — License and ownership
- [`PRIVACY.md`](PRIVACY.md) — Privacy policy
- [`SECURITY.md`](SECURITY.md) — Security reporting guidance
- [`TERMS.md`](TERMS.md) — Pointer to the live legal terms
- Live legal hub: [itemtraxx.com/legal](https://itemtraxx.com/legal)

---

## 7. Support
- Website: [itemtraxx.com](https://itemtraxx.com)
- Legal: [itemtraxx.com/legal](https://itemtraxx.com/legal)
- Support: `support@itemtraxx.com`

---

## 8. Repository Notes
This repository contains both the current production-facing surfaces and preserved legacy pages or flows that remain in the codebase for reference, migration safety, or staged rollout purposes.

---

**© 2026 ItemTraxx Co. All rights reserved.**
