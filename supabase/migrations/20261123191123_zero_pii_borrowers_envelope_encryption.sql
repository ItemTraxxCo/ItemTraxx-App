-- Additive rollout: existing plaintext fields and rows remain unchanged.
alter table public.borrowers
  add column encrypted_data text,
  add column nonce text,
  add column auth_tag text,
  add column key_version integer,
  add column borrower_id_hash text,
  add column borrower_email_hash text;

create index idx_borrowers_workspace_borrower_id_hash
  on public.borrowers (workspace_id, borrower_id_hash)
  where borrower_id_hash is not null;
create index idx_borrowers_workspace_borrower_email_hash
  on public.borrowers (workspace_id, borrower_email_hash)
  where borrower_email_hash is not null;
