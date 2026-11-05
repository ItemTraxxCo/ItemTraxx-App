# ItemTraxx Subprocessor Directory

**Last updated:** [[EFFECTIVE_DATE]]  
**Provider:** [[ENTITY_DESCRIPTION]] ("ItemTraxx," "we," "us")  
**Contact:** privacy@itemtraxx.com

ItemTraxx uses the service providers below to deliver the Service. This directory lists every provider that may process personal information on behalf of ItemTraxx and its customers, what it does, and what information it can receive. It supports the commitments in our [Privacy Policy](privacy-policy.md), [Student Privacy Notice and FERPA / SOPIPA Compliance Addendum](student-privacy-notice.md), and customer [Data Processing Addendum](dpa.md).

**Student Data** means borrower usernames, borrower IDs, and checkout history in a customer's workspace, as defined in the Student Privacy Notice and FERPA / SOPIPA Compliance Addendum. Only Supabase, Cloudflare, Google Cloud, and GitHub (which stores backups only in encrypted form) process Student Data; providers not listed here do not receive Student Data from ItemTraxx. Our email and incident-alert messages are built without borrower fields. Each provider is bound by a written agreement that requires protections at least as protective as our commitments to customers, and we remain responsible for the provider's handling of the data it receives from us.

## 1. Subprocessors

| Vendor | Purpose | Data transferred | Location |
|---|---|---|---|
| **Supabase** | Database, server functions, and file storage | All workspace data, including Student Data, staff and account data, support attachments, and error reports | [[DATABASE_REGION]] |
| **Cloudflare** | Network delivery, DNS, and security | Request traffic in transit (including Student Data when staff use the app) and request metadata such as IP address, URL, and headers | Global edge network |
| **Google Cloud** | Runs the scheduled database backup job for disaster recovery | Copies of the data held in Supabase, including Student Data, while a backup is created and encrypted | [[BACKUP_LOCATION]] |
| **GitHub** | Private storage of encrypted database backups for disaster recovery | Encrypted copies of the production database, including Student Data; GitHub cannot read the contents | United States |
| **Vercel** | Web application hosting and, with consent, web analytics | Request metadata; page-view and page-speed data | Global edge network |
| **Better Auth, Inc.** | Sign-in security services | Sign-in event data such as email, IP address, and device signals | United States |
| **PostHog** | Server-side security and operations monitoring and logs (always on); client-side product analytics, diagnostic logs, and session replay (only with consent) | Server-side: request route, method, status, timing, request ID, user agent, edge-function logs, and keyed one-way hashes of IP address and session credential. Client-side, with consent: usage and diagnostic data with form inputs masked | United States |
| **Intercom** | Support chat | IP address, browser and device details; for signed-in users, account ID, email, and chat content | United States |
| **Resend** | Transactional and support email | Staff and administrator email addresses and names, the content of sign-in, invitation, password-reset, verification, and notification emails, and delivery status; no borrower data | United States |
| **Slack** | Internal notifications | Contact and message details of people who contact us; for each error report, a summary with the report ID, error name, environment, release, role, workspace ID, and request ID | United States |
| **incident.io** | Incident alerting | Alert metadata such as alert type, page route, request ID, and a one-way hashed network identifier; no names, emails, or borrower data | United States |

## 2. Tools that do not receive customer data

Our source control, build, and security tools (such as GitHub's code repositories and build service) receive source code and dependency information, not customer data. GitHub's separate role in storing encrypted backups is listed above. A customer's own identity provider, if it uses single sign-on, is the customer's vendor, not ours.

## 3. Changes to this directory

1. **Notice.** At least **30 days before** we add or replace a provider that will process Student Data or other customer personal information, we email the customer's workspace administrators and update this directory. Notices go to the administrator email addresses on file; to have notices also sent to another address, email privacy@itemtraxx.com.
2. **Objection.** A customer may object in writing to privacy@itemtraxx.com within the notice period on reasonable data-protection grounds. We will work with the customer in good faith. If we cannot resolve the objection, the customer may terminate the affected service and receive a refund of prepaid fees for the remaining term.
3. **Emergency replacement.** If we must replace a provider immediately to protect security or continuity, we will notify customers as soon as practicable and the same objection right applies.
4. **Removals.** We update this directory when a provider is removed.

## 4. Change log

| Date | Change |
|---|---|
| [[EFFECTIVE_DATE]] | Initial publication of this directory. |
