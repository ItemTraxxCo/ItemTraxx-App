\set ON_ERROR_STOP on

do $$
declare
  legacy_relation text;
begin
  foreach legacy_relation in array array[
    'gear',
    'students',
    'gear_logs',
    'gear_status_history',
    'gear_access_grants'
  ] loop
    if to_regclass('public.' || legacy_relation) is not null then
      raise exception 'legacy relation remains: public.%', legacy_relation;
    end if;
  end loop;

  if to_regclass('public.items') is null
     or to_regclass('public.borrowers') is null
     or to_regclass('public.item_logs') is null
     or to_regclass('public.item_status_history') is null
     or to_regclass('public.item_access_grants') is null then
    raise exception 'renamed item/borrower relations are incomplete';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('items', 'borrowers', 'item_logs', 'item_status_history', 'item_access_grants', 'borrower_access_grants')
      and column_name in ('gear_id', 'student_id')
  ) then
    raise exception 'legacy item/borrower foreign-key column remains';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'item_logs' and column_name = 'item_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'borrowers' and column_name = 'borrower_id'
  ) then
    raise exception 'renamed item/borrower columns are incomplete';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspace_policies'
      and column_name in ('max_gear', 'max_students')
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspace_policies'
      and column_name = 'max_items'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspace_policies'
      and column_name = 'max_borrowers'
  ) then
    raise exception 'workspace policy limits still use legacy names';
  end if;

  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('i', 'S')
      and c.relname ~* '(gear|student)'
  ) then
    raise exception 'legacy item/borrower index or sequence name remains';
  end if;

  if exists (
    select 1 from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname in ('public', 'private')
      and c.conname ~* '(gear|student)'
  ) then
    raise exception 'legacy item/borrower constraint name remains';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and column_name ~* '(^|_)(gear|student)(_|$)'
  ) then
    raise exception 'legacy item/borrower column name remains in public schema';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname in ('public', 'private')
      and (policyname ~* '(gear|student)'
        or coalesce(qual, '') ~* '(gear|student)'
        or coalesce(with_check, '') ~* '(gear|student)')
  ) then
    raise exception 'legacy item/borrower RLS policy remains';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.prokind in ('f', 'p')
      and (
        procedure.proname ~* '(gear|student)'
        or pg_get_function_identity_arguments(procedure.oid) ~* '(gear|student)'
        or pg_get_functiondef(procedure.oid) ~* '(public|private)\.(gear|students)(\W|$)'
        or pg_get_functiondef(procedure.oid) ~* '\m(gear_id|student_id)\M'
      )
  ) then
    raise exception 'legacy item/borrower routine remains';
  end if;

  if exists (
    select 1
    from public.workspace_policies
    where feature_flags ? 'enable_bulk_student_tools'
  ) then
    raise exception 'legacy item/borrower feature flag remains';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspace_policies'
      and column_name = 'account_category'
  ) then
    raise exception 'account_category was modified';
  end if;
end $$;

select 'item and borrower naming assertions passed' as result;
