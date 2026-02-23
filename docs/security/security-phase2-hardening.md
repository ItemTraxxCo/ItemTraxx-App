# Security Phase 2 Hardening

## Changes
- Added stricter browser security headers in `/vercel.json`:
  - `Strict-Transport-Security` (2 years, include subdomains, preload)
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Resource-Policy: same-site`
  - CSP additions: `script-src-attr 'none'`, `upgrade-insecure-requests`
- Added security policy gate script:
  - `npm run security:gate` (high+ npm audit + custom static checks)
- Added SBOM generation:
  - `npm run security:sbom` writes CycloneDX JSON to `artifacts/sbom.cdx.json`
- Updated CI security workflow to:
  - Run `security:gate`
  - Generate SBOM
  - Upload SBOM artifact on every run

## Operational Use
- Security gate blocks PRs if npm audit reports high/critical vulnerabilities.
- SBOM artifact can be fed to downstream security scanners and procurement/compliance workflows.
