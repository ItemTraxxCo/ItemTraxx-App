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
  if to_regclass('private.workspace_purge_external_cleanup') is null then
    raise exception 'workspace purge cleanup receipt table missing';
  end if;
  if has_table_privilege('authenticated', 'private.workspace_purge_external_cleanup', 'SELECT')
     or has_table_privilege('anon', 'private.workspace_purge_external_cleanup', 'SELECT')
     or has_table_privilege('service_role', 'private.workspace_purge_external_cleanup', 'SELECT') then
    raise exception 'workspace purge cleanup receipt table must stay private';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'private.workspace_purge_external_cleanup'::regclass and relrowsecurity
  ) then
    raise exception 'workspace purge cleanup receipt table must have row-level security enabled';
  end if;
  if has_table_privilege('authenticated', 'public.workspace_deletion_certificates', 'SELECT') then
    raise exception 'authenticated must not read deletion certificates';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.workspace_deletion_certificates'::regclass
      and tgname = 'apply_workspace_purge_external_cleanup_receipt'
  ) then
    raise exception 'deletion certificates must include persisted external cleanup';
  end if;
  if position(
    'workspace_purge_external_cleanup'
    in pg_get_functiondef('private.apply_workspace_purge_external_cleanup_receipt()'::regprocedure)
  ) = 0 then
    raise exception 'deletion certificate trigger must consume persisted cleanup receipts';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.security_audit_logs'::regclass
      and contype = 'f'
      and confrelid in ('public.profiles'::regclass, 'public.workspaces'::regclass)
  ) then
    raise exception 'security_audit_logs must not block workspace deletion';
  end if;

  if not exists (
    select 1 from pg_constraint
    where contype = 'f'
      and confdeltype = 'n'
      and conrelid = 'public.workspaces'::regclass
      and confrelid = 'better_auth.organization'::regclass
  ) then
    raise exception 'workspaces.better_auth_organization_id must be ON DELETE SET NULL for the purge executor';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'better_auth.organization'::regclass and tgname = 'guard_linked_workspace_delete'
  ) then
    raise exception 'Better Auth organization deletes must stay blocked outside the purge executor';
  end if;
  if position(
    'workspace_purge_external_cleanup'
    in pg_get_functiondef('private.guard_linked_better_auth_organization_delete()'::regprocedure)
  ) = 0 then
    raise exception 'Better Auth organization deletes must persist cleanup receipts for retries';
  end if;

  -- profiles.better_auth_user_id stays RESTRICT: purge_workspace_better_auth_user
  -- clears the link before deleting the Better Auth user, so no trigger is needed,
  -- and the link must keep blocking any delete that skips that RPC.
  if not exists (
    select 1 from pg_constraint
    where contype = 'f'
      and confdeltype = 'r'
      and conrelid = 'public.profiles'::regclass
      and confrelid = 'better_auth."user"'::regclass
  ) then
    raise exception 'profiles.better_auth_user_id must stay ON DELETE RESTRICT';
  end if;
end;
$$;

do $$
declare
  v_workspace_id uuid := pg_catalog.gen_random_uuid();
  cleanup jsonb;
begin
  insert into private.workspace_purge_external_cleanup (workspace_id)
  values (v_workspace_id);

  insert into public.workspace_deletion_certificates (
    workspace_id, purged_at, deleted_row_counts, external_cleanup
  ) values (
    v_workspace_id,
    pg_catalog.clock_timestamp(),
    '{}'::jsonb,
    '{"better_auth_users": 1, "organization_logo": 0}'::jsonb
  );

  select certificate.external_cleanup into cleanup
  from public.workspace_deletion_certificates as certificate
  where certificate.workspace_id = v_workspace_id;

  if coalesce((cleanup ->> 'organization_logo')::integer, 0) <> 1
     or coalesce((cleanup ->> 'better_auth_users')::integer, 0) <> 1 then
    raise exception 'deletion certificate did not preserve the cleanup receipt';
  end if;
  if exists (
    select 1 from private.workspace_purge_external_cleanup as receipt
    where receipt.workspace_id = v_workspace_id
  ) then
    raise exception 'deletion certificate trigger did not consume the cleanup receipt';
  end if;

  delete from public.workspace_deletion_certificates as certificate
  where certificate.workspace_id = v_workspace_id;
end;
$$;
