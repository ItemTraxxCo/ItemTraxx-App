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
-- still fail afterward and be retried. Keep a private, durable receipt so the
-- final deletion certificate can report the logo cleanup on a later attempt.
create table if not exists private.workspace_purge_external_cleanup (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  organization_logo_deleted_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on table private.workspace_purge_external_cleanup from public, anon, authenticated, service_role;

-- Add the persisted organization-cleanup result to the claim response. The
-- return shape changes, so drop and recreate the RPC before restoring its
-- service-role-only permissions.
drop function public.claim_workspaces_due_for_purge(integer);
create function public.claim_workspaces_due_for_purge(p_limit integer default 3)
returns table (
  id uuid,
  name text,
  slug text,
  better_auth_organization_id text,
  organization_logo_deleted boolean
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
    select
      w.id,
      exists (
        select 1
        from private.workspace_purge_external_cleanup as cleanup
        where cleanup.workspace_id = w.id
      ) as organization_logo_deleted
    from public.workspaces as w
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
    for update of w skip locked
  )
  update public.workspaces as w
  set purge_state = 'purging', purge_claimed_at = pg_catalog.clock_timestamp()
  from due
  where w.id = due.id
  returning w.id, null::text, null::text, w.better_auth_organization_id::text,
    due.organization_logo_deleted;
end;
$$;

revoke all on function public.claim_workspaces_due_for_purge(integer) from public, anon, authenticated;
grant execute on function public.claim_workspaces_due_for_purge(integer) to service_role;

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
