\set ON_ERROR_STOP on

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'offline_checkout_packs',
    'offline_checkout_pack_items',
    'offline_checkout_conflicts'
  ] loop
    if to_regclass('public.' || target_table) is null then
      raise exception '% table missing', target_table;
    end if;
    if not coalesce((
      select c.relrowsecurity
      from pg_class c
      where c.oid = to_regclass('public.' || target_table)
    ), false) then
      raise exception '% does not have RLS enabled', target_table;
    end if;
    if has_table_privilege('authenticated', 'public.' || target_table, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || target_table, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || target_table, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || target_table, 'DELETE') then
      raise exception 'authenticated retains direct privileges on %', target_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'item_logs'
      and indexname = 'idx_item_logs_operation_conflict'
      and indexdef ilike '%unique%'
      and indexdef not ilike '% where %'
  ) then
    raise exception 'full item log idempotency index missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'admin_audit_logs'
      and indexname = 'idx_admin_audit_offline_quick_return_item'
      and indexdef ilike '%unique%'
      and indexdef ilike '%quick_return%'
      and indexdef ilike '%offline_replay%'
  ) then
    raise exception 'offline Quick Return audit idempotency index missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.offline_checkout_conflicts'::regclass
      and conname = 'offline_checkout_conflicts_operation_key'
  ) then
    raise exception 'offline conflict operation dedupe constraint missing';
  end if;

  if to_regprocedure(
    'public.apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean)'
  ) is null then
    raise exception 'atomic offline item replay function missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can call atomic offline item replay directly';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean)',
    'EXECUTE'
  ) then
    raise exception 'service role cannot call atomic offline item replay';
  end if;
  if position('pack.invalidated_at is null' in lower(pg_get_functiondef(to_regprocedure(
    'public.apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean)'
  )))) = 0 or position('for update' in lower(pg_get_functiondef(to_regprocedure(
    'public.apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean)'
  )))) = 0 or position('insert into public.admin_audit_logs' in lower(pg_get_functiondef(to_regprocedure(
    'public.apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean)'
  )))) = 0 or position('actor_role <> ''workspace_admin''' in lower(pg_get_functiondef(to_regprocedure(
    'public.apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean)'
  )))) = 0 then
    raise exception 'atomic replay does not enforce active pack, row locking, admin-only Quick Return, and audit';
  end if;
end $$;

select 'offline checkout MVP assertions passed' as result;
