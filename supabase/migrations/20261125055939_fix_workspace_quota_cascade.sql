create or replace function private.enforce_active_inventory_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_name text;
  usage_column text;
  policy_column text;
  current_count integer;
  maximum_count integer;
  should_increment boolean := false;
  should_decrement boolean := false;
begin
  if tg_table_name = 'items' then
    resource_name := 'items';
    usage_column := 'active_items';
    policy_column := 'max_items';
  elsif tg_table_name = 'borrowers' then
    resource_name := 'borrowers';
    usage_column := 'active_borrowers';
    policy_column := 'max_borrowers';
  else
    raise exception 'unsupported quota table';
  end if;

  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'inventory workspace cannot be changed';
  end if;

  if tg_op = 'INSERT' then
    should_increment := new.deleted_at is null;
  elsif tg_op = 'DELETE' then
    should_decrement := old.deleted_at is null;
  else
    should_increment := old.deleted_at is not null and new.deleted_at is null;
    should_decrement := old.deleted_at is null and new.deleted_at is not null;
  end if;

  if should_increment then
    insert into public.workspace_usage (workspace_id)
    values (new.workspace_id)
    on conflict (workspace_id) do nothing;

    execute format(
      'update public.workspace_usage u set %1$I = u.%1$I + 1, updated_at = now() where u.workspace_id = $1 and ((select %2$I from public.workspace_policies where workspace_id = $1) is null or u.%1$I < (select %2$I from public.workspace_policies where workspace_id = $1)) returning u.%1$I, (select %2$I from public.workspace_policies where workspace_id = $1)',
      usage_column,
      policy_column
    ) into current_count, maximum_count using new.workspace_id;

    if current_count is null then
      execute format(
        'select u.%1$I, p.%2$I from public.workspace_usage u left join public.workspace_policies p on p.workspace_id = u.workspace_id where u.workspace_id = $1',
        usage_column,
        policy_column
      ) into current_count, maximum_count using new.workspace_id;
      raise exception using
        errcode = 'P0001',
        message = upper(resource_name) || '_LIMIT_REACHED',
        detail = jsonb_build_object(
          'resource', resource_name,
          'current', coalesce(current_count, 0),
          'maximum', maximum_count
        )::text;
    end if;
  elsif should_decrement then
    -- During a workspace cascade the parent is already invisible to this transaction.
    -- Updating a surviving usage row would recheck its workspace foreign key.
    if tg_op = 'DELETE' and not exists (select 1 from public.workspaces where id = old.workspace_id) then
      return old;
    end if;
    execute format(
      'update public.workspace_usage set %1$I = greatest(%1$I - 1, 0), updated_at = now() where workspace_id = $1',
      usage_column
    ) using old.workspace_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

