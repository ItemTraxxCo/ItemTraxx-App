begin;

-- The original atomic checkout function declared a local operation_id variable
-- with the same name as public.item_logs.operation_id. PostgreSQL cannot resolve
-- the unqualified references in the idempotency query, so every online
-- checkout/return reached the RPC and then failed with an ambiguous-column
-- error. Keep the function contract stable and use a distinct local name.
create or replace function public.apply_checkout_return_item(
  p_workspace_id uuid,
  p_profile_id uuid,
  p_item_id uuid,
  p_operation_id text,
  p_action_type text,
  p_borrower_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  requested_action text := lower(btrim(coalesce(p_action_type, '')));
  v_operation_id text := btrim(coalesce(p_operation_id, ''));
  item_row public.items%rowtype;
  resolved_action text;
  target_status text;
  target_borrower uuid;
  log_borrower uuid;
  log_operation_id text;
  has_existing_operation boolean;
begin
  if p_workspace_id is null
     or p_profile_id is null
     or p_item_id is null
     or v_operation_id = ''
     or char_length(v_operation_id) > 128
     or requested_action not in ('checkout', 'return', 'auto', 'admin_return', 'quick_return') then
    raise exception 'Invalid checkout/return payload' using errcode = '22023';
  end if;

  select profile.role into actor_role
  from public.profiles profile
  join public.workspaces workspace on workspace.id = profile.workspace_id
  where profile.id = p_profile_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('tenant_account', 'workspace_admin')
    and profile.is_active
    and profile.deleted_at is null
    and workspace.status = 'active';

  if actor_role is null then
    raise exception 'Checkout/return actor is not active' using errcode = '42501';
  end if;

  if requested_action in ('admin_return', 'quick_return')
     and actor_role <> 'workspace_admin' then
    raise exception 'Administrative return requires a Workspace Admin' using errcode = '42501';
  end if;

  select item.* into item_row
  from public.items item
  where item.id = p_item_id
    and item.workspace_id = p_workspace_id
    and item.deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('status', 'skipped', 'reason', 'item_unavailable');
  end if;

  if actor_role = 'tenant_account'
     and item_row.access_mode <> 'all'
     and not exists (
       select 1
       from public.item_access_grants grant_row
       where grant_row.item_id = p_item_id
         and grant_row.profile_id = p_profile_id
     ) then
    return jsonb_build_object('status', 'skipped', 'reason', 'item_unavailable');
  end if;

  if requested_action in ('checkout', 'return', 'auto') then
    if p_borrower_id is null or not exists (
      select 1
      from public.borrowers borrower
      where borrower.id = p_borrower_id
        and borrower.workspace_id = p_workspace_id
        and borrower.deleted_at is null
        and (
          actor_role = 'workspace_admin'
          or borrower.access_mode = 'all'
          or exists (
            select 1
            from public.borrower_access_grants grant_row
            where grant_row.borrower_id = borrower.id
              and grant_row.profile_id = p_profile_id
          )
        )
    ) then
      return jsonb_build_object('status', 'skipped', 'reason', 'borrower_unavailable');
    end if;
  end if;

  -- Check both normal action log keys before inspecting current state. This is
  -- what makes a retried auto/checkout/return request idempotent even after the
  -- first transaction has already changed the item state.
  if requested_action in ('checkout', 'return', 'auto') then
    select exists (
      select 1
      from public.item_logs item_log
      where item_log.workspace_id = p_workspace_id
        and item_log.item_id = p_item_id
        and item_log.operation_id in (
          v_operation_id || ':' || p_item_id::text || ':checkout',
          v_operation_id || ':' || p_item_id::text || ':return'
        )
    ) into has_existing_operation;
  else
    select exists (
      select 1
      from public.item_logs item_log
      where item_log.workspace_id = p_workspace_id
        and item_log.item_id = p_item_id
        and item_log.operation_id = v_operation_id || ':' || p_item_id::text || ':' || requested_action
    ) into has_existing_operation;
  end if;

  if has_existing_operation then
    return jsonb_build_object('status', 'idempotent');
  end if;

  if requested_action = 'auto' then
    if lower(item_row.status) = 'available' and item_row.checked_out_by is null then
      resolved_action := 'checkout';
    elsif lower(item_row.status) = 'checked_out'
      and item_row.checked_out_by is not distinct from p_borrower_id then
      resolved_action := 'return';
    else
      return jsonb_build_object('status', 'skipped', 'reason', 'state_changed');
    end if;
  elsif requested_action = 'checkout' then
    if lower(item_row.status) <> 'available' or item_row.checked_out_by is not null then
      return jsonb_build_object('status', 'skipped', 'reason', 'state_changed');
    end if;
    resolved_action := 'checkout';
  elsif requested_action = 'return' then
    if lower(item_row.status) <> 'checked_out'
       or item_row.checked_out_by is distinct from p_borrower_id then
      return jsonb_build_object('status', 'skipped', 'reason', 'state_changed');
    end if;
    resolved_action := 'return';
  else
    if lower(item_row.status) <> 'checked_out' or item_row.checked_out_by is null then
      return jsonb_build_object('status', 'skipped', 'reason', 'state_changed');
    end if;
    resolved_action := requested_action;
  end if;

  if resolved_action = 'checkout' then
    target_status := 'checked_out';
    target_borrower := p_borrower_id;
    log_borrower := p_borrower_id;
  else
    target_status := 'available';
    target_borrower := null;
    log_borrower := coalesce(p_borrower_id, item_row.checked_out_by);
  end if;

  if log_borrower is null or not exists (
    select 1
    from public.borrowers borrower
    where borrower.id = log_borrower
      and borrower.workspace_id = p_workspace_id
  ) then
    raise exception 'Checkout/return log borrower is invalid' using errcode = '22023';
  end if;

  log_operation_id := v_operation_id || ':' || p_item_id::text || ':' || resolved_action;

  update public.items
  set status = target_status,
      checked_out_by = target_borrower,
      checked_out_at = case when target_status = 'checked_out' then now() else null end
  where id = p_item_id;

  insert into public.item_logs(
    workspace_id, item_id, checked_out_by, action_type, performed_by, operation_id
  ) values (
    p_workspace_id, p_item_id, log_borrower, resolved_action, p_profile_id, log_operation_id
  ) on conflict (workspace_id, item_id, action_type, operation_id) do nothing;

  return jsonb_build_object(
    'status', 'processed',
    'action_type', resolved_action
  );
end;
$$;

revoke all on function public.apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid)
  to service_role;

commit;
