-- Preserve encrypted borrower operations while both legacy columns exist and after their eventual removal.
CREATE OR REPLACE FUNCTION private.enforce_encrypted_borrower_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if encrypted and ((to_jsonb(new) ? 'username' and to_jsonb(new)->>'username' is distinct from 'enc_' || new.id::text) or to_jsonb(new)->>'borrower_id' is not null
    or coalesce(new.encrypted_data,'')='' or coalesce(new.nonce,'')='' or coalesce(new.auth_tag,'')=''
    or new.key_version is distinct from 1 or coalesce(new.borrower_id_hash,'') !~ '^[a-f0-9]{64}$'
    or (new.borrower_email_hash is not null and new.borrower_email_hash !~ '^[a-f0-9]{64}$')) then
    raise exception 'Encrypted borrower required' using errcode='23514';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.archive_borrower_with_audit(p_workspace_id uuid, p_actor_id uuid, p_borrower_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  update public.borrowers as borrower
  set deleted_at = now(), deleted_by = p_actor_id
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is null
  returning borrower.id, to_jsonb(borrower)->>'username', to_jsonb(borrower)->>'borrower_id'
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_encrypted_borrower(p_id uuid, p_workspace_id uuid, p_actor_id uuid, p_encrypted_data text, p_nonce text, p_auth_tag text, p_borrower_id_hash text, p_borrower_email_hash text, p_access_mode text, p_profile_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if exists (select 1 from pg_catalog.pg_attribute where attrelid='public.borrowers'::regclass and attname='username' and not attisdropped) then
  insert into public.borrowers(id, workspace_id, username, borrower_id, access_mode, encrypted_data, nonce, auth_tag, key_version, borrower_id_hash, borrower_email_hash)
  values (p_id, p_workspace_id, 'enc_' || p_id::text, null, p_access_mode, p_encrypted_data, p_nonce, p_auth_tag, 1, p_borrower_id_hash, p_borrower_email_hash);
  else
  insert into public.borrowers(id, workspace_id, access_mode, encrypted_data, nonce, auth_tag, key_version, borrower_id_hash, borrower_email_hash)
  values (p_id, p_workspace_id, p_access_mode, p_encrypted_data, p_nonce, p_auth_tag, 1, p_borrower_id_hash, p_borrower_email_hash);
  end if;
  if p_access_mode = 'restricted' then
    insert into public.borrower_access_grants(borrower_id, profile_id, granted_by)
    select p_id, target.id, p_actor_id from unnest(p_profile_ids) as target(id);
  end if;
  insert into public.admin_audit_logs(workspace_id, actor_id, action_type, entity_type, entity_id, metadata)
  values (p_workspace_id, p_actor_id, 'borrower_create', 'borrower', p_id, jsonb_build_object('access_mode', p_access_mode));
  return p_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.super_create_encrypted_borrower(p_id uuid, p_workspace_id uuid, p_actor_id uuid, p_encrypted_data text, p_nonce text, p_auth_tag text, p_borrower_id_hash text, p_borrower_email_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_id is null or p_workspace_id is null or p_actor_id is null
    or coalesce(p_encrypted_data, '') = '' or coalesce(p_nonce, '') = '' or coalesce(p_auth_tag, '') = ''
    or coalesce(p_borrower_id_hash, '') !~ '^[a-f0-9]{64}$'
    or (p_borrower_email_hash is not null and p_borrower_email_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid encrypted borrower' using errcode = '22023';
  end if;
  perform 1 from public.profiles p where p.id = p_actor_id and p.role = 'super_admin' and p.is_active is true and p.deleted_at is null for share;
  if not found then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.status = 'active') then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.borrowers b where b.workspace_id = p_workspace_id and b.encrypted_data is null) then
    raise exception 'Workspace backfill incomplete' using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_hash:' || p_borrower_id_hash, 0));
  if exists (select 1 from public.borrowers b where b.workspace_id = p_workspace_id and b.borrower_id_hash = p_borrower_id_hash and b.deleted_at is null) then
    raise exception 'Borrower ID already exists' using errcode = '23505';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute where attrelid='public.borrowers'::regclass and attname='username' and not attisdropped) then
  insert into public.borrowers(id, workspace_id, username, borrower_id, access_mode, encrypted_data, nonce, auth_tag, key_version, borrower_id_hash, borrower_email_hash)
  values (p_id, p_workspace_id, 'enc_' || p_id::text, null, 'all', p_encrypted_data, p_nonce, p_auth_tag, 1, p_borrower_id_hash, p_borrower_email_hash);
  else
  insert into public.borrowers(id, workspace_id, access_mode, encrypted_data, nonce, auth_tag, key_version, borrower_id_hash, borrower_email_hash)
  values (p_id, p_workspace_id, 'all', p_encrypted_data, p_nonce, p_auth_tag, 1, p_borrower_id_hash, p_borrower_email_hash);
  end if;
  insert into public.super_admin_audit_logs(actor_id, actor_email, action_type, target_type, target_id, metadata)
  select (select u.id from auth.users u where u.id = p.id), p.auth_email, 'create_borrower', 'borrower', p_id::text, jsonb_build_object('workspace_id', p_workspace_id, 'actor_profile_id', p.id)
  from public.profiles p where p.id = p_actor_id;
  return p_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.update_borrower_access_with_audit(p_workspace_id uuid, p_actor_id uuid, p_borrower_id uuid, p_access_mode text, p_profile_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  select to_jsonb(borrower)->>'username', to_jsonb(borrower)->>'borrower_id', borrower.access_mode
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
$function$
;


