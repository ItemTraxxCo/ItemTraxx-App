begin;

-- Browser sessions may read audit history, but only trusted server handlers
-- and security-definer mutation functions may append to it. The old
-- authenticated insert policies let callers choose event types and metadata.
drop policy if exists workspace_admin_insert_audit
  on public.admin_audit_logs;
drop policy if exists individual_account_insert_audit
  on public.admin_audit_logs;
drop policy if exists super_admin_all_audit
  on public.admin_audit_logs;
drop policy if exists admin_audit_logs_restrict_offline_quick_return
  on public.admin_audit_logs;

drop policy if exists super_admin_select_audit
  on public.admin_audit_logs;
create policy super_admin_select_audit
  on public.admin_audit_logs
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'super_admin'
    and (select public.has_recent_privileged_step_up('super_admin'))
    and (select private.super_admin_session_not_revoked())
  );

revoke insert, update, delete on public.admin_audit_logs
  from anon, authenticated;
grant select on public.admin_audit_logs to authenticated;
grant insert on public.admin_audit_logs to service_role;

-- Keep bulk item rows, status history, and their required summary event in
-- one database transaction. The edge handler still performs request parsing,
-- account authorization, rate limiting, and plan preflight before calling it.
create or replace function public.import_items_with_audit(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_items jsonb,
  p_skipped_count integer
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  inserted_items jsonb := '[]'::jsonb;
  resolved_actor_role text;
begin
  if current_setting('role', true) is distinct from 'service_role'
     or p_workspace_id is null
     or p_actor_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 1000
     or p_skipped_count is null
     or p_skipped_count < 0
     or p_skipped_count > 1000 then
    raise exception 'Invalid item import payload' using errcode = '22023';
  end if;

  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace
    on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active'
    and workspace.archived_at is null;

  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      name text,
      barcode text,
      serial_number text,
      status text,
      notes text
    )
    where item.name is null
       or btrim(item.name) = ''
       or char_length(item.name) > 120
       or item.barcode is null
       or item.barcode !~ '^[A-Za-z0-9._:@/#-]{1,64}$'
       or char_length(coalesce(item.serial_number, '')) > 64
       or item.status is null
       or item.status not in (
         'available', 'checked_out', 'damaged', 'lost', 'in_repair',
         'retired', 'in_studio_only'
       )
       or char_length(coalesce(item.notes, '')) > 500
  ) then
    raise exception 'Invalid item import payload' using errcode = '22023';
  end if;

  if exists (
    select lower(item.barcode)
    from jsonb_to_recordset(p_items) as item(barcode text)
    group by lower(item.barcode)
    having count(*) > 1
  ) then
    raise exception 'Duplicate barcode in item import payload' using errcode = '22023';
  end if;

  with inserted as (
    insert into public.items(
      workspace_id,
      name,
      barcode,
      serial_number,
      status,
      notes
    )
    select
      p_workspace_id,
      btrim(item.name),
      btrim(item.barcode),
      nullif(btrim(coalesce(item.serial_number, '')), ''),
      item.status,
      nullif(btrim(coalesce(item.notes, '')), '')
    from jsonb_to_recordset(p_items) as item(
      name text,
      barcode text,
      serial_number text,
      status text,
      notes text
    )
    returning id, workspace_id, name, barcode, serial_number, status, notes
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
  into inserted_items
  from inserted;

  insert into public.item_status_history(
    workspace_id,
    item_id,
    status,
    note,
    changed_by
  )
  select
    item.workspace_id,
    item.id,
    item.status,
    item.notes,
    p_actor_id
  from jsonb_to_recordset(inserted_items) as item(
    id uuid,
    workspace_id uuid,
    status text,
    notes text
  )
  where item.status in ('damaged', 'lost', 'in_repair', 'retired', 'in_studio_only');

  if jsonb_array_length(inserted_items) + p_skipped_count > 1000 then
    raise exception 'Invalid item import counts' using errcode = '22023';
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
    'item_bulk_import',
    'items',
    null,
    jsonb_build_object(
      'source', 'server_admin_ops',
      'inserted', jsonb_array_length(inserted_items),
      'skipped', p_skipped_count
    )
  );

  return inserted_items;
end;
$$;

revoke all on function public.import_items_with_audit(uuid, uuid, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.import_items_with_audit(uuid, uuid, jsonb, integer)
  to service_role;

-- A checkout retry uses the same operation ID. Keep its one summary event
-- unique while allowing separate checkout operations by the same actor.
create unique index if not exists
  admin_audit_logs_server_checkout_operation_idx
  on public.admin_audit_logs (
    workspace_id,
    actor_id,
    (metadata ->> 'operation_fingerprint')
  )
  where action_type = 'quick_return'
    and metadata ->> 'source' = 'server_checkout';

notify pgrst, 'reload schema';

commit;
