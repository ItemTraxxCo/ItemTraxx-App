# Network Access Troubleshooting

## Purpose
Diagnose user reports like `ERR_CONNECTION_CLOSED`, `DNS_PROBE_FINISHED_NXDOMAIN`, or intermittent reachability.

## Quick Checks
1. DNS resolution:
```bash
dig +short www.itemtraxx.com A
dig +short itemtraxx.com A
```
2. HTTPS headers:
```bash
curl -svI https://www.itemtraxx.com
```
3. Compare networks:
- Test on affected network.
- Test on hotspot/home network.

## Expected Good Results
- DNS resolves to Cloudflare IPs.
- HTTPS returns 200/3xx with `server: cloudflare`.

## Known Blocked Pattern
- DNS returns `sinkhole.paloaltonetworks.com` or `198.135.184.22`.
- Browser shows `ERR_CONNECTION_CLOSED`.

## Validate Origin Is Healthy (bypass local DNS)
```bash
curl -svI --resolve www.itemtraxx.com:443:104.21.29.65 https://www.itemtraxx.com
curl -svI --resolve www.itemtraxx.com:443:172.67.148.140 https://www.itemtraxx.com
```
If these succeed but normal DNS path fails, it is network filtering.

## IT Allowlist Request
Ask customer IT to allow:
- `itemtraxx.com`
- `www.itemtraxx.com`
- `*.itemtraxx.com` (recommended)

## Escalation
If blocked on managed network only:
1. Open ticket with customer IT/security.
2. Submit vendor recategorization request (Palo Alto URL Filtering).
3. Provide DNS and curl evidence from this guide.
