# ItemTraxx Cookie and Tracking Notice

**Effective date:** [[EFFECTIVE_DATE]]  
**Provider:** [[ENTITY_DESCRIPTION]] ("ItemTraxx," "we," "us")  
**Contact:** privacy@itemtraxx.com

This notice explains the cookies and similar browser storage that itemtraxx.com, its subdomains, and the ItemTraxx application use, what each does, how long it lasts, and how you control it. It supplements our [Privacy Policy](privacy-policy.md).

"Cookies" here also means similar technologies: browser `localStorage`, `sessionStorage`, and IndexedDB.

## 1. The short version

- **Essential** cookies and storage keep you signed in, keep the service secure, and remember basic settings. They are always on.
- **Support chat (Intercom)** is treated as an essential support service and loads for everyone, a moment after the page is idle (immediately after sign-in for signed-in users). See Section 4.
- **Analytics** and **diagnostics** are optional and stay **off until you opt in**. Session replay records only if you turn on **both**.
- We use **no advertising, remarketing, or social-media tracking** cookies or pixels, and we do not sell or share personal information.
- We serve our fonts ourselves and do not load third-party fonts or call third-party services to check for app updates.

## 2. Essential cookies and storage (always on)

### 2.1 Cookies

| Name | Set by | Purpose | Duration | Notes |
|---|---|---|---|---|
| `__Host-itx_session` | ItemTraxx (first party) | Short-lived access credential that keeps you signed in | About 1 hour, renewed while you are active | HttpOnly, Secure, SameSite=Lax; host-only, so not sent to other `itemtraxx.com` subdomains |
| `__Host-itx_refresh` | ItemTraxx (first party) | Renews the access cookie without asking you to sign in again | Up to 14 days; the underlying sign-in session ends after at most 7 days of activity or when you or an administrator sign it out | HttpOnly, Secure, SameSite=Lax; host-only |
| `itemtraxx-cookie-consent` | ItemTraxx | Stores your cookie choices | 1 year | Secure, SameSite=Lax; shared across `itemtraxx.com` subdomains so one choice applies everywhere |
| `itemtraxx-cookie-consent-subject` | ItemTraxx | A random identifier linking your browser to the server-side record of your choice (Section 5) | 1 year | Secure, SameSite=Lax; shared across `itemtraxx.com` subdomains |
| Cloudflare security cookies (for example `cf_clearance` or `__cf_bm`) | Cloudflare | Bot protection and challenge pages when Cloudflare needs to verify a visitor | Session to a few hours | Set only when a challenge or bot check runs, including Cloudflare Turnstile on sign-in and password reset |

The authentication software we run may also set host-only sign-in cookies for steps such as two-factor verification. These are used only to sign you in, are host-only (not shared across subdomains), and are short-lived.

### 2.2 Browser storage

| Key or database | Purpose | Duration |
|---|---|---|
| `itemtraxx-theme` | Light or dark display preference | Until cleared |
| `itemtraxx-device-id`, `itemtraxx-device-label` | Identifies this browser as a "device" in your session list so you and your administrators can review and revoke sessions | Until cleared |
| `itemtraxx-broadcast-dismissed`, `itemtraxx-incident-dismissed`, `itemtraxx-maintenance-state`, `itemtraxx:tenant-notifications:dismissed-signature:v1` | Remember which notices you dismissed and the last known service status | Until cleared |
| Onboarding and checkout preference keys (for example `itemtraxx:offline-connection:v1`) | Remember that you finished onboarding and your checkout and offline settings | Until cleared |
| `itemtraxx:checkout-offline-buffer:v1` and the `itemtraxx-offline-queue` IndexedDB database | Hold checkouts made while offline, **AES-GCM encrypted** with a key kept in your browser, until they sync | Until synced or cleared; server-side offline packs expire within 24 hours |
| `sessionStorage` entries (a reload marker used to recover from a failed page update, a form-submission confirmation, and short-lived verification state) | Make the app recover and confirm actions within one tab | Until the tab closes |

### 2.3 Legacy cookie cleanup

Older builds set a short-lived replay hand-off cookie (`itemtraxx-replay-session-handoff`). Current builds do not set it and clear it when found.

## 3. Optional cookies (off until you opt in)

| Item | Provider | Category | What it does | Duration |
|---|---|---|---|---|
| `ph_*` cookie and `ph_*` local/session storage | PostHog (United States cloud) | Analytics | Pseudonymous identifier for page views; after you sign in it links your account ID and role to your visits | Up to 1 year; shared across `itemtraxx.com` subdomains |
| Vercel Web Analytics and Speed Insights | Vercel | Analytics | Page-view counts and page-speed measurements. Vercel's analytics do not use cookies. | Not applicable |
| Error reports and diagnostic logs | PostHog | Diagnostics | Report crashes and failures so we can fix them. Diagnostics-only visitors use a temporary in-memory identity with no cookie or storage; reports have emails, tokens, and sensitive URL parameters removed. | Not stored in your browser |
| Session replay | PostHog | Analytics **and** Diagnostics (both required) | Records a privacy-masked replay of how you used the screen, to find usability and technical problems. **All form inputs are masked**, as are borrower usernames and IDs, email addresses, passwords, one-time codes, and security settings. Request headers and bodies are not recorded. | Not stored in your browser |

We configure PostHog so that it does not autocapture clicks, does not record campaign or referrer data in your browser, and does not load surveys, web experiments, or feature flags.

## 4. Support chat (Intercom): essential, not optional

We provide live support through Intercom's Messenger, and we classify it as an **essential support service**, not an optional cookie category. It is therefore **not switched off by the cookie choices in Section 5**.

- **When it loads.** It loads lazily so it does not slow the page: immediately after you sign in, or about a second or two after the page is idle if you are not signed in.
- **What it stores.** Intercom sets its own cookies and browser storage, for example a visitor or device identifier (named like `intercom-id-…` and `intercom-device-id-…`) and a short-lived session identifier (`intercom-session-…`). These typically last from a week up to 9 months, set by Intercom.
- **What Intercom receives.** For every visitor: IP address, browser and device information, the page you are on, and those identifiers. For signed-in users: also your account ID and email, sent in a token signed by our server, and anything you type into a chat.
- **Limits.** Intercom is our service provider and does not use this information for advertising. Please do not type student information into the chat.
- **Opting out.** You can block `intercom.io` and `intercomcdn.com` in your browser or an ad blocker, or clear its cookies, and contact us at support@itemtraxx.com instead.

## 5. How your cookie choice works

1. **The banner.** On your first visit the banner offers **Essential only**, **Accept all**, or custom choices for **Analytics** and **Diagnostics**. Until you choose, only essential items and the support chat run.
2. **What is saved.** Your choice is saved in the `itemtraxx-cookie-consent` cookie (1 year). We also keep a server-side record: a random identifier, your analytics and diagnostics choices, the consent version, the time, and, if you are signed in, your account ID. **We do not record your IP address in this record.** Records for people who are not signed in are deleted after 730 days.
3. **Across subdomains.** Because the choice cookie is shared across `itemtraxx.com` subdomains, your choice applies to our website and every workspace address, and a change made in one tab or subdomain reaches the others within a couple of seconds.
4. **Changing your mind.** Clear the `itemtraxx.com` cookies in your browser (or email privacy@itemtraxx.com). The banner then appears again. When you withdraw analytics or diagnostics, recording stops and analytics storage is removed from that browser. Withdrawal does not undo data already collected; email us if you want it deleted.
5. **Renewal.** We ask again after 1 year, or if we change the categories.
6. **Cloudflare Turnstile and security checks are not optional.** They protect sign-in and password reset and cannot be switched off.

## 6. Security logging that does not use cookies

Our servers and network automatically log requests (IP address, URL path, method, status, user agent, request ID) to keep the service secure and running. In our own telemetry we store keyed hashes of IP addresses and sessions, and when we detect an attack we may send an alert containing those hashes to our paging provider. This logging does not rely on cookies or browser storage, so the cookie choices do not control it. Details are in the [Privacy Policy](privacy-policy.md), Section 2.6.

## 7. Managing cookies in your browser

You can block or delete cookies in your browser settings. If you block essential cookies, you will not be able to sign in. Clearing storage removes your saved preferences, device label, and any **unsynced offline checkouts**, so sync before you clear.

## 8. Do Not Track and Global Privacy Control

Optional analytics and diagnostics stay off until you opt in, whatever your browser's Do Not Track setting says. We do not track you across other sites, and we do not sell or share personal information, so there is nothing for a Global Privacy Control signal to opt you out of.

## 9. Changes and contact

We will update this notice when our cookies change and show the new effective date at the top. Questions: privacy@itemtraxx.com or [[MAILING_ADDRESS]].
