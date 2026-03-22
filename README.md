# ItemTraxx

Last updated: 2026-03-10 (year-month-day)

**ItemTraxx** is a cloud-based inventory, checkout, and administrative control platform built for schools, districts, organizations, and individual operators. It supports root-domain access on `itemtraxx.com`, custom-routed workspaces on `*.app.itemtraxx.com`, and role-based admin tooling across user, admin, and district surfacing.

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
- **Checkout and Return:** Fast barcode-based transaction flows with offline-aware handling for an uninterrupted experience
- **Inventory Management:** Track active, archived, lost, damaged, and returned assets/items with full transparency 
- **Student and User Management:** Maintain borrower rosters, admin access, and tenant-level controls
- **Custom Separation:** Route users to custom-specific workspaces on `*.app.itemtraxx.com` when applicable
- **Reporting and Auditability:** Usage reports, audit logs, and operational history for admins 
- **Support and Intake Flows:** Built-in sales, demo, and support submission forms with styled transactional emails for maximizing communication
- **Plan Support:** School, organization, and individual pricing structures reflected on the pricing page

---

## 3. Roles and Access Model
ItemTraxx currently supports multiple operating roles:

- **Tenant Admin:** Manages inventory, students, settings, and tenant reporting
- **District Admin:** Oversees district-linked tenants and district-level operations (indev)
- **Individual / Root-Domain Accounts:** Non-district usage on `itemtraxx.com` without district routing

---

## 4. Tech Stack
- **Frontend:** Vue 3, Vite, TypeScript, scoped CSS, and HTML
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions) on AWS
- **Edge and Security:** Cloudflare Turnstile, Cloudflare Worker edge proxy, CSP/security headers, Cloudflare DNS
- **Hosting and Delivery:** Vercel, GitHub
- **Observability:** Vercel Web Analytics, Vercel Speed Insights, Sentry Error Monitoring, Google Analytics

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
- [`TERMS.md`](TERMS.md) — Pointer to legal terms of use
- Live legal hub: [itemtraxx.com/legal](https://itemtraxx.com/legal)

---

## 7. Support
- Contact Support Via Website: [itemtraxx.com/contact-support](https://itemtraxx.com/contact-support)
- Legal and Terms: [itemtraxx.com/legal](https://itemtraxx.com/legal)
- Support Email: `support@itemtraxx.com`

---

## 8. Repository Notes
This repository contains both the current production-facing surfaces and preserved legacy pages or flows that remain in the codebase for reference, migration safety, or staged rollout purposes.

---

**© 2026 ItemTraxx Co. All rights reserved.**
Empowering organizations with secure and efficient asset management.
