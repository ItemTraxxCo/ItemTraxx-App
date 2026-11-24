-- Recheck the caller's access after locking the archived row, so a concurrent
-- access-mode change cannot turn an authorized decrypt into a restricted restore.
create or replace function public.restore_encrypted_borrower(
  p_workspace_id uuid, p_actor_id uuid, p_borrower_id uuid,
  p_expected_ciphertext text, p_expected_nonce text, p_expected_auth_tag text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare archived_row record; actor_role text;
begin
  select p.role into actor_role from public.profiles p join public.workspaces w on w.id=p.workspace_id
  where p.id=p_actor_id and p.workspace_id=p_workspace_id
    and p.role in ('workspace_admin','individual_account')
    and p.is_active is true and p.deleted_at is null and w.status='active';
  if actor_role is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  select id, access_mode, borrower_id_hash, encrypted_data, nonce, auth_tag, key_version, deleted_at
  into archived_row from public.borrowers
  where id=p_borrower_id and workspace_id=p_workspace_id and deleted_at is not null
  for update;
  if not found or (actor_role='individual_account' and archived_row.access_mode <> 'all') then return false; end if;
  if archived_row.key_version is distinct from 1 or archived_row.borrower_id_hash is null
     or archived_row.encrypted_data is distinct from p_expected_ciphertext
     or archived_row.nonce is distinct from p_expected_nonce
     or archived_row.auth_tag is distinct from p_expected_auth_tag then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_hash:' || archived_row.borrower_id_hash, 0));
  if exists (select 1 from public.borrowers b where b.workspace_id=p_workspace_id and b.id<>p_borrower_id and b.deleted_at is null and b.borrower_id_hash=archived_row.borrower_id_hash) then
    raise exception 'Borrower ID already exists' using errcode='23505';
  end if;
  update public.borrowers set deleted_at=null, deleted_by=null where id=p_borrower_id and workspace_id=p_workspace_id;
  insert into public.admin_audit_logs(workspace_id,actor_id,action_type,entity_type,entity_id,metadata)
  values (p_workspace_id,p_actor_id,'borrower_restore','borrower',p_borrower_id,jsonb_build_object('previous_deleted_at',archived_row.deleted_at));
  return true;
end; $$;
revoke all on function public.restore_encrypted_borrower(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.restore_encrypted_borrower(uuid,uuid,uuid,text,text,text) to service_role;
