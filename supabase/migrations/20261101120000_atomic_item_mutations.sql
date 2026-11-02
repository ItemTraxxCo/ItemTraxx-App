begin;

-- Keep item rows, account grants, status history, and audit records in one
-- transaction. The Edge Function verifies the session and passes its profile
-- ID; the RPC rechecks that identity against the active workspace.
create or replace function public.create_item_with_access_and_audit(
  p_workspace_id uuid,
  p_name text,
  p_barcode text,
  p_serial_number text,
  p_status text,
  p_notes text,
  p_access_mode text,
  p_profile_ids uuid[],
  p_actor_id uuid
)
returns table(
  id uuid,
  workspace_id uuid,
  name text,
  barcode text,
  serial_number text,
  status text,
  notes text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_profile_ids uuid[] := coalesce(p_profile_ids, '{}'::uuid[]);
  actor_role text := current_setting('role', true);
  resolved_actor_role text;
  created_id uuid;
begin
  if p_workspace_id is null or p_actor_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

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

  if actor_role is distinct from 'service_role' then
    if p_workspace_id <> (select public.current_workspace_id())
       or resolved_actor_role <> 'workspace_admin'
       or not (select private.current_account_session_is_active()) then
      raise exception 'Unauthorized' using errcode = '42501';
    end if;
  end if;

  if p_access_mode is null
     or p_access_mode not in ('all', 'restricted')
     or (p_access_mode = 'restricted' and cardinality(normalized_profile_ids) = 0)
     or p_name is null
     or btrim(p_name) = ''
     or p_barcode is null
     or btrim(p_barcode) = ''
     or p_status is null
     or p_status not in (
       'available', 'checked_out', 'damaged', 'lost', 'in_repair',
       'retired', 'in_studio_only'
     ) then
    raise exception 'Invalid item mutation' using errcode = '22023';
  end if;

  if resolved_actor_role = 'individual_account'
     and (p_access_mode <> 'all' or cardinality(normalized_profile_ids) > 0) then
    raise exception 'Individual Account items must be available to the account owner.' using errcode = '22023';
  end if;

  if p_access_mode = 'restricted' and exists (
    select 1
    from unnest(normalized_profile_ids) as target(profile_id)
    left join public.profiles as profile on profile.id = target.profile_id
    where profile.id is null
       or profile.workspace_id <> p_workspace_id
       or profile.role <> 'tenant_account'
       or profile.is_active is not true
       or profile.deleted_at is not null
  ) then
    raise exception 'Invalid Tenant Account grant' using errcode = '22023';
  end if;

  insert into public.items(
    workspace_id, name, barcode, serial_number, status, notes, access_mode
  ) values (
    p_workspace_id, btrim(p_name), btrim(p_barcode), nullif(btrim(p_serial_number), ''),
    p_status, nullif(btrim(p_notes), ''), p_access_mode
  ) returning items.id into created_id;

  if p_access_mode = 'restricted' then
    insert into public.item_access_grants(item_id, profile_id, granted_by)
    select created_id, target.profile_id, p_actor_id
    from unnest(normalized_profile_ids) as target(profile_id);
  end if;

  if p_status not in ('available', 'checked_out') then
    insert into public.item_status_history(
      workspace_id, item_id, status, note, changed_by
    ) values (
      p_workspace_id, created_id, p_status, nullif(btrim(p_notes), ''), p_actor_id
    );
  end if;

  insert into public.admin_audit_logs(
    workspace_id, actor_id, action_type, entity_type, entity_id, metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'item_create',
    'items',
    created_id,
    jsonb_build_object(
      'barcode', btrim(p_barcode),
      'status', p_status,
      'has_serial_number', nullif(btrim(p_serial_number), '') is not null,
      'access_mode', p_access_mode,
      'profile_ids', case when p_access_mode = 'restricted'
        then to_jsonb(normalized_profile_ids) else '[]'::jsonb end
    )
  );

  return query
  select item.id, item.workspace_id, item.name, item.barcode,
    item.serial_number, item.status, item.notes
  from public.items as item
  where item.id = created_id;
end;
$$;

create or replace function public.update_item_with_access_and_audit(
  p_workspace_id uuid,
  p_item_id uuid,
  p_name text,
  p_barcode text,
  p_status text,
  p_notes text,
  p_access_mode text,
  p_profile_ids uuid[],
  p_actor_id uuid,
  p_expected_status text,
  p_expected_checked_out_by uuid,
  p_expected_checked_out_at timestamptz
)
returns table(
  id uuid,
  workspace_id uuid,
  name text,
  barcode text,
  serial_number text,
  status text,
  notes text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_profile_ids uuid[] := coalesce(p_profile_ids, '{}'::uuid[]);
  actor_role text := current_setting('role', true);
  resolved_actor_role text;
  current_item public.items%rowtype;
begin
  if p_workspace_id is null or p_item_id is null or p_actor_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

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

  if actor_role is distinct from 'service_role' then
    if p_workspace_id <> (select public.current_workspace_id())
       or resolved_actor_role <> 'workspace_admin'
       or not (select private.current_account_session_is_active()) then
      raise exception 'Unauthorized' using errcode = '42501';
    end if;
  end if;

  if p_access_mode is null
     or p_access_mode not in ('all', 'restricted')
     or (p_access_mode = 'restricted' and cardinality(normalized_profile_ids) = 0)
     or p_name is null
     or btrim(p_name) = ''
     or p_barcode is null
     or btrim(p_barcode) = ''
     or p_status is null
     or p_status not in (
       'available', 'checked_out', 'damaged', 'lost', 'in_repair',
       'retired', 'in_studio_only'
     ) then
    raise exception 'Invalid item mutation' using errcode = '22023';
  end if;

  if resolved_actor_role = 'individual_account'
     and (p_access_mode <> 'all' or cardinality(normalized_profile_ids) > 0) then
    raise exception 'Individual Account items must be available to the account owner.' using errcode = '22023';
  end if;

  if p_access_mode = 'restricted' and exists (
    select 1
    from unnest(normalized_profile_ids) as target(profile_id)
    left join public.profiles as profile on profile.id = target.profile_id
    where profile.id is null
       or profile.workspace_id <> p_workspace_id
       or profile.role <> 'tenant_account'
       or profile.is_active is not true
       or profile.deleted_at is not null
  ) then
    raise exception 'Invalid Tenant Account grant' using errcode = '22023';
  end if;

  select item.*
  into current_item
  from public.items as item
  where item.id = p_item_id
    and item.workspace_id = p_workspace_id
    and item.deleted_at is null
  for update;

  if not found
     or current_item.status is distinct from p_expected_status
     or current_item.checked_out_by is distinct from p_expected_checked_out_by
     or current_item.checked_out_at is distinct from p_expected_checked_out_at then
    return;
  end if;

  if (current_item.status = 'checked_out'
      or current_item.checked_out_by is not null
      or current_item.checked_out_at is not null)
     and p_status <> 'checked_out' then
    raise exception 'Return this item before changing its checkout status.' using errcode = '22023';
  end if;

  update public.items as item
  set name = btrim(p_name),
      barcode = btrim(p_barcode),
      status = p_status,
      notes = nullif(btrim(p_notes), ''),
      access_mode = p_access_mode
  where item.id = p_item_id
    and item.workspace_id = p_workspace_id
    and item.deleted_at is null;

  delete from public.item_access_grants as grant_row
  where grant_row.item_id = p_item_id;

  if p_access_mode = 'restricted' then
    insert into public.item_access_grants(item_id, profile_id, granted_by)
    select p_item_id, target.profile_id, p_actor_id
    from unnest(normalized_profile_ids) as target(profile_id);
  end if;

  if current_item.status is distinct from p_status
     and p_status not in ('available', 'checked_out') then
    insert into public.item_status_history(
      workspace_id, item_id, status, note, changed_by
    ) values (
      p_workspace_id, p_item_id, p_status, nullif(btrim(p_notes), ''), p_actor_id
    );
  end if;

  insert into public.admin_audit_logs(
    workspace_id, actor_id, action_type, entity_type, entity_id, metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'item_update',
    'items',
    p_item_id,
    jsonb_build_object(
      'barcode', btrim(p_barcode),
      'previous_status', current_item.status,
      'status', p_status,
      'access_mode', p_access_mode,
      'profile_ids', case when p_access_mode = 'restricted'
        then to_jsonb(normalized_profile_ids) else '[]'::jsonb end
    )
  );

  return query
  select item.id, item.workspace_id, item.name, item.barcode,
    item.serial_number, item.status, item.notes
  from public.items as item
  where item.id = p_item_id;
end;
$$;

revoke all on function public.create_item_with_access_and_audit(uuid, text, text, text, text, text, text, uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.update_item_with_access_and_audit(uuid, uuid, text, text, text, text, text, uuid[], uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_item_with_access_and_audit(uuid, text, text, text, text, text, text, uuid[], uuid)
  to service_role;
grant execute on function public.update_item_with_access_and_audit(uuid, uuid, text, text, text, text, text, uuid[], uuid, text, uuid, timestamptz)
  to service_role;

commit;
