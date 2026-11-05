-- Complete the 30-day workspace purge executor with resumable claims,
-- complete workspace-scoped cleanup, and a PII-minimized deletion receipt.
-- The external auth / storage deletions are performed by job-worker before
-- purge_workspace_data; this SQL function is the atomic database phase.

begin;

alter table public.workspaces
  add column if not exists archived_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists purge_state text not null default 'none',
  add column if not exists purged_at timestamptz,
  add column if not exists purge_claimed_at timestamptz;

create index if not exists workspaces_purge_due_idx
  on public.workspaces (purge_after, purge_claimed_at, id)
  where archived_at is not null
    and purge_after is not null
    and purge_state in ('grace', 'purging');

-- These tables are scanned by the final hard-delete path. The profile index is
-- intentionally not partial because archived profiles must also be removed.
create index if not exists profiles_workspace_id_purge_idx
  on public.profiles (workspace_id);
create index if not exists offline_checkout_packs_workspace_id_purge_idx
  on public.offline_checkout_packs (workspace_id);

create table if not exists public.workspace_deletion_certificates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  purged_at timestamptz not null default clock_timestamp(),
  deleted_row_counts jsonb not null default '{}'::jsonb,
  external_cleanup jsonb not null default '{}'::jsonb
);

alter table public.workspace_deletion_certificates
  add column if not exists workspace_id uuid,
  add column if not exists purged_at timestamptz not null default clock_timestamp(),
  add column if not exists deleted_row_counts jsonb not null default '{}'::jsonb,
  add column if not exists external_cleanup jsonb not null default '{}'::jsonb,
  drop column if exists workspace_name,
  drop column if exists workspace_slug,
  drop column if exists account_category,
  drop column if exists archived_at,
  drop column if exists purge_after;

-- Existing receipts are not trusted to contain only operational metadata.
-- Preserve only numeric counts and a fixed allowlist of external counters.
update public.workspace_deletion_certificates
set deleted_row_counts = coalesce((
      select pg_catalog.jsonb_object_agg(entry.key, entry.value)
      from pg_catalog.jsonb_each(coalesce(workspace_deletion_certificates.deleted_row_counts, '{}'::jsonb)) entry
      where entry.key ~ '^[a-z][a-z0-9_]{0,62}$'
        and pg_catalog.jsonb_typeof(entry.value) = 'number'
        and (entry.value #>> '{}') ~ '^[0-9]{1,9}$'
    ), '{}'::jsonb),
    external_cleanup = pg_catalog.jsonb_build_object(
      'better_auth_users', case
        when coalesce(external_cleanup ->> 'better_auth_users', '') ~ '^[0-9]{1,9}$'
        then (external_cleanup ->> 'better_auth_users')::integer else 0 end,
      'support_attachment_files', case
        when coalesce(external_cleanup ->> 'support_attachment_files', '') ~ '^[0-9]{1,9}$'
        then (external_cleanup ->> 'support_attachment_files')::integer else 0 end,
      'organization_logo', case
        when coalesce(external_cleanup ->> 'organization_logo', '') ~ '^[0-9]{1,9}$'
        then least((external_cleanup ->> 'organization_logo')::integer, 1) else 0 end
    );

alter table public.workspace_deletion_certificates
  alter column workspace_id set not null;

drop index if exists public.workspace_deletion_certificates_workspace_idx;
create unique index if not exists workspace_deletion_certificates_workspace_uidx
  on public.workspace_deletion_certificates (workspace_id);

alter table public.workspace_deletion_certificates enable row level security;
revoke all on public.workspace_deletion_certificates from public, anon, authenticated;
grant select, insert on public.workspace_deletion_certificates to service_role;

-- The prerequisite migration temporarily removed these RESTRICT constraints.
-- Restore them so accidental workspace/profile deletions remain blocked;
-- the purge RPC removes the workspace-scoped audit rows first.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.security_audit_logs'::regclass
      and con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and con.conkey = array[(
        select att.attnum
        from pg_catalog.pg_attribute att
        where att.attrelid = 'public.security_audit_logs'::regclass
          and att.attname = 'actor_id'
      )]::smallint[]
  ) then
    alter table public.security_audit_logs
      add constraint security_audit_logs_actor_id_fkey
      foreign key (actor_id) references public.profiles(id) on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.security_audit_logs'::regclass
      and con.contype = 'f'
      and con.confrelid = 'public.workspaces'::regclass
      and con.conkey = array[(
        select att.attnum
        from pg_catalog.pg_attribute att
        where att.attrelid = 'public.security_audit_logs'::regclass
          and att.attname = 'workspace_id'
      )]::smallint[]
  ) then
    alter table public.security_audit_logs
      add constraint security_audit_logs_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id) on delete restrict;
  end if;
end;
$$;

create or replace function public.claim_workspaces_due_for_purge(p_limit integer default 3)
returns table (
  id uuid,
  name text,
  slug text,
  better_auth_organization_id text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  return query
  with due as (
    select w.id
    from public.workspaces w
    where w.archived_at is not null
      and w.purge_after is not null
      and w.purge_after <= pg_catalog.clock_timestamp()
      and (
        w.purge_state = 'grace'
        or (
          w.purge_state = 'purging'
          and (
            w.purge_claimed_at is null
            or w.purge_claimed_at < pg_catalog.clock_timestamp() - interval '30 minutes'
          )
        )
      )
    order by w.purge_after, w.id
    limit greatest(1, least(coalesce(p_limit, 3), 20))
    for update skip locked
  )
  update public.workspaces w
  set purge_state = 'purging', purge_claimed_at = pg_catalog.clock_timestamp()
  from due
  where w.id = due.id
  returning w.id, null::text, null::text, w.better_auth_organization_id::text;
end;
$$;

create or replace function public.release_workspace_purge_claim(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  update public.workspaces
  set purge_state = 'grace', purge_claimed_at = null
  where id = p_workspace_id and purge_state = 'purging';
end;
$$;

-- Staging and production do not have identical optional support tables. This
-- service-role-only RPC returns paths only from the workspace's own attachment
-- rows, and returns no rows if that optional subsystem is absent.
create or replace function public.list_workspace_support_attachment_paths(p_workspace_id uuid)
returns table (storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_workspace_id is null then
    raise exception 'Workspace is required' using errcode = '22023';
  end if;

  if pg_catalog.to_regclass('public.support_requests') is null
     or pg_catalog.to_regclass('public.support_request_attachments') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'support_requests'
         and column_name in ('id', 'workspace_id')
       group by table_name having count(*) = 2
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'support_request_attachments'
         and column_name in ('support_request_id', 'storage_path')
       group by table_name having count(*) = 2
     ) then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_request_attachments'
      and column_name = 'storage_bucket'
  ) then
    return query execute
      'select distinct attachment.storage_path
         from public.support_requests as request
         join public.support_request_attachments as attachment
           on attachment.support_request_id = request.id
        where request.workspace_id = $1
          and attachment.storage_path is not null
          and coalesce(attachment.storage_bucket, ''support-request-attachments'') = ''support-request-attachments''
        order by attachment.storage_path'
      using p_workspace_id;
  else
    return query execute
      'select distinct attachment.storage_path
         from public.support_requests as request
         join public.support_request_attachments as attachment
           on attachment.support_request_id = request.id
        where request.workspace_id = $1
          and attachment.storage_path is not null
        order by attachment.storage_path'
      using p_workspace_id;
  end if;
end;
$$;

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

revoke all on function public.claim_workspaces_due_for_purge(integer) from public, anon, authenticated;
revoke all on function public.release_workspace_purge_claim(uuid) from public, anon, authenticated;
revoke all on function public.list_workspace_support_attachment_paths(uuid) from public, anon, authenticated;
revoke all on function public.purge_workspace_data(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_workspaces_due_for_purge(integer) to service_role;
grant execute on function public.release_workspace_purge_claim(uuid) to service_role;
grant execute on function public.list_workspace_support_attachment_paths(uuid) to service_role;
grant execute on function public.purge_workspace_data(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
