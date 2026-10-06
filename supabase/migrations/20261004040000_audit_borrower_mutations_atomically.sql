begin;

-- The mutation endpoint uses a service-role client, so auth.uid() is NULL in
-- these functions. The authenticated actor is resolved by the Edge Function
-- and passed from its verified profile; the write and its audit event share
-- the same PostgreSQL transaction.
create or replace function public.create_borrower_identity(
  p_workspace_id uuid,
  p_username text,
  p_borrower_id text,
  p_access_mode text,
  p_profile_ids uuid[] default '{}'::uuid[],
  p_granted_by uuid default null
)
returns table(
  id uuid,
  workspace_id uuid,
  username text,
  borrower_id text,
  access_mode text
)
language plpgsql security definer
set search_path = ''
as $$
declare
  normalized_username text := coalesce(trim(p_username), '');
  normalized_borrower_id text := upper(coalesce(trim(p_borrower_id), ''));
  normalized_profile_ids uuid[] := coalesce(p_profile_ids, '{}'::uuid[]);
  created_id uuid;
  actor_role text := (select current_setting('role', true));
  resolved_actor_role text;
begin
  if p_workspace_id is null or p_granted_by is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_granted_by
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';

  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if actor_role is distinct from 'service_role' then
    if p_workspace_id <> (select public.current_workspace_id())
       or resolved_actor_role <> 'workspace_admin'
       or not (select private.current_account_session_is_active()) then
      raise exception 'Unauthorized' using errcode = '42501';
    end if;
  end if;

  if p_access_mode is null
     or p_access_mode not in ('all', 'restricted')
     or (p_access_mode = 'restricted' and cardinality(normalized_profile_ids) = 0) then
    raise exception 'Access choice is required' using errcode = '22023';
  end if;
  if resolved_actor_role = 'individual_account'
     and (p_access_mode <> 'all' or cardinality(normalized_profile_ids) > 0) then
    raise exception 'Individual Account borrowers must be available to the account owner.' using errcode = '22023';
  end if;
  if normalized_username = '' or normalized_borrower_id = '' then
    raise exception 'Borrower identity is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_id:' || normalized_borrower_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':username:' || lower(normalized_username), 0));

  insert into public.borrowers(workspace_id, username, borrower_id, access_mode)
  values (p_workspace_id, normalized_username, normalized_borrower_id, p_access_mode)
  returning borrowers.id into created_id;

  if p_access_mode = 'restricted' then
    if exists (
      select 1
      from unnest(normalized_profile_ids) as target(profile_id)
      left join public.profiles as profile on profile.id = target.profile_id
      where profile.id is null
        or profile.workspace_id <> p_workspace_id
        or profile.role <> 'tenant_account'
        or not profile.is_active
        or profile.deleted_at is not null
    ) then
      raise exception 'Invalid Tenant Account grant' using errcode = '22023';
    end if;
    insert into public.borrower_access_grants(borrower_id, profile_id, granted_by)
    select created_id, profile_id, p_granted_by
    from unnest(normalized_profile_ids) as target(profile_id);
  end if;

  insert into public.admin_audit_logs(
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_granted_by,
    'borrower_create',
    'borrower',
    created_id,
    jsonb_build_object(
      'borrower_id', normalized_borrower_id,
      'username', normalized_username,
      'access_mode', p_access_mode,
      'profile_ids', case
        when p_access_mode = 'restricted' then to_jsonb(normalized_profile_ids)
        else '[]'::jsonb
      end
    )
  );

  return query
  select borrower.id, borrower.workspace_id, borrower.username,
    borrower.borrower_id, borrower.access_mode
  from public.borrowers as borrower
  where borrower.id = created_id;
end;
$$;

create or replace function public.archive_borrower_with_audit(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_borrower_id uuid
)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  resolved_actor_role text;
  archived_id uuid;
  archived_username text;
  archived_borrower_id text;
begin
  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  -- Serialize borrower archival with checkout. Checkout locks this borrower
  -- before writing checked_out_by; after any wait here, the following
  -- statement gets a fresh READ COMMITTED snapshot and sees a checkout that
  -- committed while this request was waiting.
  perform borrower.id
  from public.borrowers as borrower
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is null
  for update;
  if not found then
    return false;
  end if;

  if exists (
    select 1
    from public.items as item
    where item.workspace_id = p_workspace_id
      and item.checked_out_by = p_borrower_id
      and item.deleted_at is null
  ) then
    raise exception 'Return all checked-out items before archiving this borrower.'
      using errcode = '23514';
  end if;

  update public.borrowers as borrower
  set deleted_at = now(), deleted_by = p_actor_id
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is null
  returning borrower.id, borrower.username, borrower.borrower_id
  into archived_id, archived_username, archived_borrower_id;

  if not found then
    return false;
  end if;

  insert into public.admin_audit_logs(
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'borrower_archive',
    'borrower',
    archived_id,
    jsonb_build_object('borrower_id', archived_borrower_id, 'username', archived_username)
  );

  return true;
end;
$$;

create or replace function public.restore_borrower_with_audit(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_borrower_id uuid
)
returns table(
  id uuid,
  workspace_id uuid,
  username text,
  borrower_id text
)
language plpgsql security definer
set search_path = ''
as $$
declare
  resolved_actor_role text;
  archived_row record;
  restored_id uuid;
  restored_workspace_id uuid;
  restored_username text;
  restored_borrower_id text;
begin
  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select borrower.id, borrower.workspace_id, borrower.username, borrower.borrower_id, borrower.deleted_at
  into archived_row
  from public.borrowers as borrower
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is not null
  for update;
  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_id:' || upper(archived_row.borrower_id), 0));
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':username:' || lower(archived_row.username), 0));

  if exists (
    select 1
    from public.borrowers as borrower
    where borrower.workspace_id = p_workspace_id
      and borrower.id <> archived_row.id
      and borrower.deleted_at is null
      and (
        upper(borrower.borrower_id) = upper(archived_row.borrower_id)
        or lower(borrower.username) = lower(archived_row.username)
      )
  ) then
    raise exception 'Borrower ID or username already exists.' using errcode = '23505';
  end if;

  update public.borrowers as borrower
  set deleted_at = null, deleted_by = null
  where borrower.id = archived_row.id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is not null
  returning borrower.id, borrower.workspace_id, borrower.username, borrower.borrower_id
  into restored_id, restored_workspace_id, restored_username, restored_borrower_id;
  if not found then
    return;
  end if;

  insert into public.admin_audit_logs(
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'borrower_restore',
    'borrower',
    restored_id,
    jsonb_build_object(
      'borrower_id', restored_borrower_id,
      'username', restored_username,
      'previous_deleted_at', archived_row.deleted_at
    )
  );

  return query select restored_id, restored_workspace_id, restored_username, restored_borrower_id;
end;
$$;

create or replace function public.update_borrower_access_with_audit(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_borrower_id uuid,
  p_access_mode text,
  p_profile_ids uuid[] default '{}'::uuid[]
)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  resolved_actor_role text;
  borrower_username text;
  borrower_identifier text;
  previous_access_mode text;
  previous_profile_ids uuid[];
  requested_profile_ids uuid[];
  applied_profile_ids uuid[];
  valid_profile_count bigint;
begin
  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_access_mode is null or p_access_mode not in ('all', 'restricted') then
    raise exception 'Access choice is required' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct requested.profile_id order by requested.profile_id), '{}'::uuid[])
  into requested_profile_ids
  from unnest(coalesce(p_profile_ids, '{}'::uuid[])) as requested(profile_id);
  if array_position(requested_profile_ids, null::uuid) is not null then
    raise exception 'Invalid Tenant Account selection.' using errcode = '22023';
  end if;

  if resolved_actor_role = 'individual_account'
     and (p_access_mode <> 'all' or cardinality(requested_profile_ids) > 0) then
    raise exception 'Individual Account borrowers must be available to the account owner.' using errcode = '22023';
  end if;
  if p_access_mode = 'restricted' and cardinality(requested_profile_ids) = 0 then
    raise exception 'Select at least one Tenant Account.' using errcode = '22023';
  end if;

  if cardinality(requested_profile_ids) > 0 then
    select count(*) into valid_profile_count
    from public.profiles as profile
    where profile.id = any(requested_profile_ids)
      and profile.workspace_id = p_workspace_id
      and profile.role = 'tenant_account'
      and profile.is_active is true
      and profile.deleted_at is null;
    if valid_profile_count <> cardinality(requested_profile_ids) then
      raise exception 'Invalid Tenant Account selection.' using errcode = '22023';
    end if;
  end if;

  select borrower.username, borrower.borrower_id, borrower.access_mode
  into borrower_username, borrower_identifier, previous_access_mode
  from public.borrowers as borrower
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is null
  for update;
  if not found then
    return false;
  end if;

  select coalesce(array_agg(grant_row.profile_id order by grant_row.profile_id), '{}'::uuid[])
  into previous_profile_ids
  from public.borrower_access_grants as grant_row
  where grant_row.borrower_id = p_borrower_id;

  applied_profile_ids := case
    when p_access_mode = 'restricted' then requested_profile_ids
    else '{}'::uuid[]
  end;

  update public.borrowers as borrower
  set access_mode = p_access_mode
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is null;

  delete from public.borrower_access_grants as grant_row
  where grant_row.borrower_id = p_borrower_id;

  if p_access_mode = 'restricted' then
    insert into public.borrower_access_grants(borrower_id, profile_id, granted_by)
    select p_borrower_id, requested.profile_id, p_actor_id
    from unnest(applied_profile_ids) as requested(profile_id);
  end if;

  insert into public.admin_audit_logs(
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'borrower_access_update',
    'borrower',
    p_borrower_id,
    jsonb_build_object(
      'borrower_id', borrower_identifier,
      'username', borrower_username,
      'before', jsonb_build_object(
        'access_mode', previous_access_mode,
        'profile_ids', to_jsonb(previous_profile_ids)
      ),
      'after', jsonb_build_object(
        'access_mode', p_access_mode,
        'profile_ids', to_jsonb(applied_profile_ids)
      )
    )
  );

  return true;
end;
$$;

revoke all on function public.create_borrower_identity(uuid, text, text, text, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.create_borrower_identity(uuid, text, text, text, uuid[], uuid) to service_role;

revoke all on function public.archive_borrower_with_audit(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.archive_borrower_with_audit(uuid, uuid, uuid) to service_role;

revoke all on function public.restore_borrower_with_audit(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.restore_borrower_with_audit(uuid, uuid, uuid) to service_role;

revoke all on function public.update_borrower_access_with_audit(uuid, uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.update_borrower_access_with_audit(uuid, uuid, uuid, text, uuid[]) to service_role;

notify pgrst, 'reload schema';

commit;
