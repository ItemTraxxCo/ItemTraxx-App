# ItemTraxx Cookie and Tracking Notice

**Effective date:** [[EFFECTIVE_DATE]]  
**Provider:** [[ENTITY_DESCRIPTION]] ("ItemTraxx," "we," "us")  
**Contact:** privacy@itemtraxx.com

This notice explains the cookies and similar browser storage that itemtraxx.com, its subdomains, and the ItemTraxx application use, what each does, how long it lasts, and how you control it. It supplements our [Privacy Policy](privacy-policy.md).

"Cookies" here also means similar technologies: browser `localStorage`, `sessionStorage`, and IndexedDB.

## 1. The short version

- **Essential** cookies and storage keep you signed in, keep the service secure, and remember basic settings. They are always on.
- **Support chat (Intercom)** is treated as an essential support service and loads for everyone: immediately after sign-in for signed-in users, and shortly after the page has loaded and the browser is idle (typically within a few seconds) for everyone else. See Section 4.
- **Error reports** that tell us when the app fails are essential operational reporting and are always on. They go to our own servers, not to an analytics provider. See Section 2.3.
- **Analytics** and **diagnostics** are optional and stay **off until you opt in**. Session replay records only if you turn on **both**.
- We use **no advertising, remarketing, or social-media tracking** cookies or pixels, and we do not sell or share personal information.
- We serve our fonts ourselves and do not load third-party fonts or call third-party services to check for app updates.

## 2. Essential cookies and storage (always on)

### 2.1 Cookies

| Name | Set by | Purpose | Duration | Notes |
|---|---|---|---|---|
| `__Secure-better-auth.session_token` | ItemTraxx (first party, issued by our authentication software) | Keeps you signed in | Up to 7 days, renewed as you use the app; the sign-in session ends sooner when you or an administrator sign it out | HttpOnly, Secure, SameSite=Lax; host-only, so not sent to other `itemtraxx.com` subdomains |
| `__Secure-better-auth.two_factor` | ItemTraxx (first party, issued by our authentication software) | Carries your sign-in from the password step to the two-factor code step | 10 minutes | HttpOnly, Secure, SameSite=Lax; host-only; set only when two-factor verification is required |
| `__Secure-better-auth.better-auth-passkey` | ItemTraxx (first party, issued by our authentication software) | Completes a passkey registration or passkey sign-in | 5 minutes | HttpOnly, Secure, SameSite=Lax; host-only; set only while a passkey is being registered or used |
| `__infra-rid` | Better Auth, Inc. (through our authentication software) | Ties a sign-in request to the sign-in security service so abusive sign-in attempts can be detected | 10 minutes | HttpOnly, SameSite=Lax; set only on some sign-in requests |
| `itemtraxx-cookie-consent` | ItemTraxx | Stores your cookie choices | 1 year | SameSite=Lax; the Secure attribute is applied whenever you load the site over https; shared across `itemtraxx.com` subdomains so one choice applies everywhere |
| `itemtraxx-cookie-consent-subject` | ItemTraxx | A random identifier linking your browser to the server-side record of your choice (Section 5). It is created the first time your choice is recorded on our server, not before you choose. | 1 year | SameSite=Lax; Secure over https; shared across `itemtraxx.com` subdomains |
| Cloudflare security cookies (for example `cf_clearance` or `__cf_bm`) | Cloudflare | Bot protection and challenge pages when Cloudflare needs to verify a visitor | Session to a few hours | Set only when a challenge or bot check runs, including a bot check on sign-in and password reset |

On a local development build the `__Secure-` prefix is not used; it applies on `itemtraxx.com`. We do not use the optional Better Auth "remember me", "trusted device", or session-cache cookies.

### 2.2 Browser storage

| Purpose | Storage type | What it does | How long |
|---|---|---|---|
| Display preferences | localStorage | Remembers your light or dark display choice | Until cleared |
| Device and session management | localStorage | Identifies this browser as a "device" so you and your administrators can review and revoke sessions | Until cleared |
| Notices and status | localStorage | Remembers which notices you dismissed and the last known service status | Until cleared |
| Onboarding and settings | localStorage | Remembers that you finished onboarding and your checkout and offline preferences | Until cleared |
| Cookie choice sync | localStorage | Keeps your cookie choice in step across open tabs and subdomains | Until cleared |
| Offline checkout | IndexedDB | Holds checkouts made while offline, **encrypted** in your browser, until they sync. An offline pack can be up to 25 MB. | Until synced or cleared; server-side offline packs expire within 24 hours |
| Temporary in-tab state | sessionStorage | Lets the app recover from a failed page update and confirm actions within one tab | Until the tab closes |

### 2.3 Error reports (essential, no cookie)

When the app hits a failure, it sends an error report to our own servers. We treat this as essential operational reporting, so it is always on and is not controlled by the cookie choices in Section 5. A report contains the error details (title, message, reason, name, and stack trace), technical context, the page address (origin and path only), your browser's user agent, the environment and release, your role, and the workspace ID. It does not use cookies or browser storage and is not sent to PostHog. Reports are stored in our database, and a short summary is posted to our internal Slack channel. Reports are designed to exclude borrower data. If you have turned on Diagnostics, console and network diagnostics are also attached (Section 3). Details and retention are in the [Privacy Policy](privacy-policy.md), Sections 2.7 and 6.

## 3. Optional cookies (off until you opt in)

| Item | Provider | Category | What it does | Duration |
|---|---|---|---|---|
| `ph_*` cookie and `ph_*` local/session storage | PostHog (United States cloud) | Analytics | Pseudonymous identifier for page views; after you sign in it links your account ID and role to your visits | Up to 1 year; shared across `itemtraxx.com` subdomains |
| Vercel Web Analytics and Speed Insights | Vercel | Analytics | Page-view counts and page-speed measurements. Vercel's analytics do not use cookies. | Not applicable |
| Diagnostic logs | PostHog | Diagnostics | Technical diagnostics sent to PostHog so we can find and fix failures. Diagnostics-only visitors use a temporary in-memory identity with no cookie or storage; reports have emails, tokens, and sensitive URL parameters removed. | Not stored in your browser |
| Diagnostic attachments to error reports | ItemTraxx (our servers) | Diagnostics | Console and network diagnostics attached to an error report (Section 2.3) only if Diagnostics is on, with sensitive values redacted. | Not stored in your browser |
| Session replay | PostHog | Analytics **and** Diagnostics (both required) | Records a privacy-masked replay of how you used the screen, to find usability and technical problems. **All form inputs are masked**, as are borrower usernames and IDs, email addresses, passwords, one-time codes, and security settings. Request headers and bodies are not recorded. | Not stored in your browser |

We configure PostHog so that it does not autocapture clicks, does not record campaign or referrer data in your browser, and does not load surveys, web experiments, or feature flags.

## 4. Support chat (Intercom): essential, not optional

We provide live support through Intercom's Messenger, and we classify it as an **essential support service**, not an optional cookie category. It is therefore **not switched off by the cookie choices in Section 5**.

- **When it loads.** It loads lazily so it does not slow the page: immediately after you sign in, or, if you are not signed in, shortly after the page has loaded and the browser is idle (typically within a few seconds).
- **What it stores.** Intercom sets its own cookies and browser storage, for example a visitor or device identifier (named like `intercom-id-…` and `intercom-device-id-…`) and a short-lived session identifier (`intercom-session-…`). These typically last from a week up to 9 months, set by Intercom.
- **What Intercom receives.** For every visitor: IP address, browser and device information, the page you are on, and those identifiers. For signed-in users: also your account ID and email, sent in a token signed by our server, and anything you type into a chat.
- **Limits.** Intercom is our service provider and does not use this information for advertising. Please do not type Student Data into the chat.
- **Opting out.** You can block `intercom.io` and `intercomcdn.com` in your browser or an ad blocker, or clear its cookies, and contact us at support@itemtraxx.com instead.

## 5. How your cookie choice works

1. **The banner.** On your first visit the banner offers **Essential only**, **Accept all**, or custom choices for **Analytics** and **Diagnostics**. Until you choose, only essential items and the support chat run.
2. **What is saved.** Your choice is saved in the `itemtraxx-cookie-consent` cookie (1 year). We also keep a server-side record: a random identifier, your analytics and diagnostics choices, the consent version, the time, and, if you are signed in, your account ID. **We do not record your IP address in this record.** Records for people who are not signed in are deleted after 730 days.
3. **Across subdomains.** Because the choice cookie is shared across `itemtraxx.com` subdomains, your choice applies to our website and every workspace address, and a change made in one tab or subdomain reaches the others within a couple of seconds.
4. **Changing your mind.** Clear the `itemtraxx.com` cookies in your browser (or email privacy@itemtraxx.com). The banner then appears again. When you withdraw analytics or diagnostics, recording stops and analytics storage is removed from that browser. Withdrawal does not undo data already collected; email us if you want it deleted.
5. **Renewal.** We ask again after 1 year, or if we change the categories.
6. **Security checks are not optional.** Bot protection on sign-in and password reset cannot be switched off.

## 6. Security logging that does not use cookies

Our servers and network automatically log requests (IP address, URL path, method, status, user agent, request ID) to keep the service secure and running. In our own telemetry we store hashed versions of IP addresses and session identifiers. This logging does not rely on cookies or browser storage, so the cookie choices do not control it. Details are in the [Privacy Policy](privacy-policy.md), Section 2.6.

## 7. Managing cookies in your browser

You can block or delete cookies in your browser settings. If you block essential cookies, you will not be able to sign in. Clearing storage removes your saved preferences, device label, and any **unsynced offline checkouts**, so sync before you clear.

## 8. Do Not Track and Global Privacy Control

Optional analytics and diagnostics stay off until you opt in, whatever your browser's Do Not Track setting says. We do not track you across other sites, and we do not sell or share personal information, so there is nothing for a Global Privacy Control signal to opt you out of.

## 9. Changes and contact

We will update this notice when our cookies change and show the new effective date at the top. Questions: privacy@itemtraxx.com or [[MAILING_ADDRESS]].
