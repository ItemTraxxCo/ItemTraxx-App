# Security Audit

## Purpose
Runs the repository security gate and generates an SBOM artifact.

## Trigger
- Any pull request
- Push to `main`
- Push to `preview`

## Behavior
- Runs `npm ci`
- Executes `npm run security:gate`
- Executes `npm run security:sbom`
- Uploads `artifacts/sbom.cdx.json`
- Sends Slack start/finish notifications

## Failure Handling
Review the `Run security gate` step first, then the SBOM generation step. Failures typically come from new dependency risk, policy violations, or broken SBOM generation.
