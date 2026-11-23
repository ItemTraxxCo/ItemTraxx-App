# Security gateway — work in progress

Do not deploy or route production traffic to this Worker yet. Application integration, rollout controls, operational reconciliation, Cloudflare bindings, and deployment are incomplete. The existing application still stores and reads plaintext borrower identifiers.

## Local lifecycle implementation

The Worker expects the `KEYS` KV binding and four secrets: `MASTER_KEK` (base64-encoded 32-byte key), `KMS_INTERNAL_SECRET` (crypto bearer), `KMS_LIFECYCLE_SECRET` (separate, privileged provisioning/revocation bearer), and `SUPABASE_SERVICE_ROLE_KEY`. `SUPABASE_URL` is an HTTPS configuration value. The service role grants broad database access; store it only as a Worker secret and assess a narrower coordinator credential before deployment. Do not expose either bearer or service-role credentials to browsers or log them.

`POST /v1/kms/generate-tenant-keys` and `/v1/kms/revoke-tenant-keys` accept `{ "workspace_id": "<uuid>" }`. Neither returns key material. The service-role-only lifecycle RPC maintains a durable workspace claim with states `provisioning`, `active`, `revoking`, and `revoked`. An atomic unique insert provides one provisioning claimant. Cryptographic requests check for the active state. Revocation claims the state before deleting KV. The lifecycle row survives workspace deletion; callers must explicitly invoke revocation during the workspace deletion workflow, which is not integrated yet.

The claim is a durable database lock, not a Postgres transaction held across a network call. Any uncertain KV write, failed delete, or uncertain completion leaves an intermediate state requiring manual investigation; retrying provisioning will not generate a replacement. Do not manually reset lifecycle states, reuse workspace IDs, restore an old lifecycle database, or overwrite a KV key without an audited recovery procedure. In particular, restoring a database snapshot from before key provisioning removes the claim; provisioning must remain disabled after a restore until the KV namespace and revocation history have been independently reconciled. This code does not yet provide that restore gate or a reconciliation tool.

A KV deletion does not prove physical destruction of provider-retained copies. Already-running requests may complete after revocation starts, and KV caching can delay propagation. These tests model KV operations, not real Cloudflare replication or the provider's retention behavior.

Run focused tests from the repository root:

```sh
fnm exec --using 24.22.3 -- node --test cloudflare/sgw/*.test.mjs
```

The SQL assertions in `supabase/tests/sgw_key_lifecycle_assertions.sql` require an isolated database with the migration and a workspace fixture. No tests in this directory establish production readiness.
