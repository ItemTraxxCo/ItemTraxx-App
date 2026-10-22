# Cloudflare Workers Builds

The `itemtraxx-edge-proxy` Worker uses Cloudflare Workers Builds with the
repository root as its root directory. Keep these build settings aligned with
the package layout:

- Build: `cd cloudflare/edge-proxy && npm ci --ignore-scripts && npm run typecheck`
- Production deploy: `cd cloudflare/edge-proxy && npm run deploy`
- Preview version: `cd cloudflare/edge-proxy && npm run versions:upload`
- `SKIP_DEPENDENCY_INSTALL=1`

The repository's `.nvmrc`, `.node-version`, and GitHub Actions workflows use
Node `24.22.1`. Set `NODE_VERSION=24.22.1` on both the production and preview
Workers Builds triggers so their runtime matches local and CI validation. The
actual Cloudflare dashboard setting is not recorded in this repository and
must be verified in the provider console.
