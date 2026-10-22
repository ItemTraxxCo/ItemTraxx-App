# Cloudflare Workers Builds

The `itemtraxx-edge-proxy` Worker uses Cloudflare Workers Builds with the
repository root as its root directory. Keep these build settings aligned with
the package layout:

- Build: `cd cloudflare/edge-proxy && npm ci --ignore-scripts && npm run typecheck`
- Production deploy: `cd cloudflare/edge-proxy && npm run deploy`
- Preview version: `cd cloudflare/edge-proxy && npm run versions:upload`
- `SKIP_DEPENDENCY_INSTALL=1`

The repository's `.nvmrc` and `.node-version` stay pinned to Node `24.22.1` for
local and GitHub Actions parity. Cloudflare's build image currently preinstalls
Node `24.18.0`; builds that try to install `24.22.1` fail during tool setup,
before the build command runs. Set the build-only `NODE_VERSION=24.18.0` on both
the production and preview Workers Builds triggers. This keeps the local and CI
runtime pin intact while selecting the preinstalled Node version for Cloudflare.
