# ItemTraxx Privacy Policy

**Effective date:** [[EFFECTIVE_DATE]]  
**Provider:** [[ENTITY_DESCRIPTION]] ("ItemTraxx," "we," "us")  
**Contact:** privacy@itemtraxx.com · [[MAILING_ADDRESS]]

This policy explains what personal information ItemTraxx collects through itemtraxx.com, its subdomains, and the ItemTraxx inventory and checkout application (together, the "Service"), why we collect it, who receives it, how long we keep it, and the choices you have. It is written to match how the Service actually works.

If you are a student or the parent of a student, also read the [Student Privacy Notice](student-privacy-notice.md). If you use ItemTraxx through your school, district, university, or employer, your organization's own policies apply to the information it enters.

## 1. Our two roles

ItemTraxx plays two different roles, and the rules differ for each.

1. **Service provider (processor) for your organization.** A school, district, university, business, or other organization (a "Customer") creates a workspace and decides what to put in it: borrower records, items, checkout history, and staff accounts. For that **Workspace Data** (which our Terms and Data Processing Addendum call Customer Data), we act only on the Customer's instructions, under our agreement with the Customer. The Customer decides what is collected and why. If you want to see, correct, or delete Workspace Data about you, contact the Customer first.
2. **Business (controller) for the Service itself.** For account security, abuse prevention, support, sales, website analytics you opt into, error diagnostics, and our own business records, we decide how information is used and we are responsible for it.

## 2. Information we collect

### 2.1 Workspace Data (entered by Customers)

| Data | What it is |
|---|---|
| **Borrower records** | A borrower **username** and **borrower ID**. By default ItemTraxx generates both: a random codename such as `TideFox481` and a random ID such as `4821KQ`. A Customer administrator can instead type or import their own values, up to 40 characters. ItemTraxx has no fields for a borrower's email address, phone number, date of birth, grade, photo, or address. |
| **Checkout history** | Which borrower checked out or returned which item, when, and which staff account recorded it. |
| **Items** | Item names, barcodes, serial numbers, notes, status, and status history. |
| **Workspace settings** | Plan limits, due-date rules, feature settings, and organization name and logo. |
| **Audit entries** | Records of administrative actions in the workspace. |

Customers decide whether borrower usernames and IDs are real names or student numbers. We recommend that they use the generated codenames. A codename is **pseudonymous, not anonymous**: the Customer keeps the information that links a codename to a person. We therefore treat all borrower data as personal information, and as Student Data (as defined in Part B of the [Student Privacy Notice](student-privacy-notice.md)) where the Customer is a school.

### 2.2 Account and sign-in information (staff, administrators, individual users)

- Name (where provided), **email address**, role (for example workspace admin or workspace user account), and the workspace or organization you belong to.
- Authentication data: a password hash, passkey public keys, and two-factor (TOTP) secrets if you enable them. If your organization uses single sign-on, the identity details its identity provider sends us (typically email and name).
- Session and device records: a device identifier and label stored in your browser, your browser's user agent, how you signed in, an approximate location derived by Cloudflare from your connection (country or region level), the IP address associated with the session, and timestamps. These let you and your administrators review and revoke sessions.
- Emails we send you: invitations, email-change approvals, password resets, and sign-in notifications that include the device and browser used.

### 2.3 Support, sales, and privacy requests

If you contact us through a form or email: your name, email address, organization, the message, the number of schools if you give it, and up to two image attachments (PNG, JPG, WEBP, or GIF) you choose to upload. Please do not include Student Data in messages or screenshots.

### 2.4 Cookie preferences

When you make a cookie choice we store it in your browser and keep a record on our servers: a random identifier, your analytics and diagnostics choices, the consent version, the time, and (if you are signed in) your account ID. We do **not** store your IP address in this record.

### 2.5 Optional analytics and diagnostics (only with your consent)

See Section 4. With your consent we collect page views, a pseudonymous identifier (and, once you sign in, your account ID and role), diagnostic logs, and, if you enable both options, privacy-masked session replays.

### 2.6 Security and operations data (collected automatically)

To keep the Service secure and running, our infrastructure records: IP address, request URL path, HTTP method, response status, user agent, request IDs, and rate-limiting signals. In our own telemetry we store hashed versions of IP addresses and session credentials rather than the raw values, but those hashes still identify a device to us. Bot-protection services process your IP address and browser signals on sign-in and password-reset forms to tell people from automated traffic.

### 2.7 Error reports

When the app hits a failure, it sends an error report to our own servers. We treat this as essential operational reporting, so it is **always on** and is not controlled by the cookie banner. A report can include the error title, message, and reason, the error name, a stack trace, technical context, the page address (origin and path only, without query parameters), your browser's user agent, the environment and release version, your role, the workspace ID, and whether you are on a workspace address. Reports are stored in our database (Supabase), and a short summary (report ID, error name, environment, release, role, workspace ID, and request ID) is posted to our internal Slack channel. Reports are linked to a workspace, not to a borrower, and are designed to exclude borrower data. The free-text fields are length-limited and stripped of control characters but are not otherwise filtered, so if a failure message happened to contain personal information it could be included. To prevent abuse we rate-limit submissions, and we store with each report a one-way hash of a network identifier derived from your IP address (not the address itself) and a one-way hash used for rate limiting. If you have turned on **Diagnostics** (Section 4.2), console and network diagnostics, with sensitive values redacted, are attached to the report as well. Error reports are not sent to PostHog.


## 3. How we use information

- To provide, secure, and support the Service, and to run your Customer's workspace as it directs.
- To authenticate you, prevent fraud and abuse, enforce rate limits, and detect and investigate attacks.
- To send service emails (invitations, security notices, password resets, sign-in notices, support replies).
- To respond to support, sales, security, and privacy requests.
- To understand and improve the Service, but analytics and diagnostics only if you opt in (Section 4).
- To comply with law and to establish, exercise, or defend legal claims.
- To keep records that show you accepted legal documents (the document, version, a hash of its text, time, IP address, and browser).

We do not use personal information for advertising, do not build advertising or marketing profiles, and do not sell or share it for cross-context behavioral advertising.

## 4. Cookies, browser storage, and consent

### 4.1 What we set

This section summarizes our [Cookie and Tracking Notice](cookie-notice.md), which lists each cookie and each kind of browser storage we use.

| Item | Purpose | Duration | Category |
|---|---|---|---|
| `__Secure-better-auth.session_token` (first-party, HttpOnly, Secure, host-only, not shared across subdomains) | Keep you signed in | Up to 7 days, renewed as you use the app; the sign-in session ends sooner if you or an administrator sign out | Essential |
| `__Secure-better-auth.two_factor`, `__Secure-better-auth.better-auth-passkey`, and `__infra-rid` (HttpOnly, host-only) | Complete two-factor and passkey sign-in steps and detect abusive sign-in attempts | 5 to 10 minutes | Essential |
| Cloudflare bot-protection cookies (such as `cf_clearance` and `__cf_bm`) | Bot protection and request integrity; set only when a check runs | Session to a few hours | Essential |
| `itemtraxx-cookie-consent` and `itemtraxx-cookie-consent-subject` (cookies; the Secure attribute applies over https) | Remember your cookie choice and tie it to the server-side consent record | 1 year, shared across `itemtraxx.com` subdomains | Essential |
| localStorage: display preferences, device ID and label, onboarding and dismissed notices, and a marker that keeps your cookie choice in sync across tabs | Interface preferences, session/device management, and consent sync | Until you clear it | Essential |
| sessionStorage: temporary state for one tab (recovering from a failed page update, confirming a form submission, short-lived verification state) | Make the app recover and confirm actions within one tab | Until the tab closes | Essential |
| IndexedDB: encrypted offline checkout queue and offline pack | Holds checkouts made while offline until they sync, encrypted in your browser; an offline pack can be up to 25 MB | Until synced or cleared; server-side offline packs expire within 24 hours | Essential |
| **Intercom** cookies and storage | Support chat (see 4.3) | Set by Intercom, typically up to 9 months | Essential support service |
| `ph_*` PostHog cookies and storage | Pseudonymous analytics identity | Up to 1 year; shared across `itemtraxx.com` subdomains | Analytics (consent) |
| Vercel Web Analytics and Speed Insights | Page-view and performance measurement | No cookies | Analytics (consent) |

We use **no advertising, remarketing, or social-media tracking cookies or pixels**.

### 4.2 Your cookie choices

A banner offers "Essential only," "Accept all," or custom choices:

- **Analytics** controls PostHog page views and identity, Vercel Analytics, and Speed Insights.
- **Diagnostics** controls PostHog diagnostic logging, and whether console and network diagnostics are attached to an error report. It does **not** control the core error report described in Section 2.7, which is essential operational reporting.
- **Session replay** records only when **both** Analytics and Diagnostics are on. Replay masks all form inputs and any element we mark as sensitive, which includes borrower usernames and IDs, email addresses, passwords, one-time codes, and security settings. It does not record request headers or bodies.

Until you opt in, none of these tools load or store identifiers. To change your mind, clear the `itemtraxx.com` cookies in your browser (or email privacy@itemtraxx.com); the banner then appears again. When a choice is withdrawn, recording stops and analytics storage is cleared in that browser, across `itemtraxx.com` subdomains. Your choice is stored for one year, after which we ask again.

### 4.3 Support chat (Intercom)

We provide live support through Intercom's Messenger. We treat it as an **essential support service**, so it is not switched off by the cookie choices above. It loads for everyone, but lazily, so it does not slow the page: for signed-in users it starts immediately after sign-in; for visitors who are not signed in it starts shortly after the page has loaded and the browser is idle (typically within a few seconds).

- **Every visitor:** Intercom receives your IP address, browser and device information, the page you are viewing, and its own cookies and storage, including a device identifier, so a conversation can continue on later visits.
- **Signed-in users:** Intercom also receives your account ID and email address, sent in a token signed by our server, and the content of any chat you start.
- Intercom is our service provider and does not use this information for advertising.

Do not type student names, student IDs, or other Student Data into the chat or attach it. If you prefer not to load Intercom, you can block `intercom.io` and `intercomcdn.com` in your browser or ad blocker and email support@itemtraxx.com instead.

### 4.4 Fonts and assets

ItemTraxx serves its fonts (Inter) from its own domain. It does not load fonts from Google or other third-party font services, and it does not call third-party services to check for new app versions.

### 4.5 Do Not Track and Global Privacy Control

Optional analytics and diagnostics stay off until you opt in, whatever your browser's Do Not Track setting says. We do not track you across other websites, and we do not sell or share personal information, so there is nothing for a Global Privacy Control signal to opt you out of.

## 5. Who receives information (subprocessors)

We do not sell personal information. We share it only with service providers that help us run ItemTraxx, bound by contracts that limit their use, and as described in Section 5.2.

### 5.1 Service providers

Our service providers, what each one does, the data it can receive, and where it operates are listed in the [Subprocessor Directory](subprocessor-directory.md), which also describes how we notify customers of changes (at least 30 days in advance, with a right to object, as set out in the directory and the Data Processing Addendum). Only the providers marked in that directory process Student Data. Our source code, build, and security tools do not receive production customer data. Your organization's own identity provider, if it uses single sign-on, is the organization's vendor, not ours.

### 5.2 Other disclosures

We may disclose information (a) to your Customer, which controls its workspace and can see its own staff accounts and activity; (b) when required by law, subpoena, or court order, after checking its validity and, where permitted, notifying the affected Customer; (c) to protect the rights, safety, or security of users, the public, or ItemTraxx; and (d) in a merger, acquisition, financing, or sale of assets, in which case the successor must honor this policy for existing data or give you notice and choice first.

We will update this table before adding a new service provider that handles Workspace Data, and we notify Customers as described in our data processing agreement.

## 6. How long we keep information

| Information | Retention |
|---|---|
| Account data, workspace data, and checkout history | While the workspace is active |
| Borrower records a Customer archives ("soft-deleted") | Permanently deleted after 365 days; checkout history entries stay in the workspace log with the borrower link removed |
| Items a Customer archives | Permanently deleted after 730 days |
| Administrative audit entries | 730 days (super-administrator entries 1,095 days) |
| Archived or cancelled workspaces | A 30-day recovery period, then an automated job permanently deletes the workspace data, its staff accounts, support requests and attachments, email delivery logs, and error reports, and records a deletion certificate (workspace name and counts only). Backups age out on the schedule in the next row. |
| Error reports | [[ERROR_REPORT_RETENTION_DAYS]] days, or until the workspace is permanently deleted, whichever comes first |
| Backups | Overwritten on a rolling schedule of [[BACKUP_RETENTION_DAYS]] days |
| Anonymous cookie-consent records | 730 days |
| Offline checkout packs | Expire within 24 hours; the server record is deleted 7 days after expiry |
| Invitations and email-change requests | Deleted 30 days after they expire or complete |
| Sign-in sessions | Up to 7 days, extended while active, and revoked at sign-out or by an administrator |
| Security audit records | Kept as uuid-only security records after a workspace is deleted, without names or emails |
| Legal acceptance records | Kept for as long as needed to prove agreement, which may outlast the account; if the account is deleted the link to you is removed |
| Support and sales messages | Kept while needed to handle your request and for our business records, and deleted on request. Support requests tied to a workspace, with their attachments, are deleted when that workspace is purged. |
| Analytics, replay, and diagnostics | Per our PostHog project settings, not longer than [[ANALYTICS_RETENTION]] |
| Intercom conversations | Kept in Intercom while needed to provide support, and deleted on request |

We may keep information longer when the law requires or when needed to resolve a dispute or enforce our agreements.

## 7. Security

ItemTraxx protects information with measures including: encryption in transit (HTTPS with HSTS preload); encryption at rest by our hosting providers; workspace isolation enforced in the database with row-level security; service-only access for data changes; passwords of at least 12 characters, passkeys, and optional two-factor authentication; step-up verification for privileged actions; session revocation; bot protection and rate limiting on public forms; a content security policy; encrypted offline storage; continuous automated security testing and periodic third-party assessments; and an internal incident-response process. No online service is perfectly secure.

If a security incident affects your personal information, we will notify affected Customers and individuals as required by law, including California Civil Code section 1798.82. When we hold data on a Customer's behalf we notify the Customer without undue delay after we confirm the incident, so it can meet its own obligations: within 72 hours of confirmation for Student Data, and within [[OTHER_DATA_INCIDENT_NOTICE]] for other Customer Data, as set out in the Data Processing Addendum and the Student Data Addendum.

To report a vulnerability, see our [Vulnerability Disclosure Policy](vulnerability-disclosure-policy.md).

## 8. Your rights and choices

Depending on where you live, you may have the right to know what personal information we hold, access and correct it, delete it, receive a portable copy, limit use of sensitive information, and not be discriminated against for exercising rights. California residents have these rights under the California Consumer Privacy Act as amended (CCPA/CPRA) where it applies to us, and we honor them regardless.

- **We do not sell personal information, and we do not share it for cross-context behavioral advertising**, so there is nothing to opt out of.
- **Workspace Data:** if the information is in a Customer's workspace, we will refer your request to the Customer, which controls it, and help the Customer respond.
- **Account and other data we control:** email privacy@itemtraxx.com or use the privacy-request form at itemtraxx.com/privacy-request. We verify your identity, respond within 45 days (extendable once by 45 days with notice), and will not charge you or retaliate. An authorized agent may submit a request with proof of authority.
- **Cookies:** change your choice any time as described in Section 4.2.
- **Sales follow-up:** you can ask us to stop contacting you about a sales inquiry at any time.

**Appeals.** If we deny or only partly grant a request, you may appeal within 30 days by emailing privacy@itemtraxx.com with the subject line "Privacy Appeal" and a description of your request. A person who was not involved in the original decision will review it, and we will reply in writing within 45 days with our decision and the reasons. If we deny the appeal, or you are otherwise unhappy with our response, you may contact your state attorney general or privacy regulator, such as the California Privacy Protection Agency or the California Attorney General.

## 9. Children and Student Data

The Service is for organizations and adults and is not directed to children under 13. We do not knowingly collect personal information directly from children under 13. Students do not sign in to ItemTraxx; school staff record a borrower's checkouts on their behalf. When a school uses ItemTraxx, the school decides what Student Data to enter and authorizes us to process it for educational purposes only. Our commitments for Student Data are in the [Student Privacy Notice](student-privacy-notice.md). If you believe a child has given us personal information directly, contact privacy@itemtraxx.com and we will delete it.

Individual accounts require you to be at least 18.

## 10. Where information is processed

ItemTraxx operates from the United States and processes information in the United States and wherever our service providers operate their networks (for example, Cloudflare's global edge). If you access the Service from outside the United States, you understand that your information will be transferred to and processed in the United States.

## 11. California notices

### 11.1 Notice at Collection

This table summarizes what we collect, why, and how long we keep it, in the last 12 months and going forward. We do not sell or share (as those terms are used in the CCPA/CPRA) any of it.

| Category | Examples | Purpose | Retention |
|---|---|---|---|
| Identifiers | Name, email, IP address, device identifiers, account IDs | Provide and secure the Service, authenticate users, respond to requests | While the account or workspace is active, then as in Section 6 |
| Internet and network activity | Page views, session and device records, security logs | Operate, secure, and improve the Service | As in Section 6 |
| Approximate location | Country or region derived from IP address | Security and fraud prevention | As in Section 6 |
| Commercial information | Plan and order records, sales inquiries | Billing, sales follow-up, record keeping | While needed for business and legal records |
| Audio, visual, or similar information | Screenshots you upload to support | Handle your support request | As in Section 6 |
| Professional information | Organization and role | Provide the Service and customer support | While the account is active |
| Student Data | Borrower usernames, borrower IDs, and checkout history entered by a school | Collected on behalf of the school, for educational inventory purposes only | As in Section 6 and the [Student Privacy Notice](student-privacy-notice.md) |

We collect no biometric, health, or precise-location information and no sensitive personal information as defined by the CCPA/CPRA. We draw no inferences for profiling.

### 11.2 Other California disclosures

- **Sources:** you, your organization, your browser and device, and our service providers.
- **Purposes and recipients:** Sections 3 and 5.
- **Sold or shared:** none, in the last 12 months or now.
- **Your rights and how to appeal:** Section 8.
- **Shine the Light (Cal. Civ. Code § 1798.83):** we do not disclose personal information to third parties for their direct marketing.
- **Minors under 16:** we do not sell or share personal information of anyone under 16.

## 12. Changes to this policy

We will post any update here with a new effective date. If a change is material, we will notify account administrators by email or in the app before it takes effect. Prior versions are available on request.

## 13. Contact

Questions, requests, or complaints: **privacy@itemtraxx.com**, or [[ENTITY_DESCRIPTION]], [[MAILING_ADDRESS]]. Security issues: security@itemtraxx.com. General support: support@itemtraxx.com.
