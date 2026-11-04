\set ON_ERROR_STOP on

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.claim_workspaces_due_for_purge(integer)',
    'public.release_workspace_purge_claim(uuid)',
    'public.purge_workspace_data(uuid,jsonb)'
  ] loop
    if to_regprocedure(fn) is null then
      raise exception 'missing function %', fn;
    end if;
    if not exists (select 1 from pg_proc where oid = to_regprocedure(fn) and prosecdef) then
      raise exception '% must be security definer', fn;
    end if;
    if has_function_privilege('authenticated', fn, 'EXECUTE')
       or has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception '% must be service-role only', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'service_role cannot execute %', fn;
    end if;
  end loop;

  if to_regclass('public.workspace_deletion_certificates') is null then
    raise exception 'deletion certificate table missing';
  end if;
  if has_table_privilege('authenticated', 'public.workspace_deletion_certificates', 'SELECT') then
    raise exception 'authenticated must not read deletion certificates';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.security_audit_logs'::regclass
      and contype = 'f'
      and confrelid in ('public.profiles'::regclass, 'public.workspaces'::regclass)
  ) then
    raise exception 'security_audit_logs must not block workspace deletion';
  end if;
end;
$$;
