-- The workspace purge executor deletes the Better Auth organization before
-- purge_workspace_data runs, so a failed external step leaves the workspace
-- claimable for retry. The RESTRICT link from public.workspaces rejected
-- that delete, so every due workspace with an organization failed and went
-- back to grace on each worker run.
--
-- Clear the link when the organization is deleted, and keep the RESTRICT
-- behavior with a trigger for every workspace that is not being purged.
-- (Profile/better_auth.user links already go through
-- purge_workspace_better_auth_user, which clears the link before deleting,
-- so that foreign key stays RESTRICT and needs no trigger.)

begin;

-- The organization link is cleared by ON DELETE SET NULL, but the purge can
-- still fail afterward and be retried. Keep a private receipt until the final
-- deletion certificate is inserted so retry cleanup is reported accurately.
-- This table intentionally has no workspace FK: purge_workspace_data deletes
-- the workspace before it inserts the certificate that consumes this receipt.
create table if not exists private.workspace_purge_external_cleanup (
  workspace_id uuid primary key,
  organization_logo_deleted_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table private.workspace_purge_external_cleanup enable row level security;
revoke all on table private.workspace_purge_external_cleanup from public, anon, authenticated, service_role;

create or replace function private.guard_linked_better_auth_organization_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.workspaces as w
    where w.better_auth_organization_id = old.id
      and w.purge_state is distinct from 'purging'
  ) then
    raise exception 'Better Auth organization is linked to an ItemTraxx workspace'
      using errcode = '23503';
  end if;

  insert into private.workspace_purge_external_cleanup (workspace_id)
  select w.id
  from public.workspaces as w
  where w.better_auth_organization_id = old.id
    and w.purge_state = 'purging'
  on conflict (workspace_id) do update
    set organization_logo_deleted_at = excluded.organization_logo_deleted_at;

  return old;
end;
$$;

revoke all on function private.guard_linked_better_auth_organization_delete() from public, anon, authenticated;

create or replace function private.apply_workspace_purge_external_cleanup_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.workspace_purge_external_cleanup as cleanup
    where cleanup.workspace_id = new.workspace_id
  ) then
    new.external_cleanup := coalesce(new.external_cleanup, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('organization_logo', 1);
    delete from private.workspace_purge_external_cleanup as cleanup
    where cleanup.workspace_id = new.workspace_id;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_workspace_purge_external_cleanup_receipt() from public, anon, authenticated;

drop trigger if exists apply_workspace_purge_external_cleanup_receipt on public.workspace_deletion_certificates;
create trigger apply_workspace_purge_external_cleanup_receipt
before insert on public.workspace_deletion_certificates
for each row execute function private.apply_workspace_purge_external_cleanup_receipt();

drop trigger if exists guard_linked_workspace_delete on better_auth.organization;
create trigger guard_linked_workspace_delete
before delete on better_auth.organization
for each row execute function private.guard_linked_better_auth_organization_delete();

do $$
declare
  fk_name text;
begin
  for fk_name in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.workspaces'::regclass
      and con.contype = 'f'
      and con.confrelid = 'better_auth.organization'::regclass
  loop
    execute pg_catalog.format('alter table public.workspaces drop constraint %I', fk_name);
  end loop;
end;
$$;

alter table public.workspaces
  add constraint workspaces_better_auth_organization_id_fkey
  foreign key (better_auth_organization_id) references better_auth.organization(id) on delete set null;

notify pgrst, 'reload schema';

commit;
