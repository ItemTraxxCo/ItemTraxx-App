-- Complete the physical database vocabulary migration from gear/students to
-- items/borrowers. PostgreSQL table renames preserve row data, FK targets,
-- ownership, grants, and RLS enablement; policies and stored routines are
-- rebuilt below so no runtime SQL retains the legacy relation names.

set lock_timeout = '10s';
set statement_timeout = '120s';

lock table public.gear, public.students, public.gear_logs,
  public.gear_status_history, public.gear_access_grants,
  public.borrower_access_grants, public.workspace_policies
  in access exclusive mode;

drop policy if exists workspace_members_select_gear on public.gear;
drop policy if exists workspace_admin_write_gear on public.gear;
drop policy if exists super_admin_all_gear on public.gear;
drop policy if exists workspace_members_select_students on public.students;
drop policy if exists workspace_admin_write_students on public.students;
drop policy if exists super_admin_all_students on public.students;
drop policy if exists workspace_admin_select_logs on public.gear_logs;
drop policy if exists super_admin_all_logs on public.gear_logs;
drop policy if exists workspace_admin_select_status_history on public.gear_status_history;
drop policy if exists workspace_admin_write_status_history on public.gear_status_history;
drop policy if exists super_admin_all_status_history on public.gear_status_history;
drop policy if exists access_grants_tenant_account_select_gear on public.gear_access_grants;
drop policy if exists access_grants_workspace_admin_all_gear on public.gear_access_grants;
drop policy if exists access_grants_tenant_account_select_borrowers on public.borrower_access_grants;
drop policy if exists access_grants_workspace_admin_all_borrowers on public.borrower_access_grants;

-- This obsolete RPC predates the edge-function checkout path, still refers to
-- removed tenant roles/columns, and was callable by anon. Remove it instead of
-- carrying an unsafe compatibility surface into the renamed schema.
drop function if exists public.checkout_return(text, text[], text);
drop function if exists public.create_borrower_identity(uuid, text, text, text, uuid[]);
drop function if exists public.workspace_account_dashboard();
drop function if exists private.current_profile_can_access_gear(uuid, text);
drop function if exists private.current_profile_can_access_borrower(uuid, text);
drop function if exists private.gear_is_in_current_workspace(uuid);
drop function if exists private.borrower_is_in_current_workspace(uuid);

alter table public.gear rename to items;
alter table public.students rename to borrowers;
alter table public.gear_logs rename to item_logs;
alter table public.gear_status_history rename to item_status_history;
alter table public.gear_access_grants rename to item_access_grants;

alter table public.borrowers rename column student_id to borrower_id;
alter table public.item_logs rename column gear_id to item_id;
alter table public.item_status_history rename column gear_id to item_id;
alter table public.item_access_grants rename column gear_id to item_id;
alter table public.borrower_access_grants rename column student_id to borrower_id;
alter table public.workspace_policies rename column max_gear to max_items;
alter table public.workspace_policies rename column max_students to max_borrowers;

update public.workspace_policies
set feature_flags = (feature_flags - 'enable_bulk_student_tools') ||
  jsonb_build_object(
    'enable_bulk_borrower_tools',
    coalesce((feature_flags ->> 'enable_bulk_student_tools')::boolean, true)
  )
where feature_flags ? 'enable_bulk_student_tools'
   or not feature_flags ? 'enable_bulk_borrower_tools';

do $$
begin
  if to_regclass('public.data_retention_policies') is not null then
    update public.data_retention_policies
    set value = (value - 'gear_days' - 'gear_enabled' - 'students_days' - 'students_enabled') ||
      jsonb_build_object(
        'items_days', coalesce((value ->> 'gear_days')::int, 730),
        'items_enabled', coalesce((value ->> 'gear_enabled')::boolean, false),
        'borrowers_days', coalesce((value ->> 'students_days')::int, 365),
        'borrowers_enabled', coalesce((value ->> 'students_enabled')::boolean, false)
      )
    where key = 'soft_delete';
  end if;
end $$;

-- Rename catalog objects as well, so Supabase Studio and schema inspection do
-- not continue surfacing legacy names after the table migration.
do $$
declare
  object_row record;
  next_name text;
begin
  for object_row in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('i', 'S')
      and c.relname ~ '(gear|students|student)'
  loop
    next_name := replace(replace(replace(object_row.relname, 'students', 'borrowers'), 'student', 'borrower'), 'gear', 'item');
    execute format('alter %s public.%I rename to %I',
      case when object_row.relname like '%_seq' then 'sequence' else 'index' end,
      object_row.relname,
      next_name);
  end loop;

  for object_row in
    select conrelid::regclass as relation_name, conname
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname ~ '(gear|students|student)'
  loop
    next_name := replace(replace(replace(object_row.conname, 'students', 'borrowers'), 'student', 'borrower'), 'gear', 'item');
    execute format('alter table %s rename constraint %I to %I', object_row.relation_name, object_row.conname, next_name);
  end loop;
end $$;

create function private.current_profile_can_access_item(
  p_item_id uuid,
  p_access_mode text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_access_mode = 'all' or exists (
    select 1 from public.item_access_grants grant_row
    where grant_row.item_id = p_item_id
      and grant_row.profile_id = (select auth.uid())
  );
$$;

create function private.current_profile_can_access_borrower(
  p_borrower_id uuid,
  p_access_mode text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_access_mode = 'all' or exists (
    select 1 from public.borrower_access_grants grant_row
    where grant_row.borrower_id = p_borrower_id
      and grant_row.profile_id = (select auth.uid())
  );
$$;

create function private.item_is_in_current_workspace(p_item_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.items item
    where item.id = p_item_id
      and item.workspace_id = (select public.current_workspace_id())
  );
$$;

create function private.borrower_is_in_current_workspace(p_borrower_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.borrowers borrower
    where borrower.id = p_borrower_id
      and borrower.workspace_id = (select public.current_workspace_id())
  );
$$;

create function public.create_borrower_identity(
  p_workspace_id uuid,
  p_username text,
  p_borrower_id text,
  p_access_mode text,
  p_profile_ids uuid[] default '{}'::uuid[]
)
returns table(
  id uuid,
  workspace_id uuid,
  username text,
  borrower_id text,
  access_mode text
)
language plpgsql security definer
set search_path = ''
as $$
declare
  normalized_username text := coalesce(trim(p_username), '');
  normalized_borrower_id text := upper(coalesce(trim(p_borrower_id), ''));
  created_id uuid;
begin
  if p_workspace_id is null
     or p_workspace_id <> (select public.current_workspace_id())
     or (select public.current_user_role()) <> 'workspace_admin'
     or not (select private.current_account_session_is_active()) then
    raise exception 'Unauthorized';
  end if;
  if p_access_mode not in ('all', 'restricted')
     or (p_access_mode = 'restricted' and cardinality(p_profile_ids) = 0) then
    raise exception 'Access choice is required' using errcode = '22023';
  end if;
  if normalized_username = '' or normalized_borrower_id = '' then
    raise exception 'Borrower identity is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_id:' || normalized_borrower_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':username:' || lower(normalized_username), 0));
  insert into public.borrowers(workspace_id, username, borrower_id, access_mode)
  values (p_workspace_id, normalized_username, normalized_borrower_id, p_access_mode)
  returning borrowers.id into created_id;
  if p_access_mode = 'restricted' then
    if exists (
      select 1
      from unnest(p_profile_ids) target(profile_id)
      left join public.profiles profile on profile.id = target.profile_id
      where profile.id is null
        or profile.workspace_id <> p_workspace_id
        or profile.role <> 'tenant_account'
        or not profile.is_active
        or profile.deleted_at is not null
    ) then
      raise exception 'Invalid Tenant Account grant' using errcode = '22023';
    end if;
    insert into public.borrower_access_grants(borrower_id, profile_id, granted_by)
    select created_id, profile_id, (select auth.uid())
    from unnest(p_profile_ids) profile_id;
  end if;
  return query
  select borrower.id, borrower.workspace_id, borrower.username,
    borrower.borrower_id, borrower.access_mode
  from public.borrowers borrower
  where borrower.id = created_id;
end;
$$;

create function public.workspace_account_dashboard()
returns table(
  profile_id uuid,
  auth_email text,
  item_count bigint,
  borrower_count bigint,
  active_checkouts bigint,
  overdue_count bigint
)
language sql stable security definer
set search_path = ''
as $$
  select profile.id, profile.auth_email,
    (select count(*) from public.items item
      where item.workspace_id = profile.workspace_id
        and item.deleted_at is null
        and (item.access_mode = 'all' or exists (
          select 1 from public.item_access_grants grant_row
          where grant_row.item_id = item.id and grant_row.profile_id = profile.id
        ))),
    (select count(*) from public.borrowers borrower
      where borrower.workspace_id = profile.workspace_id
        and borrower.deleted_at is null
        and (borrower.access_mode = 'all' or exists (
          select 1 from public.borrower_access_grants grant_row
          where grant_row.borrower_id = borrower.id and grant_row.profile_id = profile.id
        ))),
    (select count(*) from public.item_logs item_log
      where item_log.workspace_id = profile.workspace_id
        and item_log.performed_by = profile.id
        and item_log.action_type = 'checkout'
        and not exists (
          select 1 from public.item_logs returned
          where returned.item_id = item_log.item_id
            and returned.action_time > item_log.action_time
            and returned.action_type in ('return', 'quick_return', 'admin_return')
        )),
    (select count(*) from public.items item
      join public.item_logs item_log on item_log.item_id = item.id
      where item_log.workspace_id = profile.workspace_id
        and item_log.performed_by = profile.id
        and item_log.action_type = 'checkout'
        and item.status = 'checked_out'
        and item.checked_out_at < now() - make_interval(hours => coalesce((
          select policy.checkout_due_hours from public.workspace_policies policy
          where policy.workspace_id = profile.workspace_id
        ), 72)))
  from public.profiles profile
  where profile.workspace_id = (select public.current_workspace_id())
    and profile.role = 'tenant_account'
    and profile.is_active
    and profile.deleted_at is null
    and (select public.current_user_role()) = 'workspace_admin'
    and (select private.current_account_session_is_active());
$$;

create or replace function public.run_data_retention()
returns jsonb
language plpgsql security definer
set search_path = 'public'
as $$
declare
  soft_delete_cfg jsonb;
  audit_cfg jsonb;
  now_ts timestamptz := now();
  borrowers_deleted int := 0;
  items_deleted int := 0;
  admin_audit_deleted int := 0;
  super_audit_deleted int := 0;
begin
  if to_regclass('public.data_retention_policies') is null then
    return jsonb_build_object('ran_at', now_ts, 'skipped', 'retention policy table unavailable');
  end if;
  select value into soft_delete_cfg
  from public.data_retention_policies
  where key = 'soft_delete';

  if coalesce((soft_delete_cfg ->> 'borrowers_enabled')::boolean, false) then
    delete from public.borrowers
    where deleted_at is not null
      and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg ->> 'borrowers_days')::int, 365)));
    get diagnostics borrowers_deleted = row_count;
  end if;

  if coalesce((soft_delete_cfg ->> 'items_enabled')::boolean, false) then
    delete from public.items
    where deleted_at is not null
      and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg ->> 'items_days')::int, 730)));
    get diagnostics items_deleted = row_count;
  end if;

  select value into audit_cfg
  from public.data_retention_policies
  where key = 'audit_logs';

  if coalesce((audit_cfg ->> 'enabled')::boolean, false) then
    delete from public.admin_audit_logs
    where created_at < now_ts - make_interval(days => greatest(30, coalesce((audit_cfg ->> 'admin_audit_days')::int, 730)));
    get diagnostics admin_audit_deleted = row_count;

    delete from public.super_admin_audit_logs
    where created_at < now_ts - make_interval(days => greatest(30, coalesce((audit_cfg ->> 'super_audit_days')::int, 1095)));
    get diagnostics super_audit_deleted = row_count;
  end if;

  return jsonb_build_object(
    'ran_at', now_ts,
    'borrowers_deleted', borrowers_deleted,
    'items_deleted', items_deleted,
    'admin_audit_deleted', admin_audit_deleted,
    'super_audit_deleted', super_audit_deleted
  );
end;
$$;

create policy workspace_members_select_items on public.items
for select to authenticated
using (
  workspace_id = (select public.current_workspace_id())
  and deleted_at is null
  and (select private.current_account_session_is_active())
  and (
    (select public.current_user_role()) = 'workspace_admin'
    or (
      (select public.current_user_role()) = 'tenant_account'
      and (select private.current_profile_can_access_item(items.id, items.access_mode))
    )
  )
);
create policy workspace_admin_write_items on public.items
for all to authenticated
using (
  (select public.current_user_role()) = 'workspace_admin'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
)
with check (
  (select public.current_user_role()) = 'workspace_admin'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
create policy super_admin_all_items on public.items
to authenticated
using ((select public.current_user_role()) = 'super_admin')
with check ((select public.current_user_role()) = 'super_admin');

create policy workspace_members_select_borrowers on public.borrowers
for select to authenticated
using (
  workspace_id = (select public.current_workspace_id())
  and deleted_at is null
  and (select private.current_account_session_is_active())
  and (
    (select public.current_user_role()) = 'workspace_admin'
    or (
      (select public.current_user_role()) = 'tenant_account'
      and (select private.current_profile_can_access_borrower(borrowers.id, borrowers.access_mode))
    )
  )
);
create policy workspace_admin_write_borrowers on public.borrowers
for all to authenticated
using (
  (select public.current_user_role()) = 'workspace_admin'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
)
with check (
  (select public.current_user_role()) = 'workspace_admin'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
create policy super_admin_all_borrowers on public.borrowers
to authenticated
using ((select public.current_user_role()) = 'super_admin')
with check ((select public.current_user_role()) = 'super_admin');

create policy workspace_admin_select_item_logs on public.item_logs
for select to authenticated
using (
  (select public.current_user_role()) = 'workspace_admin'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
create policy super_admin_all_item_logs on public.item_logs
to authenticated
using ((select public.current_user_role()) = 'super_admin')
with check ((select public.current_user_role()) = 'super_admin');

create policy workspace_admin_select_item_status_history on public.item_status_history
for select to authenticated
using (
  (select public.current_user_role()) = 'workspace_admin'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
create policy workspace_admin_write_item_status_history on public.item_status_history
for insert to authenticated
with check (
  (select public.current_user_role()) = 'workspace_admin'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
create policy super_admin_all_item_status_history on public.item_status_history
to authenticated
using ((select public.current_user_role()) = 'super_admin')
with check ((select public.current_user_role()) = 'super_admin');

create policy access_grants_tenant_account_select_items on public.item_access_grants
for select to authenticated
using (
  profile_id = (select auth.uid())
  and (select private.current_account_session_is_active())
);
create policy access_grants_workspace_admin_all_items on public.item_access_grants
to authenticated
using (
  (select public.current_user_role()) = 'workspace_admin'
  and (select private.item_is_in_current_workspace(item_access_grants.item_id))
  and (select private.current_account_session_is_active())
)
with check (
  (select public.current_user_role()) = 'workspace_admin'
  and (select private.item_is_in_current_workspace(item_access_grants.item_id))
  and (select private.current_account_session_is_active())
);

create policy access_grants_tenant_account_select_borrowers on public.borrower_access_grants
for select to authenticated
using (
  profile_id = (select auth.uid())
  and (select private.current_account_session_is_active())
);
create policy access_grants_workspace_admin_all_borrowers on public.borrower_access_grants
to authenticated
using (
  (select public.current_user_role()) = 'workspace_admin'
  and (select private.borrower_is_in_current_workspace(borrower_access_grants.borrower_id))
  and (select private.current_account_session_is_active())
)
with check (
  (select public.current_user_role()) = 'workspace_admin'
  and (select private.borrower_is_in_current_workspace(borrower_access_grants.borrower_id))
  and (select private.current_account_session_is_active())
);

revoke all on function private.current_profile_can_access_item(uuid, text) from public, anon, authenticated;
revoke all on function private.current_profile_can_access_borrower(uuid, text) from public, anon, authenticated;
revoke all on function private.item_is_in_current_workspace(uuid) from public, anon, authenticated;
revoke all on function private.borrower_is_in_current_workspace(uuid) from public, anon, authenticated;
grant execute on function private.current_profile_can_access_item(uuid, text) to authenticated, service_role;
grant execute on function private.current_profile_can_access_borrower(uuid, text) to authenticated, service_role;
grant execute on function private.item_is_in_current_workspace(uuid) to authenticated, service_role;
grant execute on function private.borrower_is_in_current_workspace(uuid) to authenticated, service_role;

revoke all on function public.create_borrower_identity(uuid, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.create_borrower_identity(uuid, text, text, text, uuid[]) to service_role;
revoke all on function public.workspace_account_dashboard() from public, anon, authenticated;
grant execute on function public.workspace_account_dashboard() to service_role;
revoke all on function public.run_data_retention() from public, anon, authenticated;
grant execute on function public.run_data_retention() to service_role;

notify pgrst, 'reload schema';
