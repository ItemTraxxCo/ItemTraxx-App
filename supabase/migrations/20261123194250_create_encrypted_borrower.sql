-- Atomic service-only creation. No name, email, or external borrower ID is
-- accepted by this function or stored in plaintext audit metadata.
create function public.create_encrypted_borrower(
  p_id uuid, p_workspace_id uuid, p_actor_id uuid,
  p_encrypted_data text, p_nonce text, p_auth_tag text,
  p_borrower_id_hash text, p_borrower_email_hash text,
  p_access_mode text, p_profile_ids uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_role text;
begin
  if p_id is null or p_workspace_id is null or p_actor_id is null
    or coalesce(p_encrypted_data, '') = '' or coalesce(p_nonce, '') = '' or coalesce(p_auth_tag, '') = ''
    or coalesce(p_borrower_id_hash, '') !~ '^[a-f0-9]{64}$'
    or (p_borrower_email_hash is not null and p_borrower_email_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid encrypted borrower' using errcode = '22023';
  end if;
  select p.role into actor_role from public.profiles p join public.workspaces w on w.id = p.workspace_id
  where p.id = p_actor_id and p.workspace_id = p_workspace_id and p.role in ('workspace_admin', 'individual_account')
    and p.is_active is true and p.deleted_at is null and w.status = 'active';
  if actor_role is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  p_profile_ids := coalesce(p_profile_ids, '{}'::uuid[]);
  if p_access_mode not in ('all', 'restricted') or p_access_mode is null
     or (p_access_mode = 'restricted' and cardinality(p_profile_ids) = 0)
     or (actor_role = 'individual_account' and (p_access_mode <> 'all' or cardinality(p_profile_ids) > 0)) then
    raise exception 'Invalid access' using errcode = '22023';
  end if;
  if p_access_mode = 'restricted' and exists (
    select 1 from unnest(p_profile_ids) as target(id)
    left join public.profiles p on p.id = target.id
    where p.id is null or p.workspace_id <> p_workspace_id or p.role <> 'tenant_account' or p.is_active is not true or p.deleted_at is not null
  ) then raise exception 'Invalid access grant' using errcode = '22023'; end if;
  if exists (select 1 from public.borrowers b where b.workspace_id = p_workspace_id and b.encrypted_data is null) then
    raise exception 'Workspace backfill incomplete' using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_hash:' || p_borrower_id_hash, 0));
  if exists (select 1 from public.borrowers b where b.workspace_id = p_workspace_id and b.borrower_id_hash = p_borrower_id_hash and b.deleted_at is null) then
    raise exception 'Borrower ID already exists' using errcode = '23505';
  end if;
  insert into public.borrowers(id, workspace_id, username, borrower_id, access_mode, encrypted_data, nonce, auth_tag, key_version, borrower_id_hash, borrower_email_hash)
  values (p_id, p_workspace_id, 'enc_' || p_id::text, null, p_access_mode, p_encrypted_data, p_nonce, p_auth_tag, 1, p_borrower_id_hash, p_borrower_email_hash);
  if p_access_mode = 'restricted' then
    insert into public.borrower_access_grants(borrower_id, profile_id, granted_by)
    select p_id, target.id, p_actor_id from unnest(p_profile_ids) as target(id);
  end if;
  insert into public.admin_audit_logs(workspace_id, actor_id, action_type, entity_type, entity_id, metadata)
  values (p_workspace_id, p_actor_id, 'borrower_create', 'borrower', p_id, jsonb_build_object('access_mode', p_access_mode));
  return p_id;
end; $$;
revoke all on function public.create_encrypted_borrower(uuid,uuid,uuid,text,text,text,text,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.create_encrypted_borrower(uuid,uuid,uuid,text,text,text,text,text,text,uuid[]) to service_role;
