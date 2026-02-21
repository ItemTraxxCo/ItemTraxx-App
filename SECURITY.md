# Security Policy

Last updated: 2026-02-21

ItemTraxx Co ("we", "our", or "us") is committed to maintaining the security and integrity of ItemTraxx. This document describes how to report security issues and how we handle them.

---

## 1. Reporting a Vulnerability
If you discover a security vulnerability in ItemTraxx, please report it responsibly:

- Send an email to: support@itemtraxx.com
- Include the following information:
  - A description of the issue
  - Device you are using, browser, etc.
  - Steps to reproduce the problem
  - Any relevant screenshots or logs
- Please do **not** publicly disclose the issue before we have resolved it

We will acknowledge your report within 72 hours and provide updates as the issue is investigated.

---

## 2. Our Response Process
Once a security issue is reported, we will:

1. Verify the vulnerability
2. Assess its severity
4. Apply a fix or mitigation
5. Post updates to users
6. Communicate with the reporter until the issue is resolved

We aim to resolve critical vulnerabilities as quickly as possible.

Response targets:
- Initial acknowledgment: within 72 hours
- Severity triage target: within 5 business days
- Critical issue remediation target: expedited as soon as practical after validation

---

## 3. Safe Reporting Guidelines
When reporting a vulnerability, please avoid:

- Exploiting the vulnerability beyond what is necessary to demonstrate it
- Accessing or altering any data you do not own
- Publicly disclosing details until the issue is fully fixed

---

## 4. Security Updates
We maintain regular security updates and patches to ensure ItemTraxx remains secure.  
Users are encouraged to keep the app updated to the latest version.
See [Changelog](CHANGELOG.md) for latest version and updates

Supported versions:
- Latest production deployment on `main`: fully supported
- Previous production deployment: limited short-term support during rollout
- Older deployments/branches: best effort only

---

## 5. Platform Security Controls
ItemTraxx includes layered controls such as:
- Content Security Policy (CSP) and additional security headers
- Cloudflare Turnstile verification on protected login flows
- Edge proxy controls and function allowlisting
- Role-based access controls and route guards
- Audit logging for privileged actions

---

## 6. Disclaimer
ItemTraxx Co is not responsible for vulnerabilities introduced by third-party software or misconfigured systems outside our control.

---

## 7. Contact
For security issues or concerns, contact:

**ItemTraxx Co**  
Email: support@itemtraxx.com

---

**© 2026 ItemTraxx Co. All rights reserved.**
