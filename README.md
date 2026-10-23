# ItemTraxx

Last updated: 2026-07-25 (year-month-day)

**ItemTraxx** is a cloud-based inventory, checkout, and administrative control platform built for schools and organizations. It supports root-domain access on `itemtraxx.com`, custom-routed workspaces on `*.app.itemtraxx.com`, and role-based tooling for Tenant Accounts, Workspace Admins, and Super Admins.

---

## 1. Product Overview
ItemTraxx is designed to manage real-world items and inventory workflows without spreadsheet headaches. The platform currently supports:

- Member and operator checkout / return flows
- Workspace Admin item, borrower, account, and reporting tools
- Tenant Account checkout, return, permitted item/borrower views, and personal settings
- Workspace-scoped access with optional item and borrower grants per Tenant Account
- Contact sales, request demo, and contact support form flows for easy contact and communication

---

## 2. Core Capabilities
- **Checkout and Return:** Fast barcode-based transaction flows with offline-aware handling for an uninterrupted experience
- **Inventory Management:** Track active, archived, lost, damaged, and returned assets/items with full transparency 
- **Borrower and Account Management:** Maintain borrower rosters, account access, and workspace controls
- **Custom Separation:** Route users to custom-specific workspaces on `*.app.itemtraxx.com` when applicable
- **Reporting and Auditability:** Usage reports, audit logs, and operational history for admins 
- **Support and Intake Flows:** Built-in sales, demo, and support submission forms with styled transactional emails for maximizing communication
- **Plan Support:** School, organization, and individual pricing structures reflected on the pricing page

---

## 3. Roles and Access Model
ItemTraxx currently supports multiple operating roles:

- **Tenant Account:** Checks out and returns items, views permitted items and borrowers, and manages its own settings
- **Workspace Admin:** Manages items, borrowers, Tenant Accounts, workspace settings, and reporting
- **Super Admin:** Manages workspaces and platform-wide administrative controls
- **Custom-Routed Users:** Access workspaces on scoped domains under `*.app.itemtraxx.com` where applicable
- Internal ItemTraxx access roles are not listed here for securty purposes.
---

## 4. Tech Stack
- **Frontend:** Vue 3, Vite, TypeScript, scoped CSS, and HTML
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions) on AWS + Supabase Edge Runtime, Cloudflare Workers for edge proxying and Security Turnstile
- **Edge and Security:** Cloudflare Turnstile, Cloudflare Worker edge proxy, CSP/security headers, Cloudflare DNS
- **Hosting and Delivery:** Vercel, GitHub
- **Observability:** Vercel Web Analytics, Vercel Speed Insights, PostHog Error Tracking and Logs, Cloudflare Analytics, Supabase Logs and Metrics, and OpenTelemetry trace correlation for backend request paths

---

## 5. Documentation
Public documentation in this repository is intentionally limited to product, legal, and security-facing material. Internal engineering runbooks, architecture notes, API contracts, onboarding docs, and operational procedures are maintained in a private internal documentation repository.

For public-facing repository context, see:

- [`README.md`](README.md) — Product overview and repository context
- [`CHANGELOG.md`](CHANGELOG.md) — Public product and engineering change history
- [`docs/README.md`](docs/README.md) — Public documentation notice

### Observability delivery

The browser uses consent-gated PostHog Error Tracking for unhandled exceptions,
rejected promises, and explicitly captured boundary failures. Error events keep
source-map-relevant stack frames while scrubbing messages, URLs, credentials,
cookies, request bodies, and unnecessary personal data. PostHog console capture
is disabled; application logs are emitted only through explicit structured
helpers.

Production builds emit hidden source maps during the build. Configure `POSTHOG_CLI_HOST`,
`POSTHOG_CLI_PROJECT_ID`, and a short-lived `POSTHOG_CLI_API_KEY` with Error
Tracking write scope in the deployment environment, then run
`npm run observability:upload-sourcemaps` against the same `dist` directory
before serving it. The helper injects the `itemtraxx-web` release metadata,
uploads the maps, and removes local map files after upload. Builds without the
CLI credentials skip the upload and remove generated map files so they are not
served accidentally; the application build remains successful.

Supabase Edge Functions emit W3C trace context and sampled OTLP spans to the
configured PostHog traces endpoint. Cloudflare's Worker propagates the trace
context and emits structured completion logs to the existing Cloudflare log
bridge, which promotes the JSON trace fields into OTLP log correlation; it does
not send a second browser-wide tracing stream. Configure the
server-only `ITX_POSTHOG_PROJECT_TOKEN`, `ITX_POSTHOG_TRACES_ENDPOINT`,
`ITX_OTEL_SERVICE_NAME`, and sampling variables where backend traces are
enabled. Keep these values out of `VITE_*` environment variables.

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
