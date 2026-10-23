-- Individual Accounts use a private workspace as their data-isolation boundary,
-- but have a dedicated application and Better Auth membership role.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin', 'workspace_admin', 'tenant_account', 'individual_account'));

alter table public.privileged_session_stepups
  drop constraint if exists privileged_session_stepups_role_scope_check;
alter table public.privileged_session_stepups
  add constraint privileged_session_stepups_role_scope_check
  check (role_scope in ('super_admin', 'workspace_admin', 'individual_account'));

create table if not exists public.workspace_usage (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  active_items integer not null default 0 check (active_items >= 0),
  active_borrowers integer not null default 0 check (active_borrowers >= 0),
  updated_at timestamptz not null default now()
);

insert into public.workspace_usage (workspace_id, active_items, active_borrowers)
select
  w.id,
  (select count(*)::integer from public.items i where i.workspace_id = w.id and i.deleted_at is null),
  (select count(*)::integer from public.borrowers b where b.workspace_id = w.id and b.deleted_at is null)
from public.workspaces w
on conflict (workspace_id) do update set
  active_items = excluded.active_items,
  active_borrowers = excluded.active_borrowers,
  updated_at = now();

alter table public.workspace_usage enable row level security;
drop policy if exists workspace_members_select_usage on public.workspace_usage;
create policy workspace_members_select_usage on public.workspace_usage
for select to authenticated
using (
  workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
drop policy if exists super_admin_all_usage on public.workspace_usage;
create policy super_admin_all_usage on public.workspace_usage
to authenticated
using ((select public.current_user_role()) = 'super_admin')
with check ((select public.current_user_role()) = 'super_admin');

revoke all on table public.workspace_usage from public, anon;
grant select on table public.workspace_usage to authenticated;
grant all on table public.workspace_usage to service_role;

create or replace function private.initialize_workspace_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_usage (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_workspace_usage on public.workspaces;
create trigger initialize_workspace_usage
after insert on public.workspaces
for each row execute function private.initialize_workspace_usage();

create or replace function private.enforce_active_inventory_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_name text;
  usage_column text;
  policy_column text;
  current_count integer;
  maximum_count integer;
  should_increment boolean := false;
  should_decrement boolean := false;
begin
  if tg_table_name = 'items' then
    resource_name := 'items';
    usage_column := 'active_items';
    policy_column := 'max_items';
  elsif tg_table_name = 'borrowers' then
    resource_name := 'borrowers';
    usage_column := 'active_borrowers';
    policy_column := 'max_borrowers';
  else
    raise exception 'unsupported quota table';
  end if;

  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'inventory workspace cannot be changed';
  end if;

  if tg_op = 'INSERT' then
    should_increment := new.deleted_at is null;
  elsif tg_op = 'DELETE' then
    should_decrement := old.deleted_at is null;
  else
    should_increment := old.deleted_at is not null and new.deleted_at is null;
    should_decrement := old.deleted_at is null and new.deleted_at is not null;
  end if;

  if should_increment then
    insert into public.workspace_usage (workspace_id)
    values (new.workspace_id)
    on conflict (workspace_id) do nothing;

    execute format(
      'update public.workspace_usage u set %1$I = u.%1$I + 1, updated_at = now() where u.workspace_id = $1 and ((select %2$I from public.workspace_policies where workspace_id = $1) is null or u.%1$I < (select %2$I from public.workspace_policies where workspace_id = $1)) returning u.%1$I, (select %2$I from public.workspace_policies where workspace_id = $1)',
      usage_column,
      policy_column
    ) into current_count, maximum_count using new.workspace_id;

    if current_count is null then
      execute format(
        'select u.%1$I, p.%2$I from public.workspace_usage u left join public.workspace_policies p on p.workspace_id = u.workspace_id where u.workspace_id = $1',
        usage_column,
        policy_column
      ) into current_count, maximum_count using new.workspace_id;
      raise exception using
        errcode = 'P0001',
        message = upper(resource_name) || '_LIMIT_REACHED',
        detail = jsonb_build_object(
          'resource', resource_name,
          'current', coalesce(current_count, 0),
          'maximum', maximum_count
        )::text;
    end if;
  elsif should_decrement then
    execute format(
      'update public.workspace_usage set %1$I = greatest(%1$I - 1, 0), updated_at = now() where workspace_id = $1',
      usage_column
    ) using old.workspace_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_items_active_quota on public.items;
create trigger enforce_items_active_quota
before insert or delete or update of deleted_at, workspace_id on public.items
for each row execute function private.enforce_active_inventory_quota();

drop trigger if exists enforce_borrowers_active_quota on public.borrowers;
create trigger enforce_borrowers_active_quota
before insert or delete or update of deleted_at, workspace_id on public.borrowers
for each row execute function private.enforce_active_inventory_quota();

create or replace function private.enforce_individual_profile_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category text;
begin
  if new.workspace_id is null then
    if new.role = 'individual_account' then
      raise exception 'individual account requires a workspace';
    end if;
    return new;
  end if;

  select wp.account_category into category
  from public.workspace_policies wp
  where wp.workspace_id = new.workspace_id;

  if new.role = 'individual_account' and category is distinct from 'individual' then
    raise exception 'individual account requires an individual workspace policy';
  end if;
  if category = 'individual' and new.role <> 'individual_account' then
    raise exception 'individual workspace only accepts an individual account';
  end if;
  if category = 'individual' and new.is_active and new.deleted_at is null and exists (
    select 1 from public.profiles p
    where p.workspace_id = new.workspace_id
      and p.id <> new.id
      and p.is_active
      and p.deleted_at is null
  ) then
    raise exception 'individual workspace already has an active account';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_individual_profile_boundary on public.profiles;
create trigger enforce_individual_profile_boundary
before insert or update of workspace_id, role, is_active, deleted_at on public.profiles
for each row execute function private.enforce_individual_profile_boundary();

create or replace function private.enforce_individual_policy_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_profiles integer;
  incompatible_profiles integer;
begin
  select
    count(*) filter (where p.is_active and p.deleted_at is null),
    count(*) filter (where p.role <> 'individual_account')
  into active_profiles, incompatible_profiles
  from public.profiles p
  where p.workspace_id = new.workspace_id;

  if new.account_category = 'individual' then
    if new.plan_code not in ('individual_yearly', 'individual_monthly') then
      raise exception 'individual workspace requires an individual plan';
    end if;
    if active_profiles > 1 or incompatible_profiles > 0 then
      raise exception 'workspace members are incompatible with an individual policy';
    end if;
  elsif exists (
    select 1 from public.profiles p
    where p.workspace_id = new.workspace_id and p.role = 'individual_account'
  ) then
    raise exception 'individual account requires an individual workspace policy';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_individual_policy_boundary on public.workspace_policies;
create trigger enforce_individual_policy_boundary
before insert or update of account_category, plan_code on public.workspace_policies
for each row execute function private.enforce_individual_policy_boundary();

create or replace function private.enforce_individual_membership_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category text;
begin
  select wp.account_category into category
  from public.workspaces w
  join public.workspace_policies wp on wp.workspace_id = w.id
  where w.better_auth_organization_id = new."organizationId";

  if category = 'individual' then
    if new.role <> 'individual_account' then
      raise exception 'individual workspace requires an individual membership';
    end if;
    if exists (
      select 1 from better_auth.member m
      where m."organizationId" = new."organizationId"
        and m.id <> new.id
    ) then
      raise exception 'individual workspace already has a membership';
    end if;
  elsif new.role = 'individual_account' then
    raise exception 'individual membership requires an individual workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_individual_membership_boundary on better_auth.member;
create trigger enforce_individual_membership_boundary
before insert or update of "organizationId", role on better_auth.member
for each row execute function private.enforce_individual_membership_boundary();

drop policy if exists individual_account_select_items on public.items;
create policy individual_account_select_items on public.items
for select to authenticated
using (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and deleted_at is null
  and access_mode = 'all'
  and (select private.current_account_session_is_active())
);
drop policy if exists individual_account_write_items on public.items;
create policy individual_account_write_items on public.items
for all to authenticated
using (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and access_mode = 'all'
  and (select private.current_account_session_is_active())
)
with check (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and access_mode = 'all'
  and (select private.current_account_session_is_active())
);

drop policy if exists individual_account_select_borrowers on public.borrowers;
create policy individual_account_select_borrowers on public.borrowers
for select to authenticated
using (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and deleted_at is null
  and access_mode = 'all'
  and (select private.current_account_session_is_active())
);
drop policy if exists individual_account_write_borrowers on public.borrowers;
create policy individual_account_write_borrowers on public.borrowers
for all to authenticated
using (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and access_mode = 'all'
  and (select private.current_account_session_is_active())
)
with check (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and access_mode = 'all'
  and (select private.current_account_session_is_active())
);

drop policy if exists individual_account_select_item_logs on public.item_logs;
create policy individual_account_select_item_logs on public.item_logs
for select to authenticated
using (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
drop policy if exists individual_account_select_item_status_history on public.item_status_history;
create policy individual_account_select_item_status_history on public.item_status_history
for select to authenticated
using (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
drop policy if exists individual_account_write_item_status_history on public.item_status_history;
create policy individual_account_write_item_status_history on public.item_status_history
for insert to authenticated
with check (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
drop policy if exists individual_account_select_audit on public.admin_audit_logs;
create policy individual_account_select_audit on public.admin_audit_logs
for select to authenticated
using (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
drop policy if exists individual_account_insert_audit on public.admin_audit_logs;
create policy individual_account_insert_audit on public.admin_audit_logs
for insert to authenticated
with check (
  (select public.current_user_role()) = 'individual_account'
  and workspace_id = (select public.current_workspace_id())
  and actor_id = (select auth.uid())
  and (select private.current_account_session_is_active())
);

create or replace function public.better_auth_create_user(
  p_profile_id uuid,
  p_user_id text,
  p_account_id text,
  p_email text,
  p_name text,
  p_global_role text,
  p_password_hash text,
  p_workspace_id uuid default null,
  p_member_id text default null,
  p_member_role text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id text;
begin
  if p_profile_id is null or nullif(p_user_id, '') is null or nullif(p_account_id, '') is null
     or nullif(p_email, '') is null or nullif(p_password_hash, '') is null then
    raise exception 'invalid user input';
  end if;
  if p_global_role not in ('user', 'super_admin') then raise exception 'invalid global role'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and deleted_at is null) then
    raise exception 'profile not found';
  end if;

  insert into better_auth."user"(id, name, email, "emailVerified", "createdAt", "updatedAt", role)
  values (p_user_id, coalesce(nullif(trim(p_name), ''), lower(trim(p_email))), lower(trim(p_email)), true, now(), now(), p_global_role);
  insert into better_auth.account(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  values (p_account_id, p_user_id, 'credential', p_user_id, p_password_hash, now(), now());

  if p_workspace_id is not null then
    if p_member_role not in ('tenant_account', 'workspace_admin', 'individual_account') or nullif(p_member_id, '') is null then
      raise exception 'invalid membership input';
    end if;
    select better_auth_organization_id into v_organization_id
    from public.workspaces where id = p_workspace_id and archived_at is null;
    if v_organization_id is null then raise exception 'workspace organization missing'; end if;
    insert into better_auth.member(id, "organizationId", "userId", role, "createdAt")
    values (p_member_id, v_organization_id, p_user_id, p_member_role, now());
  end if;

  update public.profiles
  set better_auth_user_id = p_user_id, auth_email = lower(trim(p_email))
  where id = p_profile_id;
  return p_user_id;
end;
$$;

revoke all on function public.better_auth_create_user(uuid, text, text, text, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.better_auth_create_user(uuid, text, text, text, text, text, text, uuid, text, text) to service_role;

revoke all on function private.initialize_workspace_usage() from public, anon, authenticated;
revoke all on function private.enforce_active_inventory_quota() from public, anon, authenticated;
revoke all on function private.enforce_individual_profile_boundary() from public, anon, authenticated;
revoke all on function private.enforce_individual_policy_boundary() from public, anon, authenticated;
revoke all on function private.enforce_individual_membership_boundary() from public, anon, authenticated;


-- Extend the atomic online and offline checkout implementations to the
-- dedicated Individual Account manager role.
create or replace function public.apply_checkout_return_item(
  p_workspace_id uuid,
  p_profile_id uuid,
  p_item_id uuid,
  p_operation_id text,
  p_action_type text,
  p_borrower_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  requested_action text := lower(btrim(coalesce(p_action_type, '')));
  v_operation_id text := btrim(coalesce(p_operation_id, ''));
  item_row public.items%rowtype;
  resolved_action text;
  target_status text;
  target_borrower uuid;
  log_borrower uuid;
  log_operation_id text;
  has_existing_operation boolean;
begin
  if p_workspace_id is null
     or p_profile_id is null
     or p_item_id is null
     or v_operation_id = ''
     or char_length(v_operation_id) > 128
     or requested_action not in ('checkout', 'return', 'auto', 'admin_return', 'quick_return') then
    raise exception 'Invalid checkout/return payload' using errcode = '22023';
  end if;

  select profile.role into actor_role
  from public.profiles profile
  join public.workspaces workspace on workspace.id = profile.workspace_id
  where profile.id = p_profile_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('tenant_account', 'workspace_admin', 'individual_account')
    and profile.is_active
    and profile.deleted_at is null
    and workspace.status = 'active';

  if actor_role is null then
    raise exception 'Checkout/return actor is not active' using errcode = '42501';
  end if;

  if requested_action in ('admin_return', 'quick_return')
     and actor_role not in ('workspace_admin', 'individual_account') then
    raise exception 'Administrative return requires an inventory manager' using errcode = '42501';
  end if;

  select item.* into item_row
  from public.items item
  where item.id = p_item_id
    and item.workspace_id = p_workspace_id
    and item.deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('status', 'skipped', 'reason', 'item_unavailable');
  end if;

  if actor_role = 'tenant_account'
     and item_row.access_mode <> 'all'
     and not exists (
       select 1
       from public.item_access_grants grant_row
       where grant_row.item_id = p_item_id
         and grant_row.profile_id = p_profile_id
     ) then
    return jsonb_build_object('status', 'skipped', 'reason', 'item_unavailable');
  end if;

  if requested_action in ('checkout', 'return', 'auto') then
    if p_borrower_id is null or not exists (
      select 1
      from public.borrowers borrower
      where borrower.id = p_borrower_id
        and borrower.workspace_id = p_workspace_id
        and borrower.deleted_at is null
        and (
          actor_role = 'workspace_admin'
          or borrower.access_mode = 'all'
          or exists (
            select 1
            from public.borrower_access_grants grant_row
            where grant_row.borrower_id = borrower.id
              and grant_row.profile_id = p_profile_id
          )
        )
    ) then
      return jsonb_build_object('status', 'skipped', 'reason', 'borrower_unavailable');
    end if;
  end if;

  -- Check both normal action log keys before inspecting current state. This is
  -- what makes a retried auto/checkout/return request idempotent even after the
  -- first transaction has already changed the item state.
  if requested_action in ('checkout', 'return', 'auto') then
    select exists (
      select 1
      from public.item_logs item_log
      where item_log.workspace_id = p_workspace_id
        and item_log.item_id = p_item_id
        and item_log.operation_id in (
          v_operation_id || ':' || p_item_id::text || ':checkout',
          v_operation_id || ':' || p_item_id::text || ':return'
        )
    ) into has_existing_operation;
  else
    select exists (
      select 1
      from public.item_logs item_log
      where item_log.workspace_id = p_workspace_id
        and item_log.item_id = p_item_id
        and item_log.operation_id = v_operation_id || ':' || p_item_id::text || ':' || requested_action
    ) into has_existing_operation;
  end if;

  if has_existing_operation then
    return jsonb_build_object('status', 'idempotent');
  end if;

  if requested_action = 'auto' then
    if lower(item_row.status) = 'available' and item_row.checked_out_by is null then
      resolved_action := 'checkout';
    elsif lower(item_row.status) = 'checked_out'
      and item_row.checked_out_by is not distinct from p_borrower_id then
      resolved_action := 'return';
    else
      return jsonb_build_object('status', 'skipped', 'reason', 'state_changed');
    end if;
  elsif requested_action = 'checkout' then
    if lower(item_row.status) <> 'available' or item_row.checked_out_by is not null then
      return jsonb_build_object('status', 'skipped', 'reason', 'state_changed');
    end if;
    resolved_action := 'checkout';
  elsif requested_action = 'return' then
    if lower(item_row.status) <> 'checked_out'
       or item_row.checked_out_by is distinct from p_borrower_id then
      return jsonb_build_object('status', 'skipped', 'reason', 'state_changed');
    end if;
    resolved_action := 'return';
  else
    if lower(item_row.status) <> 'checked_out' or item_row.checked_out_by is null then
      return jsonb_build_object('status', 'skipped', 'reason', 'state_changed');
    end if;
    resolved_action := requested_action;
  end if;

  if resolved_action = 'checkout' then
    target_status := 'checked_out';
    target_borrower := p_borrower_id;
    log_borrower := p_borrower_id;
  else
    target_status := 'available';
    target_borrower := null;
    log_borrower := coalesce(p_borrower_id, item_row.checked_out_by);
  end if;

  if log_borrower is null or not exists (
    select 1
    from public.borrowers borrower
    where borrower.id = log_borrower
      and borrower.workspace_id = p_workspace_id
  ) then
    raise exception 'Checkout/return log borrower is invalid' using errcode = '22023';
  end if;

  log_operation_id := v_operation_id || ':' || p_item_id::text || ':' || resolved_action;

  update public.items
  set status = target_status,
      checked_out_by = target_borrower,
      checked_out_at = case when target_status = 'checked_out' then now() else null end
  where id = p_item_id;

  insert into public.item_logs(
    workspace_id, item_id, checked_out_by, action_type, performed_by, operation_id
  ) values (
    p_workspace_id, p_item_id, log_borrower, resolved_action, p_profile_id, log_operation_id
  ) on conflict (workspace_id, item_id, action_type, operation_id) do nothing;

  return jsonb_build_object(
    'status', 'processed',
    'action_type', resolved_action
  );
end;
$$;



create or replace function public.apply_offline_checkout_item(
  p_workspace_id uuid,
  p_profile_id uuid,
  p_device_id text,
  p_pack_id uuid,
  p_operation_id text,
  p_item_id uuid,
  p_barcode text,
  p_intent text,
  p_borrower_id uuid,
  p_expected_status text,
  p_expected_checked_out_by uuid,
  p_conflict_id uuid default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A forced conflict resolution must satisfy the same borrower grant as a
  -- fresh replay. Workspace admins retain their existing broad access, while
  -- tenant accounts must have an active borrower grant (or an all-access
  -- borrower). This check is inside the transaction before the locked,
  -- service-role implementation can mutate the item.
  if p_intent in ('checkout', 'return', 'quick_return') and not exists (
    select 1
    from public.profiles actor
    join public.workspaces workspace
      on workspace.id = actor.workspace_id
    join public.borrowers borrower
      on borrower.id = p_borrower_id
     and borrower.workspace_id = p_workspace_id
     and borrower.deleted_at is null
    where actor.id = p_profile_id
      and actor.workspace_id = p_workspace_id
      and actor.role in ('tenant_account', 'workspace_admin', 'individual_account')
      and actor.is_active
      and actor.deleted_at is null
      and workspace.status = 'active'
      and (
        actor.role in ('workspace_admin', 'individual_account')
        or borrower.access_mode = 'all'
        or exists (
          select 1
          from public.borrower_access_grants grant_row
          where grant_row.borrower_id = borrower.id
            and grant_row.profile_id = p_profile_id
        )
      )
  ) then
    raise exception 'Offline borrower access changed' using errcode = '42501';
  end if;

  return public.apply_offline_checkout_item_unchecked(
    p_workspace_id,
    p_profile_id,
    p_device_id,
    p_pack_id,
    p_operation_id,
    p_item_id,
    p_barcode,
    p_intent,
    p_borrower_id,
    p_expected_status,
    p_expected_checked_out_by,
    p_conflict_id,
    p_force
  );
end;
$$;

create or replace function public.apply_offline_checkout_item_unchecked(
  p_workspace_id uuid,
  p_profile_id uuid,
  p_device_id text,
  p_pack_id uuid,
  p_operation_id text,
  p_item_id uuid,
  p_barcode text,
  p_intent text,
  p_borrower_id uuid,
  p_expected_status text,
  p_expected_checked_out_by uuid,
  p_conflict_id uuid default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  item_row public.items%rowtype;
  target_status text;
  target_borrower uuid;
  log_borrower uuid;
  log_operation_id text;
begin
  if p_workspace_id is null or p_profile_id is null or p_pack_id is null
     or p_item_id is null or coalesce(btrim(p_device_id), '') = ''
     or char_length(p_device_id) > 128
     or coalesce(btrim(p_operation_id), '') = ''
     or char_length(p_operation_id) > 128
     or coalesce(btrim(p_barcode), '') = ''
     or char_length(p_barcode) > 64
     or p_intent not in ('checkout', 'return', 'quick_return')
     or p_expected_status not in ('available', 'checked_out') then
    raise exception 'Invalid offline checkout payload' using errcode = '22023';
  end if;
  if (
    p_intent = 'checkout'
    and (p_borrower_id is null or p_expected_status <> 'available'
      or p_expected_checked_out_by is not null)
  ) or (
    p_intent in ('return', 'quick_return')
    and (p_borrower_id is null or p_expected_status <> 'checked_out'
      or p_expected_checked_out_by is null
      or p_borrower_id is distinct from p_expected_checked_out_by)
  ) then
    raise exception 'Offline checkout intent does not match its snapshot' using errcode = '22023';
  end if;

  select profile.role into actor_role
  from public.profiles profile
  join public.workspaces workspace on workspace.id = profile.workspace_id
  where profile.id = p_profile_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('tenant_account', 'workspace_admin', 'individual_account')
    and profile.is_active
    and profile.deleted_at is null
    and workspace.status = 'active';
  if actor_role is null then
    raise exception 'Offline checkout actor is not active' using errcode = '42501';
  end if;
  if p_intent = 'quick_return' and actor_role not in ('workspace_admin', 'individual_account') then
    raise exception 'Quick Return requires an inventory manager' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.offline_checkout_packs pack
    where pack.id = p_pack_id
      and pack.workspace_id = p_workspace_id
      and pack.profile_id = p_profile_id
      and pack.device_id = p_device_id
      and pack.invalidated_at is null
      and exists (
        select 1 from public.account_sessions account_session
        where account_session.workspace_id = p_workspace_id
          and account_session.profile_id = p_profile_id
          and account_session.device_id = p_device_id
          and account_session.revoked_at is null
      )
  ) or not exists (
    select 1 from public.offline_checkout_pack_items packed_item
    where packed_item.pack_id = p_pack_id
      and packed_item.item_id = p_item_id
  ) then
    raise exception 'Offline checkout pack is not active' using errcode = '42501';
  end if;

  if p_force then
    if p_conflict_id is null or not exists (
      select 1
      from public.offline_checkout_conflicts conflict
      cross join lateral jsonb_array_elements(conflict.offline_payload) payload
      where conflict.id = p_conflict_id
        and conflict.pack_id = p_pack_id
        and conflict.workspace_id = p_workspace_id
        and conflict.profile_id = p_profile_id
        and conflict.device_id = p_device_id
        and conflict.operation_id = p_operation_id
        and conflict.status = 'pending'
        and payload ->> 'item_id' = p_item_id::text
        and payload ->> 'barcode' = p_barcode
        and payload ->> 'intent' = p_intent
        and coalesce(payload ->> 'borrower_id', '') = coalesce(p_borrower_id::text, '')
        and payload ->> 'expected_status' = p_expected_status
        and coalesce(payload ->> 'expected_checked_out_by', '') =
          coalesce(p_expected_checked_out_by::text, '')
    ) then
      raise exception 'Offline checkout conflict is not eligible for resolution' using errcode = '42501';
    end if;
  elsif p_conflict_id is not null then
    raise exception 'Unexpected offline checkout conflict' using errcode = '22023';
  end if;

  select item.* into item_row
  from public.items item
  where item.id = p_item_id
    and item.workspace_id = p_workspace_id
    and item.deleted_at is null
  for update;
  if not found or item_row.barcode is distinct from p_barcode then
    return jsonb_build_object('status', 'needs_review', 'reason', 'item_unavailable');
  end if;

  if actor_role = 'tenant_account'
     and item_row.access_mode <> 'all'
     and not exists (
       select 1 from public.item_access_grants grant_row
       where grant_row.item_id = p_item_id and grant_row.profile_id = p_profile_id
     ) then
    raise exception 'Offline item access changed' using errcode = '42501';
  end if;

  if p_intent = 'checkout' then
    if p_borrower_id is null or not exists (
      select 1 from public.borrowers borrower
      where borrower.id = p_borrower_id
        and borrower.workspace_id = p_workspace_id
        and borrower.deleted_at is null
        and (
          actor_role in ('workspace_admin', 'individual_account')
          or borrower.access_mode = 'all'
          or exists (
            select 1 from public.borrower_access_grants grant_row
            where grant_row.borrower_id = borrower.id
              and grant_row.profile_id = p_profile_id
          )
        )
    ) then
      raise exception 'Offline borrower access changed' using errcode = '42501';
    end if;
    target_status := 'checked_out';
    target_borrower := p_borrower_id;
  else
    target_status := 'available';
    target_borrower := null;
  end if;

  log_borrower := coalesce(
    p_borrower_id,
    p_expected_checked_out_by,
    item_row.checked_out_by
  );
  if log_borrower is null or not exists (
    select 1 from public.borrowers borrower
    where borrower.id = log_borrower and borrower.workspace_id = p_workspace_id
  ) then
    raise exception 'Offline checkout log borrower is invalid' using errcode = '22023';
  end if;
  log_operation_id := p_operation_id || ':' || p_item_id::text || ':' || p_intent || ':offline';

  if lower(item_row.status) = target_status
     and item_row.checked_out_by is not distinct from target_borrower then
    insert into public.item_logs(
      workspace_id, item_id, checked_out_by, action_type, performed_by, operation_id
    ) values (
      p_workspace_id, p_item_id, log_borrower, p_intent, p_profile_id, log_operation_id
    ) on conflict (workspace_id, item_id, action_type, operation_id) do nothing;
    if p_intent = 'quick_return' then
      insert into public.admin_audit_logs(
        workspace_id, actor_id, action_type, entity_type, entity_id, metadata
      ) values (
        p_workspace_id,
        p_profile_id,
        'quick_return',
        null,
        null,
        jsonb_build_object(
          'count', 1,
          'barcodes', jsonb_build_array(p_barcode),
          'source', 'offline_replay',
          'operation_id', p_operation_id,
          'item_id', p_item_id
        )
      ) on conflict do nothing;
    end if;
    return jsonb_build_object('status', 'idempotent');
  end if;

  if not p_force and (
    lower(item_row.status) <> lower(p_expected_status)
    or item_row.checked_out_by is distinct from p_expected_checked_out_by
  ) then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', 'server_state_changed',
      'server_state', jsonb_build_object(
        'id', item_row.id,
        'name', item_row.name,
        'barcode', item_row.barcode,
        'status', item_row.status,
        'checked_out_by', item_row.checked_out_by
      )
    );
  end if;

  update public.items
  set status = target_status,
      checked_out_by = target_borrower,
      checked_out_at = case when target_status = 'checked_out' then now() else null end
  where id = p_item_id;

  insert into public.item_logs(
    workspace_id, item_id, checked_out_by, action_type, performed_by, operation_id
  ) values (
    p_workspace_id, p_item_id, log_borrower, p_intent, p_profile_id, log_operation_id
  ) on conflict (workspace_id, item_id, action_type, operation_id) do nothing;

  if p_intent = 'quick_return' then
    insert into public.admin_audit_logs(
      workspace_id, actor_id, action_type, entity_type, entity_id, metadata
    ) values (
      p_workspace_id,
      p_profile_id,
      'quick_return',
      null,
      null,
      jsonb_build_object(
        'count', 1,
        'barcodes', jsonb_build_array(p_barcode),
        'source', 'offline_replay',
        'operation_id', p_operation_id,
        'item_id', p_item_id
      )
    ) on conflict do nothing;
  end if;

  return jsonb_build_object('status', 'synced');
end;
$$;

revoke all on function public.apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid)
  to service_role;
revoke all on function public.apply_offline_checkout_item_unchecked(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) from public, anon, authenticated, service_role;
revoke all on function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) from public, anon, authenticated;
grant execute on function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) to service_role;
