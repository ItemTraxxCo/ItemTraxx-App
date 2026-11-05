-- Workspace deletion executor.
--
-- Archiving a workspace (super-workspace-mutate `set_workspace_status`) sets
-- purge_state = 'grace' and purge_after = now() + 30 days, but nothing ever
-- executed the purge. This migration adds the database side of the executor;
-- the job-worker edge function drives it (Better Auth users/organization,
-- R2 logo and support-attachment storage are removed outside Postgres first).
--
-- Lifecycle: grace -> purging (claimed) -> workspace row deleted + certificate.
-- A claim older than 30 minutes is considered abandoned and can be re-claimed,
-- so a crashed run retries instead of leaving a workspace stuck forever.

begin;

alter table public.workspaces
  add column if not exists purge_claimed_at timestamptz null;

-- security_audit_logs are append-only security evidence. Their RESTRICT foreign
-- keys to workspaces/profiles made any workspace deletion impossible. Drop the
-- links (the append function resolves actor/workspace itself) so the rows
-- survive as pseudonymous, uuid-only records after the tenant is gone.
do $$
declare
  fk_name text;
begin
  for fk_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.security_audit_logs'::regclass
      and con.contype = 'f'
      and con.confrelid in ('public.profiles'::regclass, 'public.workspaces'::regclass)
  loop
    execute format('alter table public.security_audit_logs drop constraint %I', fk_name);
  end loop;
end;
$$;

create table if not exists public.workspace_deletion_certificates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workspace_name text not null,
  workspace_slug text null,
  account_category text null,
  archived_at timestamptz null,
  purge_after timestamptz null,
  purged_at timestamptz not null default now(),
  deleted_row_counts jsonb not null default '{}'::jsonb,
  external_cleanup jsonb not null default '{}'::jsonb
);

create index if not exists workspace_deletion_certificates_workspace_idx
  on public.workspace_deletion_certificates (workspace_id);

alter table public.workspace_deletion_certificates enable row level security;
revoke all on public.workspace_deletion_certificates from public, anon, authenticated;
grant select, insert on public.workspace_deletion_certificates to service_role;

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
      and w.purge_after <= now()
      and (
        w.purge_state = 'grace'
        or (w.purge_state = 'purging' and w.purge_claimed_at < now() - interval '30 minutes')
      )
    order by w.purge_after
    limit greatest(1, least(coalesce(p_limit, 3), 20))
    for update skip locked
  )
  update public.workspaces w
  set purge_state = 'purging', purge_claimed_at = now()
  from due
  where w.id = due.id
  returning w.id, w.name, w.slug, w.better_auth_organization_id::text;
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
  affected integer;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select * into ws from public.workspaces where id = p_workspace_id for update;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if ws.purge_state <> 'purging'
     or ws.archived_at is null
     or ws.purge_after is null
     or ws.purge_after > now() then
    raise exception 'Workspace is not due for purge' using errcode = '42501';
  end if;

  -- Rows that reference the workspace without ON DELETE CASCADE, or that carry
  -- workspace staff personal data, are removed explicitly and counted.
  delete from public.email_delivery_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || jsonb_build_object('email_delivery_logs', affected);

  delete from public.client_error_reports where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || jsonb_build_object('client_error_reports', affected);

  -- support_request_attachments / support_request_events cascade from here;
  -- the edge function already removed the stored files.
  delete from public.support_requests where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || jsonb_build_object('support_requests', affected);

  -- admin_audit_logs.actor_id and item_logs.performed_by reference profiles
  -- without a delete rule, so workspace-scoped history goes before profiles.
  delete from public.item_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || jsonb_build_object('item_logs', affected);

  delete from public.admin_audit_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || jsonb_build_object('admin_audit_logs', affected);

  select count(*) into affected from public.borrowers where workspace_id = ws.id;
  counts := counts || jsonb_build_object('borrowers', affected);
  select count(*) into affected from public.items where workspace_id = ws.id;
  counts := counts || jsonb_build_object('items', affected);

  update public.workspaces set primary_admin_profile_id = null where id = ws.id;

  delete from public.profiles where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || jsonb_build_object('profiles', affected);

  -- Everything else (borrowers, items, grants, sessions, offline packs,
  -- invitations, policies, usage) cascades from the workspace row.
  delete from public.workspaces where id = ws.id;

  insert into public.workspace_deletion_certificates (
    workspace_id, workspace_name, workspace_slug, account_category,
    archived_at, purge_after, deleted_row_counts, external_cleanup
  )
  values (
    ws.id, ws.name, ws.slug,
    (select wp.account_category from public.workspace_policies wp where wp.workspace_id = ws.id),
    ws.archived_at, ws.purge_after, counts, coalesce(p_external_cleanup, '{}'::jsonb)
  );

  return jsonb_build_object('workspace_id', ws.id, 'deleted_row_counts', counts);
end;
$$;

revoke all on function public.claim_workspaces_due_for_purge(integer) from public, anon, authenticated;
revoke all on function public.release_workspace_purge_claim(uuid) from public, anon, authenticated;
revoke all on function public.purge_workspace_data(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_workspaces_due_for_purge(integer) to service_role;
grant execute on function public.release_workspace_purge_claim(uuid) to service_role;
grant execute on function public.purge_workspace_data(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
