# Cloudflare Workers Builds

The `itemtraxx-edge-proxy` Worker uses Cloudflare Workers Builds with the
repository root as its root directory. Keep these build settings aligned with
the package layout:

- Build: `cd cloudflare/edge-proxy && npm ci --ignore-scripts && npm run typecheck`
- Production deploy: `cd cloudflare/edge-proxy && npm run deploy`
- Non-production version: `cd cloudflare/edge-proxy && npm run versions:upload`
- `SKIP_DEPENDENCY_INSTALL=1`

The repository's `.nvmrc`, `.node-version`, and GitHub Actions workflows use
Node `24.22.3`. The Cloudflare Workers Builds `NODE_VERSION` setting was last
read back as `24.22.1` on 2026-10-22 and needs a separate dashboard update to
match the repository runtime.

The connected Worker uses `main` as its production branch and has
non-production branch builds enabled. Its non-production Version command runs
`wrangler versions upload`, which uploads a Worker version without promoting it
to the active deployment. The dashboard still offers the one-time Worker
Previews setup; until that switch is made, Cloudflare's legacy preview model
uses production settings for non-production versions.
