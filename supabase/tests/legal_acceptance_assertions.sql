\set ON_ERROR_STOP on

do $$
declare
  fn text;
  col text;
begin
  foreach col in array array[
    'profile_id', 'workspace_id', 'document_type', 'document_version',
    'document_hash', 'ip_address', 'user_agent', 'accepted_at'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'legal_acceptances' and column_name = col
    ) then
      raise exception 'legal_acceptances.% missing', col;
    end if;
  end loop;

  if to_regclass('public.legal_document_versions') is null then
    raise exception 'legal_document_versions registry missing';
  end if;

  foreach fn in array array[
    'public.list_pending_legal_acceptances(uuid)',
    'public.record_legal_acceptance(uuid,text,text,text,text,text,text)'
  ] loop
    if to_regprocedure(fn) is null then
      raise exception 'missing function %', fn;
    end if;
    if has_function_privilege('authenticated', fn, 'EXECUTE')
       or has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception '% must be service-role only', fn;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.legal_acceptances', 'SELECT')
     or has_table_privilege('anon', 'public.legal_acceptances', 'SELECT') then
    raise exception 'legal_acceptances must not be readable by browser roles';
  end if;
  if has_table_privilege('service_role', 'public.legal_acceptances', 'UPDATE')
     or has_table_privilege('service_role', 'public.legal_acceptances', 'DELETE') then
    raise exception 'service_role must not update or delete acceptances';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.legal_acceptances'::regclass
      and tgname = 'legal_acceptances_immutable_row'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.legal_acceptances'::regclass
      and tgname = 'legal_acceptances_immutable_truncate'
  ) then
    raise exception 'append-only triggers missing on legal_acceptances';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.legal_acceptances'::regclass
      and contype = 'f'
      and confrelid in ('public.profiles'::regclass, 'public.workspaces'::regclass)
      and confdeltype <> 'n'
  ) then
    raise exception 'legal_acceptances identity links must be ON DELETE SET NULL';
  end if;
end;
$$;
