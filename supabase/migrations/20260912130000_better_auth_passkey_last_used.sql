-- Better Auth's passkey plugin updates the credential counter but does not
-- retain when an individual credential was last used. Keep this metadata on
-- the credential row so protected account-security inventory views can show a
-- truthful timestamp without exposing any WebAuthn material.
alter table better_auth.passkey
  add column if not exists "lastUsedAt" timestamptz;

comment on column better_auth.passkey."lastUsedAt" is
  'Timestamp of the most recent successful WebAuthn authentication for this credential.';
