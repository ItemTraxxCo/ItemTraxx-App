-- Every freeze transition invalidates the previous generation, including an
-- unfreeze/re-freeze between two backfill requests.
alter table private.borrower_write_freezes add column freeze_epoch uuid not null default gen_random_uuid();

create or replace function public.set_borrower_write_freeze(p_workspace_id uuid, p_frozen boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_workspace_id is null or p_frozen is null then raise exception 'Invalid freeze request' using errcode='22023'; end if;
  update private.borrower_write_freezes set frozen=p_frozen, freeze_epoch=pg_catalog.gen_random_uuid(), updated_at=now() where workspace_id=p_workspace_id;
  if not found then raise exception 'Workspace freeze state unavailable' using errcode='55000'; end if;
end $$;

create function public.borrower_write_freeze_epoch(p_workspace_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select freeze_epoch from private.borrower_write_freezes where workspace_id=p_workspace_id and frozen
$$;
revoke all on function public.borrower_write_freeze_epoch(uuid) from public, anon, authenticated;
grant execute on function public.borrower_write_freeze_epoch(uuid) to service_role;

-- Retire the epoch-unaware entry point so it cannot bypass this guard.
revoke all on function public.backfill_encrypted_borrower(uuid,uuid,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;

create function public.backfill_encrypted_borrower_v2(
  p_workspace_id uuid, p_id uuid, p_expected_username text, p_expected_borrower_id text,
  p_ciphertext text, p_nonce text, p_auth_tag text, p_borrower_id_hash text, p_email_hash text,
  p_freeze_epoch uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer; freeze_row record;
begin
  if p_workspace_id is null or p_id is null or p_freeze_epoch is null or p_expected_username is null or p_expected_borrower_id is null
     or coalesce(p_ciphertext,'')='' or coalesce(p_nonce,'')='' or coalesce(p_auth_tag,'')=''
     or coalesce(p_borrower_id_hash,'') !~ '^[a-f0-9]{64}$'
     or (p_email_hash is not null and p_email_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid encrypted borrower' using errcode='22023';
  end if;
  select frozen,freeze_epoch into freeze_row from private.borrower_write_freezes where workspace_id=p_workspace_id for share;
  if not found or not freeze_row.frozen or freeze_row.freeze_epoch is distinct from p_freeze_epoch then
    raise exception 'Borrower write freeze changed' using errcode='55000';
  end if;
  insert into private.borrower_backfill_write_capabilities values (pg_catalog.pg_backend_pid(),pg_catalog.txid_current(),p_workspace_id,p_id);
  update public.borrowers set encrypted_data=p_ciphertext,nonce=p_nonce,auth_tag=p_auth_tag,
    key_version=1,borrower_id_hash=p_borrower_id_hash,borrower_email_hash=p_email_hash
  where workspace_id=p_workspace_id and id=p_id and username=p_expected_username
    and borrower_id=p_expected_borrower_id and encrypted_data is null;
  get diagnostics changed = row_count;
  delete from private.borrower_backfill_write_capabilities where backend_pid=pg_catalog.pg_backend_pid()
    and transaction_id=pg_catalog.txid_current() and workspace_id=p_workspace_id and borrower_id=p_id;
  return changed=1;
end $$;
revoke all on function public.backfill_encrypted_borrower_v2(uuid,uuid,text,text,text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.backfill_encrypted_borrower_v2(uuid,uuid,text,text,text,text,text,text,text,uuid) to service_role;
