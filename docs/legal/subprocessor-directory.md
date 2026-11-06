# ItemTraxx Subprocessor Directory

**Last updated:** [[EFFECTIVE_DATE]]  
**Provider:** [[ENTITY_DESCRIPTION]] ("ItemTraxx," "we," "us")  
**Contact:** privacy@itemtraxx.com

ItemTraxx uses the service providers below to deliver the Service. This directory lists every provider that may process personal information on behalf of ItemTraxx and its customers, what it does, and what information it can receive. It covers Customer Data across customer workspaces (such as asset records, borrower and checkout history, and account data for administrators and users). It supports the commitments in our [Privacy Policy](privacy-policy.md), [Student Privacy Notice and FERPA / SOPIPA Compliance Addendum](student-privacy-notice.md), and customer [Data Processing Addendum](dpa.md).

For educational customers subject to FERPA, SOPIPA, or related student privacy standards, our [Student Privacy Notice and FERPA / SOPIPA Compliance Addendum](student-privacy-notice.md) also applies. In those workspaces, Supabase, Cloudflare, Google Cloud, and GitHub (which stores backups solely in encrypted form) are the only subprocessors authorized to store or process Student Data. Operational alerts, telemetry, and error logs do not contain borrower or student records. Customers are advised not to submit borrower or student personal data through support channels

## 1. Subprocessors

| Vendor | Purpose | Data transferred | Location |
|---|---|---|---|
| **Supabase** | Database, server functions, and file storage | All workspace data, including Student Data, staff and account data, support attachments, and error reports | [[DATABASE_REGION]] |
| **Cloudflare** | Network delivery, DNS, and security | Request traffic in transit (including Student Data when staff use the app) and request metadata such as IP address, URL, and headers | Global edge network |
| **Google Cloud** | Runs the scheduled database backup job for disaster recovery | Copies of the data held in Supabase, including Student Data, while a backup is created and encrypted | [[BACKUP_LOCATION]] |
| **GitHub** | Private storage of encrypted database backups for disaster recovery | Encrypted copies of the production database, including Student Data; GitHub cannot read the contents | United States |
| **Vercel** | Web application hosting and, with consent, web analytics | Request metadata; page-view and page-speed data | Global edge network |
| **Better Auth, Inc.** | Sign-in security services | Sign-in event data such as email, IP address, and device signals | United States |
| **PostHog** | Security and operational monitoring; product analytics with consent | Operational and diagnostic information; product usage and session replay data only with consent | United States |
| **Intercom** | Customer support messaging | IP address, device metadata, cookies; for signed-in users, name, email address, and support messages | United States |
| **Resend** | Transactional and support email | Staff and administrator email addresses and names, the content of sign-in, invitation, password-reset, verification, and notification emails, and delivery status; no borrower data | United States |
| **Slack** | Internal operational notifications and alert routing | System status notifications, technical error summaries, and inbound support/sales inquiries | United States |
| **incident.io** | Security and uptime incident alerting | Operational telemetry, system event metadata, and technical diagnostics (no student or borrower data) | United States |

## 2. Tools that do not receive customer data

Our source control, build, and security tools (such as GitHub's code repositories and build service, and Aikido Security for code analysis, cloud configuration scanning, and penetration testing) receive source code, dependency information, and system metadata, not customer data. GitHub's separate role in storing encrypted backups is listed above. A customer's own identity provider, if it uses single sign-on, is the customer's vendor, not ours

## 3. Changes to this directory

1. **Notice.** At least **30 days before** we add or replace a provider that will process Student Data or other customer personal information, we email the customer's workspace administrators and update this directory. Notices go to the administrator email addresses on file; to have notices also sent to another address, email privacy@itemtraxx.com.
2. **Objection.** A customer may object in writing to privacy@itemtraxx.com within the notice period on reasonable data-protection grounds. We will work with the customer in good faith. If we cannot resolve the objection, the customer may terminate the affected service and receive a refund of prepaid fees for the remaining term.
3. **Emergency replacement.** If we must replace a provider immediately to protect security or continuity, we will notify customers as soon as practicable and the same objection right applies.
4. **Removals.** We update this directory when a provider is removed.

## 4. Change log

| Date | Change |
|---|---|
| November 4, 2026 | Initial publication of this directory. |
