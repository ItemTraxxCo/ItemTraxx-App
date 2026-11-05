-- Ensure profile-linked RESTRICT/NO ACTION rows cannot block workspace purge.
begin;

create or replace function public.purge_workspace_data(
  p_workspace_id uuid,
  p_external_cleanup jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws public.workspaces%rowtype;
  counts jsonb := '{}'::jsonb;
  external_summary jsonb;
  affected integer;
  purged_ts timestamptz;
  fk record;
  unlinked_table record;
  profile_fk record;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_workspace_id is null or jsonb_typeof(coalesce(p_external_cleanup, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid workspace purge input' using errcode = '22023';
  end if;

  select * into ws
  from public.workspaces
  where id = p_workspace_id
  for update;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if ws.purge_state <> 'purging'
     or ws.archived_at is null
     or ws.purge_after is null
     or ws.purge_after > pg_catalog.clock_timestamp() then
    raise exception 'Workspace is not due for purge' using errcode = '42501';
  end if;

  -- These workspace-scoped audit tables also refer to profiles with RESTRICT
  -- or NO ACTION semantics, so remove them before their actor profiles.
  delete from public.security_audit_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || pg_catalog.jsonb_build_object('security_audit_logs', affected);

  delete from public.admin_audit_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || pg_catalog.jsonb_build_object('admin_audit_logs', affected);

  delete from public.item_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || pg_catalog.jsonb_build_object('item_logs', affected);

  -- Super-admin audit rows are workspace-associated too: metadata can contain
  -- customer names and actor_email is personal data. Keep only the separate,
  -- PII-minimized deletion certificate below.
  if pg_catalog.to_regclass('public.super_admin_audit_logs') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'super_admin_audit_logs'
         and column_name in ('target_type', 'target_id', 'metadata')
       group by table_name having count(*) = 3
     ) then
    execute
      'delete from public.super_admin_audit_logs
        where (lower(target_type) = ''workspace'' and target_id::text = $1)
           or metadata ->> ''workspace_id'' = $1'
      using ws.id::text;
    get diagnostics affected = row_count;
    counts := counts || pg_catalog.jsonb_build_object('super_admin_audit_logs', affected);
  end if;

  -- Delete every remaining non-cascading FK child of the workspace, including
  -- optional tables such as consent records, client reports, email logs, and
  -- support requests. Profiles are deleted after all of their dependent rows.
  for fk in
    select distinct
      source_ns.nspname as schema_name,
      source_rel.relname as table_name,
      source_att.attname as column_name
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class source_rel on source_rel.oid = con.conrelid
    join pg_catalog.pg_namespace source_ns on source_ns.oid = source_rel.relnamespace
    join lateral unnest(con.conkey) with ordinality source_key(attnum, position) on true
    join lateral unnest(con.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_att
      on source_att.attrelid = source_rel.oid and source_att.attnum = source_key.attnum
    join pg_catalog.pg_attribute target_att
      on target_att.attrelid = con.confrelid and target_att.attnum = target_key.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.workspaces'::regclass
      and con.confdeltype <> 'c'
      and target_att.attname = 'id'
      and source_rel.oid not in (
        'public.workspaces'::regclass,
        'public.profiles'::regclass,
        'public.workspace_deletion_certificates'::regclass
      )
      and source_rel.relname not in ('security_audit_logs', 'admin_audit_logs', 'item_logs')
    order by schema_name, table_name, column_name
  loop
    execute pg_catalog.format(
      'delete from %I.%I where %I = $1',
      fk.schema_name,
      fk.table_name,
      fk.column_name
    ) using ws.id;
    get diagnostics affected = row_count;
    counts := counts || pg_catalog.jsonb_build_object(
      fk.table_name,
      coalesce((counts ->> fk.table_name)::integer, 0) + affected
    );
  end loop;

  -- Legacy workspace_id tables without an FK (currently rate_limits) must not
  -- survive as detached customer rows. The deletion certificate is the sole
  -- intentional exception because it is the requested PII-minimized receipt.
  for unlinked_table in
    select ns.nspname as schema_name, rel.relname as table_name
    from pg_catalog.pg_class rel
    join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace
    join pg_catalog.pg_attribute att on att.attrelid = rel.oid
    where ns.nspname = 'public'
      and rel.relkind in ('r', 'p')
      and att.attname = 'workspace_id'
      and att.attnum > 0
      and not att.attisdropped
      and rel.oid not in (
        'public.workspaces'::regclass,
        'public.workspace_deletion_certificates'::regclass
      )
      and not exists (
        select 1
        from pg_catalog.pg_constraint con
        join lateral unnest(con.conkey) with ordinality source_key(attnum, position) on true
        join lateral unnest(con.confkey) with ordinality target_key(attnum, position)
          on target_key.position = source_key.position
        join pg_catalog.pg_attribute target_att
          on target_att.attrelid = con.confrelid and target_att.attnum = target_key.attnum
        where con.contype = 'f'
          and con.conrelid = rel.oid
          and con.confrelid = 'public.workspaces'::regclass
          and source_key.attnum = att.attnum
          and target_att.attname = 'id'
      )
    order by ns.nspname, rel.relname
  loop
    execute pg_catalog.format(
      'delete from %I.%I where workspace_id = $1',
      unlinked_table.schema_name,
      unlinked_table.table_name
    ) using ws.id;
    get diagnostics affected = row_count;
    counts := counts || pg_catalog.jsonb_build_object(unlinked_table.table_name, affected);
  end loop;

  select count(*) into affected from public.borrowers where workspace_id = ws.id;
  counts := counts || pg_catalog.jsonb_build_object('borrowers', affected);
  select count(*) into affected from public.items where workspace_id = ws.id;
  counts := counts || pg_catalog.jsonb_build_object('items', affected);

  -- Remove non-cascading rows that still reference this workspace's profiles,
  -- even if a legacy audit row has a null or inconsistent workspace_id. This
  -- prevents RESTRICT/NO ACTION profile FKs from aborting the purge.
  for profile_fk in
    select distinct
      source_ns.nspname as schema_name,
      source_rel.relname as table_name,
      source_att.attname as column_name
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class source_rel on source_rel.oid = con.conrelid
    join pg_catalog.pg_namespace source_ns on source_ns.oid = source_rel.relnamespace
    join lateral unnest(con.conkey) with ordinality source_key(attnum, position) on true
    join lateral unnest(con.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_att
      on source_att.attrelid = source_rel.oid and source_att.attnum = source_key.attnum
    join pg_catalog.pg_attribute target_att
      on target_att.attrelid = con.confrelid and target_att.attnum = target_key.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and con.confdeltype in ('a', 'r')
      and target_att.attname = 'id'
      and source_rel.oid not in (
        'public.profiles'::regclass,
        'public.workspace_deletion_certificates'::regclass
      )
    order by schema_name, table_name, column_name
  loop
    execute pg_catalog.format(
      'delete from %I.%I as child where child.%I in (select profile.id from public.profiles as profile where profile.workspace_id = $1)',
      profile_fk.schema_name,
      profile_fk.table_name,
      profile_fk.column_name
    ) using ws.id;
    get diagnostics affected = row_count;
    counts := counts || pg_catalog.jsonb_build_object(
      profile_fk.table_name,
      coalesce((counts ->> profile_fk.table_name)::integer, 0) + affected
    );
  end loop;

  delete from public.profiles where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || pg_catalog.jsonb_build_object('profiles', affected);

  delete from public.workspaces where id = ws.id;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Workspace purge did not delete exactly one workspace' using errcode = '40001';
  end if;

  purged_ts := pg_catalog.clock_timestamp();
  external_summary := pg_catalog.jsonb_build_object(
    'better_auth_users', case
      when coalesce(p_external_cleanup ->> 'better_auth_users', '') ~ '^[0-9]{1,9}$'
      then (p_external_cleanup ->> 'better_auth_users')::integer else 0 end,
    'support_attachment_files', case
      when coalesce(p_external_cleanup ->> 'support_attachment_files', '') ~ '^[0-9]{1,9}$'
      then (p_external_cleanup ->> 'support_attachment_files')::integer else 0 end,
    'organization_logo', case
      when coalesce(p_external_cleanup ->> 'organization_logo', '') ~ '^[0-9]{1,9}$'
      then least((p_external_cleanup ->> 'organization_logo')::integer, 1) else 0 end
  );

  insert into public.workspace_deletion_certificates (
    workspace_id, purged_at, deleted_row_counts, external_cleanup
  ) values (
    ws.id, purged_ts, counts, external_summary
  );

  return pg_catalog.jsonb_build_object(
    'workspace_id', ws.id,
    'purged_at', purged_ts,
    'deleted_row_counts', counts
  );
end;
$$;

revoke all on function public.purge_workspace_data(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.purge_workspace_data(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
