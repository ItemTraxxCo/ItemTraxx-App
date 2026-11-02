begin;

create table if not exists public.security_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  target_type text not null check (target_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  target_resource_id uuid not null,
  route text not null check (length(route) <= 256),
  method text not null check (method in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE')),
  request_id text not null check (length(request_id) between 1 and 128)
);

create index if not exists security_audit_logs_workspace_time_idx
  on public.security_audit_logs (workspace_id, created_at desc);
create index if not exists security_audit_logs_actor_time_idx
  on public.security_audit_logs (actor_id, created_at desc);
create index if not exists security_audit_logs_target_time_idx
  on public.security_audit_logs (target_type, target_resource_id, created_at desc);

alter table public.security_audit_logs enable row level security;
revoke all on public.security_audit_logs from public, anon, authenticated;
grant insert, select on public.security_audit_logs to service_role;

create or replace function public.append_security_audit_entries(p_entries jsonb)
returns table (
  enumeration_tripwire boolean,
  distinct_target_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_actor_id uuid;
  resolved_workspace_id uuid;
  recent_target_count bigint;
begin
  if current_setting('role', true) is distinct from 'service_role'
     or p_entries is null
     or jsonb_typeof(p_entries) <> 'array'
     or jsonb_array_length(p_entries) < 1
     or jsonb_array_length(p_entries) > 250 then
    raise exception 'Unauthorized or invalid security audit batch' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_entries) as entry(
      actor_id uuid,
      workspace_id uuid,
      action text,
      target_type text,
      target_resource_id uuid,
      route text,
      method text,
      request_id text
    )
    where entry.actor_id is null
       or entry.workspace_id is null
       or entry.action is null
       or entry.target_type is null
       or entry.target_resource_id is null
       or entry.route is null
       or entry.method is null
       or entry.request_id is null
  ) then
    raise exception 'Invalid security audit entry' using errcode = '22023';
  end if;

  if (select count(distinct entry.actor_id)
      from jsonb_to_recordset(p_entries) as entry(actor_id uuid)) <> 1
     or (select count(distinct entry.workspace_id)
         from jsonb_to_recordset(p_entries) as entry(workspace_id uuid)) <> 1 then
    raise exception 'Audit batch must have one actor and workspace' using errcode = '22023';
  end if;

  select entry.actor_id, entry.workspace_id
  into resolved_actor_id, resolved_workspace_id
  from jsonb_to_recordset(p_entries) as entry(
    actor_id uuid,
    workspace_id uuid
  )
  limit 1;

  -- Serialize per-actor audit batches so parallel target reads cannot each
  -- miss the others while checking the 60-second enumeration window.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(resolved_actor_id::text)
  );

  insert into public.security_audit_logs (
    actor_id,
    workspace_id,
    action,
    target_type,
    target_resource_id,
    route,
    method,
    request_id
  )
  select
    entry.actor_id,
    entry.workspace_id,
    entry.action,
    entry.target_type,
    entry.target_resource_id,
    entry.route,
    entry.method,
    entry.request_id
  from jsonb_to_recordset(p_entries) as entry(
    actor_id uuid,
    workspace_id uuid,
    action text,
    target_type text,
    target_resource_id uuid,
    route text,
    method text,
    request_id text
  );

  select count(distinct entry.target_type || ':' || entry.target_resource_id::text)
  into recent_target_count
  from public.security_audit_logs as entry
  where entry.actor_id = resolved_actor_id
    and entry.workspace_id = resolved_workspace_id
    and entry.action in ('read_target', 'denied_read_target')
    and entry.created_at >= now() - interval '60 seconds';

  return query select recent_target_count > 15, recent_target_count;
end;
$$;

revoke all on function public.append_security_audit_entries(jsonb)
  from public, anon, authenticated;
grant execute on function public.append_security_audit_entries(jsonb)
  to service_role;

commit;
