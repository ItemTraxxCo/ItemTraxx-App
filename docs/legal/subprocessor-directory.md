# ItemTraxx Subprocessor Directory

**Last updated:** [[EFFECTIVE_DATE]]
**Provider:** [[ENTITY_DESCRIPTION]] ("ItemTraxx," "we," "us")
**Contact:** privacy@itemtraxx.com

ItemTraxx uses the service providers below to deliver the Service. This directory lists every provider that may process personal information on behalf of ItemTraxx and its customers, what it does, and what information it can receive. It supports the commitments in our [Privacy Policy](privacy-policy.md), [Student Privacy Notice and FERPA / SOPIPA Compliance Addendum](student-privacy-notice.md), and customer Data Processing Addendum.

## 1. How to read this directory

- **Student Data** means borrower usernames, borrower IDs, and checkout history in a customer's workspace, as defined in the Student Privacy Notice. Providers in **Group A** process Student Data. Providers in **Group B** are configured **not** to receive it.
- **Staff and account data** means staff emails and names, roles, session and device records, and sign-in events.
- Providers may process data in the United States and, for network delivery (for example Cloudflare's edge), in other locations where they operate.
- Each provider is bound by a written agreement that requires protections at least as protective as our commitments to customers, and we remain responsible for the provider's handling of the data it receives from us.

## 2. Group A: providers that process Student Data

| Provider | Service we use | Customer data it can process | Location |
|---|---|---|---|
| **Supabase** | Primary database, server functions, and file storage | All workspace data (Student Data, items, logs, staff and account data, support attachments) | [[DATABASE_REGION]] |
| **Cloudflare** | Network edge, DNS, DDoS and bot protection, Workers (our API and authentication gateway and its logs), key-value store, object storage for organization logos, Turnstile | Request traffic in transit (which includes Student Data when staff use the app), request metadata (IP address, URL, headers), request logs, logos | Global edge network |
| **Google Cloud** | Storage for backups of our database | Copies of the data held in Supabase, including Student Data, for disaster recovery | [[BACKUP_LOCATION]] |

## 3. Group B: providers configured not to receive Student Data

| Provider | Service we use | Information it can receive | Customer-data safeguards |
|---|---|---|---|
| **Vercel** | Hosts the web application; Web Analytics and Speed Insights (only with your analytics consent) | Request metadata (IP address, URL, user agent); page-view and page-speed data | Hosts the static application only; analytics are consent-based and cookieless |
| **Better Auth, Inc.** | Hosted abuse-detection and dashboard services used with the authentication software we run | Sign-in event data (such as email, IP address, device signals) and account records | Staff and account data only; no borrower or checkout data |
| **PostHog** (United States cloud, via our subdomain `j.itemtraxx.com`) | Analytics, error tracking, session replay, and operational telemetry | Consent-based browser data; scrubbed error reports; security telemetry with hashed IP and session identifiers | Inputs and borrower fields are masked in replay; error reports are scrubbed; optional features need consent |
| **Intercom** | Support chat | IP address, browser and device details, page, cookies; for signed-in users, account ID, email, and chat content | Users are told not to enter student information; we delete any we find |
| **Resend** | Sends transactional and support email (invitations, password resets, email-change approvals, sign-in notices, support replies) | Recipient email addresses, names, message content, delivery status | No borrower data in messages |
| **Slack** | Internal operations alerts | Contact details and message details of people who contact us; error-report metadata (error name, release, role, workspace ID, request ID) | No borrower data in alerts |
| **incident.io** | Security and uptime paging | Attack type, route, request ID, keyed hashes of IP and account identifiers | No names, emails, or borrower data |

## 4. Tools that do not receive customer data

Our source control, build, and security tools (for example GitHub and Aikido Security) receive source code and dependency information, not customer data. They are listed for transparency and are not subprocessors of customer data. A customer's own identity provider, if it uses single sign-on, is the customer's vendor, not ours.

## 5. Changes to this directory

1. **Notice.** At least **30 days before** we add or replace a provider that processes Student Data (Group A), and before we add a Group B provider that will handle customer personal information, we email the customer's workspace administrators and update this directory. Notices go to the administrator email addresses on file; to have notices also sent to another address, email privacy@itemtraxx.com.
2. **Objection.** A customer may object in writing to privacy@itemtraxx.com within the notice period on reasonable data-protection grounds. We will work with the customer in good faith. If we cannot resolve the objection, the customer may terminate the affected service and receive a refund of prepaid fees for the remaining term.
3. **Emergency replacement.** If we must replace a provider immediately to protect security or continuity, we will notify customers as soon as practicable and the same objection right applies.
4. **Removals.** We update this directory when a provider is removed.

## 6. Change log

| Date | Change |
|---|---|
| [[EFFECTIVE_DATE]] | Initial publication of this directory. |
