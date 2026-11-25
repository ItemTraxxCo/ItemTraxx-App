-- Cutover remains an operator-controlled, service-only operation. The caller
-- must first decrypt and verify every row under the same freeze generation.
alter table private.borrower_write_freezes add column encrypted_only boolean not null default false;

-- Do not create a replacement key when lifecycle metadata is absent but this
-- database still contains ciphertext or an encrypted-only workspace marker.
-- A restore from an older snapshot still requires the independent SGW hold.
create or replace function public.sgw_key_lifecycle_transition(p_workspace_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if p_action = 'claim_provision' then
    perform 1 from private.borrower_write_freezes where workspace_id=p_workspace_id and not encrypted_only for update;
    if not found or exists (select 1 from public.borrowers where workspace_id=p_workspace_id and encrypted_data is not null) then return false; end if;
    insert into public.sgw_workspace_key_lifecycle (workspace_id, state)
    select p_workspace_id, 'provisioning' where exists (select 1 from public.workspaces where id=p_workspace_id)
    on conflict (workspace_id) do nothing;
  elsif p_action = 'finish_provision' then
    update public.sgw_workspace_key_lifecycle set state='active',updated_at=now() where workspace_id=p_workspace_id and state='provisioning';
  elsif p_action = 'claim_revoke' then
    update public.sgw_workspace_key_lifecycle set state='revoking',updated_at=now() where workspace_id=p_workspace_id and state='active';
  elsif p_action = 'finish_revoke' then
    update public.sgw_workspace_key_lifecycle set state='revoked',updated_at=now() where workspace_id=p_workspace_id and state='revoking';
  elsif p_action = 'is_active' then
    return exists (select 1 from public.sgw_workspace_key_lifecycle where workspace_id=p_workspace_id and state='active');
  elsif p_action = 'is_revoking' then
    return exists (select 1 from public.sgw_workspace_key_lifecycle where workspace_id=p_workspace_id and state='revoking');
  elsif p_action = 'is_revoked' then
    return exists (select 1 from public.sgw_workspace_key_lifecycle where workspace_id=p_workspace_id and state='revoked');
  else raise exception 'Invalid lifecycle action'; end if;
  get diagnostics changed = row_count;
  return changed=1;
end $$;
revoke all on function public.sgw_key_lifecycle_transition(uuid,text) from public, anon, authenticated;
grant execute on function public.sgw_key_lifecycle_transition(uuid,text) to service_role;

create function public.borrower_workspace_encryption_enabled(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select encrypted_only from private.borrower_write_freezes where workspace_id=p_workspace_id
$$;
revoke all on function public.borrower_workspace_encryption_enabled(uuid) from public, anon, authenticated;
grant execute on function public.borrower_workspace_encryption_enabled(uuid) to service_role;

create function public.borrower_workspace_encryption_modes(p_workspace_ids uuid[])
returns table(workspace_id uuid, encrypted_only boolean) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_workspace_ids is null or cardinality(p_workspace_ids) > 500 or array_position(p_workspace_ids,null) is not null then
    raise exception 'Invalid workspace list' using errcode='22023';
  end if;
  return query select f.workspace_id,f.encrypted_only from private.borrower_write_freezes f where f.workspace_id = any(p_workspace_ids);
end $$;
revoke all on function public.borrower_workspace_encryption_modes(uuid[]) from public, anon, authenticated;
grant execute on function public.borrower_workspace_encryption_modes(uuid[]) to service_role;

-- A newly provisioned workspace may enter encrypted-only mode only while it
-- is suspended and empty; existing workspaces use the verified cutover path.
create function public.initialize_empty_workspace_borrower_encryption(p_workspace_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from private.borrower_write_freezes where workspace_id=p_workspace_id and not frozen for update;
  if not found then raise exception 'Workspace encryption state unavailable' using errcode='55000'; end if;
  perform 1 from public.workspaces where id=p_workspace_id and status='suspended' and archived_at is null for share;
  if not found then raise exception 'Workspace is not suspended' using errcode='55000'; end if;
  perform 1 from public.sgw_workspace_key_lifecycle where workspace_id=p_workspace_id and state='active' for share;
  if not found then raise exception 'Workspace key unavailable' using errcode='55000'; end if;
  if exists (select 1 from public.borrowers where workspace_id=p_workspace_id) then raise exception 'Workspace is not empty' using errcode='55000'; end if;
  update private.borrower_write_freezes set encrypted_only=true,updated_at=now() where workspace_id=p_workspace_id;
  return true;
end $$;
revoke all on function public.initialize_empty_workspace_borrower_encryption(uuid) from public, anon, authenticated;
grant execute on function public.initialize_empty_workspace_borrower_encryption(uuid) to service_role;

create function private.enforce_encrypted_borrower_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare encrypted boolean;
begin
  if tg_op = 'UPDATE' then
    select encrypted_only into encrypted from private.borrower_write_freezes where workspace_id=old.workspace_id for share;
    if not found then raise exception 'Workspace encryption state unavailable' using errcode='55000'; end if;
    if encrypted and (new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id) then
      raise exception 'Encrypted borrower identity cannot change' using errcode='23514';
    end if;
  end if;
  select encrypted_only into encrypted from private.borrower_write_freezes where workspace_id=new.workspace_id for share;
  if not found then raise exception 'Workspace encryption state unavailable' using errcode='55000'; end if;
  if encrypted and (new.username is distinct from 'enc_' || new.id::text or new.borrower_id is not null
    or coalesce(new.encrypted_data,'')='' or coalesce(new.nonce,'')='' or coalesce(new.auth_tag,'')=''
    or new.key_version is distinct from 1 or coalesce(new.borrower_id_hash,'') !~ '^[a-f0-9]{64}$'
    or (new.borrower_email_hash is not null and new.borrower_email_hash !~ '^[a-f0-9]{64}$')) then
    raise exception 'Encrypted borrower required' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.enforce_encrypted_borrower_write() from public, anon, authenticated, service_role;
create trigger enforce_encrypted_borrower_write before insert or update on public.borrowers
for each row execute function private.enforce_encrypted_borrower_write();

create function public.commit_borrower_encryption_cutover(p_workspace_id uuid, p_freeze_epoch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare freeze_row record; affected integer; audit_result jsonb;
begin
  if p_workspace_id is null or p_freeze_epoch is null then raise exception 'Invalid request' using errcode='22023'; end if;
  select frozen,freeze_epoch,encrypted_only into freeze_row from private.borrower_write_freezes where workspace_id=p_workspace_id for update;
  if not found or not freeze_row.frozen or freeze_row.freeze_epoch is distinct from p_freeze_epoch or freeze_row.encrypted_only then
    raise exception 'Borrower write freeze changed' using errcode='55000';
  end if;
  perform 1 from public.sgw_workspace_key_lifecycle where workspace_id=p_workspace_id and state='active' for share;
  if not found then raise exception 'Workspace key unavailable' using errcode='55000'; end if;
  if exists (select 1 from public.borrowers where workspace_id=p_workspace_id and
    (coalesce(encrypted_data,'')='' or coalesce(nonce,'')='' or coalesce(auth_tag,'')='' or key_version is distinct from 1 or coalesce(borrower_id_hash,'') !~ '^[a-f0-9]{64}$')) then
    raise exception 'Workspace backfill incomplete' using errcode='55000';
  end if;
  if exists (select 1 from public.borrowers where workspace_id=p_workspace_id group by borrower_id_hash having count(*) > 1) then
    raise exception 'Borrower index collision' using errcode='23505';
  end if;
  audit_result := public.scrub_borrower_identity_audit_metadata(p_workspace_id,p_freeze_epoch);
  insert into private.borrower_backfill_write_capabilities(backend_pid,transaction_id,workspace_id,borrower_id)
    select pg_catalog.pg_backend_pid(),pg_catalog.txid_current(),p_workspace_id,id from public.borrowers where workspace_id=p_workspace_id;
  update public.borrowers set username='enc_' || id::text, borrower_id=null where workspace_id=p_workspace_id;
  get diagnostics affected = row_count;
  delete from private.borrower_backfill_write_capabilities where backend_pid=pg_catalog.pg_backend_pid() and transaction_id=pg_catalog.txid_current() and workspace_id=p_workspace_id;
  update private.borrower_write_freezes set encrypted_only=true,updated_at=now() where workspace_id=p_workspace_id;
  -- Keep writes frozen until all workspace readers have switched to encrypted mode.
  return jsonb_build_object('borrowers',affected,'audit',audit_result);
end $$;
revoke all on function public.commit_borrower_encryption_cutover(uuid,uuid) from public, anon, authenticated;
grant execute on function public.commit_borrower_encryption_cutover(uuid,uuid) to service_role;
