# ItemTraxx Subprocessor Directory

**Last updated:** [[EFFECTIVE_DATE]]  
**Provider:** [[ENTITY_DESCRIPTION]] ("ItemTraxx," "we," "us")  
**Contact:** privacy@itemtraxx.com

ItemTraxx uses the service providers below to deliver the Service. This directory lists every provider that may process personal information on behalf of ItemTraxx and its customers, what it does, and what information it can receive. It supports the commitments in our [Privacy Policy](privacy-policy.md), [Student Privacy Notice and FERPA / SOPIPA Compliance Addendum](student-privacy-notice.md), and customer Data Processing Addendum.

**Student Data** means borrower usernames, borrower IDs, and checkout history in a customer's workspace, as defined in the Student Privacy Notice. Only Supabase, Cloudflare, and Google Cloud process Student Data; every other provider is configured not to receive it. Each provider is bound by a written agreement that requires protections at least as protective as our commitments to customers, and we remain responsible for the provider's handling of the data it receives from us.

## 1. Subprocessors

| Vendor | Purpose | Data transferred | Location |
|---|---|---|---|
| **Supabase** | Database, server functions, and file storage | All workspace data, including Student Data, and staff and account data | [[DATABASE_REGION]] |
| **Cloudflare** | Network delivery, DNS, and security | Request traffic in transit (including Student Data when staff use the app) and request metadata such as IP address, URL, and headers | Global edge network |
| **Google Cloud** | Backup storage for disaster recovery | Copies of the data held in Supabase, including Student Data | [[BACKUP_LOCATION]] |
| **Vercel** | Web application hosting and, with consent, web analytics | Request metadata; page-view and page-speed data | Global edge network |
| **Better Auth, Inc.** | Sign-in security services | Sign-in event data such as email, IP address, and device signals | United States |
| **PostHog** | Product analytics, error tracking, and session replay | Consent-based usage and diagnostic data with form inputs masked | United States |
| **Intercom** | Support chat | IP address, browser and device details; for signed-in users, account ID, email, and chat content | United States |
| **Resend** | Transactional and support email | Recipient email addresses, names, message content, delivery status | United States |
| **Slack** | Internal notifications | Contact and message details of people who contact us; error-report metadata | United States |
| **incident.io** | Incident alerting | Alert metadata, with no names, emails, or borrower data | United States |

## 2. Tools that do not receive customer data

Our source control, build, and security tools receive source code and dependency information, not customer data, and are not subprocessors of customer data. A customer's own identity provider, if it uses single sign-on, is the customer's vendor, not ours.

## 3. Changes to this directory

1. **Notice.** At least **30 days before** we add or replace a provider that will process Student Data or other customer personal information, we email the customer's workspace administrators and update this directory. Notices go to the administrator email addresses on file; to have notices also sent to another address, email privacy@itemtraxx.com.
2. **Objection.** A customer may object in writing to privacy@itemtraxx.com within the notice period on reasonable data-protection grounds. We will work with the customer in good faith. If we cannot resolve the objection, the customer may terminate the affected service and receive a refund of prepaid fees for the remaining term.
3. **Emergency replacement.** If we must replace a provider immediately to protect security or continuity, we will notify customers as soon as practicable and the same objection right applies.
4. **Removals.** We update this directory when a provider is removed.

## 4. Change log

| Date | Change |
|---|---|
| [[EFFECTIVE_DATE]] | Initial publication of this directory. |
