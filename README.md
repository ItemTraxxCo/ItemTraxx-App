# ItemTraxx

Last updated: 2026-04-7 (year-month-day)

**ItemTraxx** is a cloud-based inventory, checkout, and administrative control platform built for schools, districts, organizations, and individual operators. It supports root-domain access on `itemtraxx.com`, custom-routed workspaces on `*.app.itemtraxx.com`, and role-based admin tooling across user, admin, and district/organization surfacing.

---

## 1. Product Overview
ItemTraxx is designed to manage real-world gear and inventory workflows without spreadsheet headaches. The platform currently supports:

- Member and operator checkout / return flows
- Tenant-admin inventory, student, and reporting tools
- District/organization-scoped workspaces and district/org admin controls
- Organization, district, and individual account structures
- Contact sales, request demo, and contact support form flows for easy contact and communication

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
- **District/Organization Admin:** Oversees district-linked tenants and district/org-level operations (beta)
- **Individual / Root-Domain Accounts:** Non-district/organization usage on `itemtraxx.com` without custom routing
- **Custom-Routed Users:** Access workspaces on custom scoped domains `*.app.itemtraxx.com` where applicable
- Internal ItemTraxx access roles are not listed here for securty purposes.
---

## 4. Tech Stack
- **Frontend:** Vue 3, Vite, TypeScript, scoped CSS, and HTML
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions) on AWS + Supabase Edge Runtime, Cloudflare Workers for edge proxying and Security Turnstile
- **Edge and Security:** Cloudflare Turnstile, Cloudflare Worker edge proxy, CSP/security headers, Cloudflare DNS
- **Hosting and Delivery:** Vercel, GitHub
- **Observability:** Vercel Web Analytics, Vercel Speed Insights, Sentry Error Monitoring, Cloudflare Analytics, Supabase Logs and Metrics, PostHog

---

## 5. Documentation
Public documentation in this repository is intentionally limited to product, legal, and security-facing material. Internal engineering runbooks, architecture notes, API contracts, onboarding docs, and operational procedures are maintained in a private internal documentation repository.

For public-facing repository context, see:

- [`README.md`](README.md) — Product overview and repository context
- [`CHANGELOG.md`](CHANGELOG.md) — Public product and engineering change history
- [`docs/README.md`](docs/README.md) — Public documentation notice

---

## 6. Governance and Legal
- [`CHANGELOG.md`](CHANGELOG.md) — Public product and engineering changes
- [`LICENSE.md`](LICENSE.md) — License and ownership
- [`PRIVACY.md`](PRIVACY.md) — Privacy policy
- [`SECURITY.md`](SECURITY.md) — Security reporting guidance
- [`TERMS.md`](TERMS.md) — Pointer to legal terms of use
- Live legal hub: [itemtraxx.com/legal](https://itemtraxx.com/legal#from?=github) for the most up-to-date legal documents and policies

---

## 7. Support
- Contact Support Via Website: [itemtraxx.com/contact-support](https://itemtraxx.com/contact-support#from?=github)
- Legal and Terms: [itemtraxx.com/legal](https://itemtraxx.com/legal#from?=github)
- Direct Support Email: `support@itemtraxx.com`

---

## 8. Repository Notes
This repository contains both the current production-facing surfaces and preserved legacy pages or flows that remain in the codebase for reference, migration safety, or staged rollout purposes.

---

**© 2026 ItemTraxx Co. All rights reserved.**
Empowering you with secure and efficient asset management.
