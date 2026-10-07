do $$
begin
  if has_table_privilege('anon', 'public.admin_audit_logs', 'INSERT')
     or has_table_privilege('authenticated', 'public.admin_audit_logs', 'INSERT') then
    raise exception 'anon or authenticated can still insert admin audit rows';
  end if;

  if has_table_privilege('anon', 'public.admin_audit_logs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.admin_audit_logs', 'UPDATE')
     or has_table_privilege('anon', 'public.admin_audit_logs', 'DELETE')
     or has_table_privilege('authenticated', 'public.admin_audit_logs', 'DELETE') then
    raise exception 'anon or authenticated can still change or delete admin audit rows';
  end if;

  if not has_table_privilege('authenticated', 'public.admin_audit_logs', 'SELECT') then
    raise exception 'authenticated users lost read access to audit history';
  end if;

  if not has_table_privilege('service_role', 'public.admin_audit_logs', 'INSERT') then
    raise exception 'service_role cannot write server-owned audit rows';
  end if;

  if exists (
    select 1
    from pg_policies policy
    cross join lateral unnest(policy.roles) as policy_role(role_name)
    where policy.schemaname = 'public'
      and policy.tablename = 'admin_audit_logs'
      and policy.cmd in ('INSERT', 'ALL')
      and policy_role.role_name in ('public', 'anon', 'authenticated')
  ) then
    raise exception 'a browser-role insert policy still applies to admin audit rows';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'admin_audit_logs'
      and indexname = 'admin_audit_logs_server_checkout_operation_idx'
  ) then
    raise exception 'server checkout audit idempotency index is missing';
  end if;

  if to_regprocedure('public.import_items_with_audit(uuid,uuid,jsonb,integer)') is null then
    raise exception 'transactional bulk import and audit function is missing';
  end if;

  if has_function_privilege(
       'anon',
       'public.import_items_with_audit(uuid,uuid,jsonb,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.import_items_with_audit(uuid,uuid,jsonb,integer)',
       'EXECUTE'
     ) then
    raise exception 'browser roles can call the transactional bulk import function';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.import_items_with_audit(uuid,uuid,jsonb,integer)',
       'EXECUTE'
     ) then
    raise exception 'service_role cannot call the transactional bulk import function';
  end if;

  if not exists (
    select 1
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.proname = 'import_items_with_audit'
      and function.prosecdef
      and position('insert into public.items' in lower(function.prosrc)) > 0
      and position('insert into public.item_status_history' in lower(function.prosrc)) > 0
      and position('insert into public.admin_audit_logs' in lower(function.prosrc)) > 0
  ) then
    raise exception 'bulk import function must write items, status history and audit together';
  end if;
end;
$$;
