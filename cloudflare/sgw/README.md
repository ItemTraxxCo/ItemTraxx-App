# Security gateway — work in progress

Do not deploy or route production traffic to this Worker yet. Application integration, rollout controls, operational reconciliation, Cloudflare bindings, and deployment are incomplete. The existing application still stores and reads plaintext borrower identifiers.

## Cloudflare Workers Builds

For the `itemtraxx-sgw` Worker, configure **Settings > Build** with:

- Root directory: repository root (`/`).
- Build command: leave empty; this Worker does not need the frontend Vite build.
- Deploy command: `npm run deploy:cloudflare:sgw`.

The deploy script selects this Worker's Wrangler configuration explicitly and preserves dashboard-managed variables. An unqualified `wrangler deploy` can conflict with the frontend's generated `.wrangler/deploy/config.json` after a Vite build. Updating this repository alone does not change existing Workers Builds settings; save the settings in Cloudflare before retrying the build. Do not enable preview deployments against production keys or KV without isolated preview bindings.

## Local lifecycle implementation

The Worker expects the `KEYS` KV binding and four secrets: `MASTER_KEK` (base64-encoded 32-byte key), `KMS_INTERNAL_SECRET` (crypto bearer), `KMS_LIFECYCLE_SECRET` (separate, privileged provisioning/revocation bearer), and `SUPABASE_SERVICE_ROLE_KEY` (a Supabase secret API key, `sb_secret_…`). Despite its binding name, this should contain the dedicated new API secret key, not the legacy service-role JWT. `SUPABASE_URL` is an HTTPS configuration value. The API secret grants broad database access; store it only as a Worker secret and assess a narrower coordinator credential before deployment. Do not expose either bearer or database credentials to browsers or log them.

`POST /v1/kms/generate-tenant-keys` and `/v1/kms/revoke-tenant-keys` accept `{ "workspace_id": "<uuid>" }`. Neither returns key material. The service-role-only lifecycle RPC maintains a durable workspace claim with states `provisioning`, `active`, `revoking`, and `revoked`. An atomic unique insert provides one provisioning claimant. Cryptographic requests check for the active state. Revocation claims the state before deleting KV. The lifecycle row survives workspace deletion; callers must explicitly invoke revocation during the workspace deletion workflow, which is not integrated yet.

The claim is a durable database lock, not a Postgres transaction held across a network call. Any uncertain KV write, failed delete, or uncertain completion leaves an intermediate state requiring manual investigation; retrying provisioning will not generate a replacement. Do not manually reset lifecycle states, reuse workspace IDs, restore an old lifecycle database, or overwrite a KV key without an audited recovery procedure. In particular, restoring a database snapshot from before key provisioning removes the claim; provisioning must remain disabled after a restore until the KV namespace and revocation history have been independently reconciled. This code does not yet provide an automatic restore gate or a reconciliation tool.

Provisioning now defaults to disabled unless the Worker environment explicitly sets `SGW_PROVISIONING_ENABLED` to `true`. Before any database restore, close this gate at the Worker and verify the deployed configuration; keep it closed through reconciliation. This is an operational switch, not automatic restore detection: restoring without closing it is unsafe. The switch does not affect decryption or revocation. The scheduled workspace purge requests revocation for active and revoking keys and requires confirmation before deletion. Revoked keys are terminal, and an interrupted KV deletion can be retried. A provisioning state or missing lifecycle row blocks purge, including for legacy workspaces, until reconciled. Automated restore recovery remains unimplemented.

For a database restore, set the independent Worker variable `SGW_RESTORE_HOLD=true` and verify it has propagated **before** the restore begins. It blocks provisioning, revocation, encryption, decryption, and blind-index operations without consulting the restored database or KV. Keep the hold in place until the restored lifecycle records have been reconciled against independently retained key and revocation history; clearing a hold is a manual operator action. The Worker cannot detect a database restore automatically, and this switch does not invalidate responses already in flight or erase cached key material.

The local workspace-creation integration is opt-in via the Edge Function variable `ITX_SGW_PROVISION_NEW_WORKSPACES=true` and the separately configured secret `ITX_SGW_LIFECYCLE_SECRET` matching the Worker's lifecycle bearer. The job worker also needs that secret to revoke keys on purge. Never expose it to clients. While enabled, new workspace and individual accounts remain suspended until provisioning succeeds. An ambiguous failure leaves a suspended account for operator reconciliation; do not retry by creating a replacement workspace or resetting its lifecycle state. Existing workspaces without keys cannot be reactivated while this flag is enabled. Apply and verify the retry-safe coordinator migration before deploying the updated Worker and job worker. Do not enable the integration until existing-workspace provisioning, restore reconciliation, and end-to-end tests are complete. A successful KV write can still take time to become visible in other regions.

The workspace-mode cutover work adds a second activation prerequisite: after a key is provisioned, the suspended workspace must be empty and initialized for encrypted-only borrower writes before it can become active. Existing workspaces use the separately verified backfill and cutover procedure. The lifecycle coordinator refuses a new provisioning claim if ciphertext or the encrypted-only marker is already present, but this is not sufficient to detect a restore from a snapshot that predates both; the independent restore hold and reconciliation are still required.

The Better Auth proxy's backward-compatible membership synchronization must be deployed **before** the suspended-workspace setup migration: the previous proxy expects the old intermediate `workspace_admin` membership role and rejects the new atomic `admin` role. Keep workspace-key provisioning disabled through both deployments and verify them before enabling it.

A KV deletion does not prove physical destruction of provider-retained copies. Already-running requests may complete after revocation starts, and KV caching can delay propagation. These tests model KV operations, not real Cloudflare replication or the provider's retention behavior.

Run focused tests from the repository root:

```sh
fnm exec --using 24.22.3 -- node --test cloudflare/sgw/*.test.mjs
```

The SQL assertions in `supabase/tests/sgw_key_lifecycle_assertions.sql` require an isolated database with the migration and a workspace fixture. No tests in this directory establish production readiness.
