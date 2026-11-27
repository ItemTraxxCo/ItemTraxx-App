begin;

-- Ephemeral, workspace-scoped super-admin support and break-glass tickets.
create table if not exists public.jit_support_tickets (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope text not null check (scope in ('read_only', 'break_glass')),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  external_ticket_id text check (
    external_ticket_id is null
    or char_length(btrim(external_ticket_id)) between 1 and 128
  ),
  ttl_minutes integer not null check (ttl_minutes between 1 and 60),
  token_jti uuid not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) <= 500),
  expired_notified_at timestamptz,
  client_ip_hash text check (client_ip_hash is null or char_length(client_ip_hash) <= 128),
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  constraint jit_support_tickets_ttl_bounds check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '60 minutes'
  ),
  constraint jit_support_tickets_readonly_ticket_id check (
    scope = 'break_glass'
    or (external_ticket_id is not null and char_length(btrim(external_ticket_id)) >= 1)
  )
);

create index if not exists idx_jit_support_tickets_lookup
  on public.jit_support_tickets (admin_user_id, workspace_id, status, expires_at desc);
create index if not exists idx_jit_support_tickets_active_expires
  on public.jit_support_tickets (expires_at)
  where status = 'active';
create index if not exists idx_jit_support_tickets_workspace_created
  on public.jit_support_tickets (workspace_id, created_at desc);

alter table public.jit_support_tickets enable row level security;
revoke all on public.jit_support_tickets from public, anon, authenticated;
grant select, insert, update on public.jit_support_tickets to service_role;
grant select on public.jit_support_tickets to authenticated;

drop policy if exists super_admin_select_jit_tickets on public.jit_support_tickets;
create policy super_admin_select_jit_tickets
  on public.jit_support_tickets
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'super_admin'
    and (select public.has_recent_privileged_step_up('super_admin'))
    and (select private.super_admin_session_not_revoked())
  );

-- High-friction emergency break-glass invocations bound to a break_glass ticket.
create table if not exists public.break_glass_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.jit_support_tickets(id) on delete cascade,
  admin_user_id uuid not null references public.profiles(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  incident_id text check (
    incident_id is null
    or char_length(btrim(incident_id)) between 1 and 128
  ),
  justification text not null check (char_length(btrim(justification)) between 10 and 2000),
  acknowledged_by text not null check (char_length(btrim(acknowledged_by)) between 2 and 256),
  alert_channels_attempted jsonb not null default '[]'::jsonb,
  alert_channels_delivered jsonb not null default '[]'::jsonb,
  alert_delivery_status text not null default 'pending' check (
    alert_delivery_status in ('pending', 'delivered', 'partial', 'failed')
  ),
  alert_dispatched_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_break_glass_events_workspace_created
  on public.break_glass_events (workspace_id, created_at desc);
create index if not exists idx_break_glass_events_admin_created
  on public.break_glass_events (admin_user_id, created_at desc);

alter table public.break_glass_events enable row level security;
revoke all on public.break_glass_events from public, anon, authenticated;
grant select, insert, update on public.break_glass_events to service_role;
grant select on public.break_glass_events to authenticated;

drop policy if exists super_admin_select_break_glass_events on public.break_glass_events;
create policy super_admin_select_break_glass_events
  on public.break_glass_events
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'super_admin'
    and (select public.has_recent_privileged_step_up('super_admin'))
    and (select private.super_admin_session_not_revoked())
  );

-- Immutable, append-only security audit ledger for JIT and break-glass events.
-- Intentionally omits foreign keys to public.workspaces and public.profiles so
-- workspace purge and user deletion remain compatible without mutating ledger rows,
-- and stores zero borrower PII.
create table if not exists public.jit_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in (
      'jit.ticket.requested',
      'jit.ticket.granted',
      'jit.ticket.used',
      'jit.ticket.revoked',
      'jit.ticket.expired',
      'jit.break_glass.invoked',
      'jit.break_glass.alert_failed',
      'jit.access.denied'
    )
  ),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null,
  actor_email text check (actor_email is null or char_length(actor_email) <= 320),
  target_workspace_id uuid,
  ticket_id uuid,
  scope text check (scope is null or scope in ('read_only', 'break_glass')),
  action text not null check (char_length(btrim(action)) between 1 and 128),
  reason text check (reason is null or char_length(reason) <= 2000),
  incident_id text check (incident_id is null or char_length(incident_id) <= 128),
  acknowledged_by text check (acknowledged_by is null or char_length(acknowledged_by) <= 256),
  client_ip_hash text check (client_ip_hash is null or char_length(client_ip_hash) <= 128),
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  request_id text check (request_id is null or char_length(request_id) <= 128),
  metadata jsonb not null default '{}'::jsonb,
  event_signature text not null default '' check (char_length(event_signature) <= 256)
);

create index if not exists idx_jit_audit_log_occurred
  on public.jit_audit_log (occurred_at desc);
create index if not exists idx_jit_audit_log_workspace_occurred
  on public.jit_audit_log (target_workspace_id, occurred_at desc);
create index if not exists idx_jit_audit_log_actor_occurred
  on public.jit_audit_log (actor_id, occurred_at desc);
create index if not exists idx_jit_audit_log_ticket_occurred
  on public.jit_audit_log (ticket_id, occurred_at desc);

alter table public.jit_audit_log enable row level security;
revoke all on public.jit_audit_log from public, anon, authenticated, service_role;
grant select, insert on public.jit_audit_log to service_role;
grant select on public.jit_audit_log to authenticated;

drop policy if exists super_admin_select_jit_audit_log on public.jit_audit_log;
create policy super_admin_select_jit_audit_log
  on public.jit_audit_log
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'super_admin'
    and (select public.has_recent_privileged_step_up('super_admin'))
    and (select private.super_admin_session_not_revoked())
  );

create or replace function private.prevent_jit_audit_log_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'public.jit_audit_log is immutable and append-only' using errcode = '42501';
end;
$$;

revoke all on function private.prevent_jit_audit_log_mutation() from public, anon, authenticated;

drop trigger if exists trg_jit_audit_log_no_update_delete on public.jit_audit_log;
create trigger trg_jit_audit_log_no_update_delete
  before update or delete on public.jit_audit_log
  for each row
  execute function private.prevent_jit_audit_log_mutation();

drop trigger if exists trg_jit_audit_log_no_truncate on public.jit_audit_log;
create trigger trg_jit_audit_log_no_truncate
  before truncate on public.jit_audit_log
  for each statement
  execute function private.prevent_jit_audit_log_mutation();

-- Remove standing direct PostgREST super-admin policies on tenant operational tables.
drop policy if exists super_admin_all_borrowers on public.borrowers;
drop policy if exists super_admin_all_items on public.items;
drop policy if exists super_admin_all_item_logs on public.item_logs;
drop policy if exists super_admin_all_item_status_history on public.item_status_history;

-- Service-only append helper for JIT audit rows.
create or replace function public.append_jit_audit_log(
  p_event_type text,
  p_actor_id uuid,
  p_actor_email text default null,
  p_target_workspace_id uuid default null,
  p_ticket_id uuid default null,
  p_scope text default null,
  p_action text default 'jit_event',
  p_reason text default null,
  p_incident_id text default null,
  p_acknowledged_by text default null,
  p_client_ip_hash text default null,
  p_user_agent text default null,
  p_request_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_event_signature text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_id uuid;
begin
  if p_actor_id is null or coalesce(btrim(p_event_type), '') = '' or coalesce(btrim(p_action), '') = '' then
    raise exception 'Invalid JIT audit payload' using errcode = '22023';
  end if;

  insert into public.jit_audit_log (
    event_type,
    actor_id,
    actor_email,
    target_workspace_id,
    ticket_id,
    scope,
    action,
    reason,
    incident_id,
    acknowledged_by,
    client_ip_hash,
    user_agent,
    request_id,
    metadata,
    event_signature
  ) values (
    p_event_type,
    p_actor_id,
    p_actor_email,
    p_target_workspace_id,
    p_ticket_id,
    p_scope,
    btrim(p_action),
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_incident_id, '')), ''),
    nullif(btrim(coalesce(p_acknowledged_by, '')), ''),
    nullif(btrim(coalesce(p_client_ip_hash, '')), ''),
    nullif(btrim(coalesce(p_user_agent, '')), ''),
    nullif(btrim(coalesce(p_request_id, '')), ''),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_event_signature, '')
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

revoke all on function public.append_jit_audit_log(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.append_jit_audit_log(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text)
  to service_role;

-- Issue a read-only JIT delegated support ticket bound to a single workspace.
create or replace function public.issue_jit_support_ticket(
  p_admin_user_id uuid,
  p_workspace_id uuid,
  p_reason text,
  p_external_ticket_id text,
  p_ttl_minutes integer default 15,
  p_token_jti uuid default gen_random_uuid(),
  p_client_ip_hash text default null,
  p_user_agent text default null,
  p_request_id text default null,
  p_event_signature text default ''
)
returns public.jit_support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text;
  now_ts timestamptz := now();
  created_ticket public.jit_support_tickets;
begin
  if p_admin_user_id is null
     or p_workspace_id is null
     or p_token_jti is null
     or coalesce(p_ttl_minutes, 0) < 1
     or p_ttl_minutes > 60
     or char_length(btrim(coalesce(p_reason, ''))) < 3
     or char_length(btrim(coalesce(p_external_ticket_id, ''))) < 1 then
    raise exception 'Invalid JIT support ticket request' using errcode = '22023';
  end if;

  select p.auth_email
  into actor_email
  from public.profiles as p
  where p.id = p_admin_user_id
    and p.role = 'super_admin'
    and p.is_active is true
    and p.deleted_at is null
  for share;
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.workspaces as w
    where w.id = p_workspace_id
      and w.archived_at is null
  ) then
    raise exception 'Workspace unavailable' using errcode = '22023';
  end if;

  insert into public.jit_support_tickets (
    admin_user_id,
    workspace_id,
    scope,
    status,
    reason,
    external_ticket_id,
    ttl_minutes,
    token_jti,
    issued_at,
    expires_at,
    client_ip_hash,
    user_agent
  ) values (
    p_admin_user_id,
    p_workspace_id,
    'read_only',
    'active',
    btrim(p_reason),
    btrim(p_external_ticket_id),
    p_ttl_minutes,
    p_token_jti,
    now_ts,
    now_ts + pg_catalog.make_interval(mins => p_ttl_minutes),
    nullif(btrim(coalesce(p_client_ip_hash, '')), ''),
    nullif(btrim(coalesce(p_user_agent, '')), '')
  )
  returning * into created_ticket;

  perform public.append_jit_audit_log(
    'jit.ticket.granted',
    p_admin_user_id,
    actor_email,
    p_workspace_id,
    created_ticket.id,
    'read_only',
    'request_jit_ticket',
    created_ticket.reason,
    null,
    null,
    p_client_ip_hash,
    p_user_agent,
    p_request_id,
    jsonb_build_object(
      'external_ticket_id', created_ticket.external_ticket_id,
      'ttl_minutes', created_ticket.ttl_minutes,
      'expires_at', created_ticket.expires_at
    ),
    p_event_signature
  );

  return created_ticket;
end;
$$;

revoke all on function public.issue_jit_support_ticket(uuid,uuid,text,text,integer,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.issue_jit_support_ticket(uuid,uuid,text,text,integer,uuid,text,text,text,text)
  to service_role;

-- Invoke emergency break-glass access atomically with ticket, event, and audit row.
create or replace function public.invoke_break_glass_access(
  p_admin_user_id uuid,
  p_workspace_id uuid,
  p_justification text,
  p_acknowledged_by text,
  p_incident_id text default null,
  p_external_ticket_id text default null,
  p_ttl_minutes integer default 15,
  p_token_jti uuid default gen_random_uuid(),
  p_client_ip_hash text default null,
  p_user_agent text default null,
  p_request_id text default null,
  p_event_signature text default '',
  p_alert_channels_attempted jsonb default '[]'::jsonb,
  p_alert_channels_delivered jsonb default '[]'::jsonb,
  p_alert_delivery_status text default 'delivered'
)
returns table (
  ticket_id uuid,
  break_glass_event_id uuid,
  token_jti uuid,
  issued_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text;
  now_ts timestamptz := now();
  created_ticket public.jit_support_tickets;
  created_event_id uuid;
  clean_incident text := nullif(btrim(coalesce(p_incident_id, '')), '');
  clean_external_ticket text := nullif(btrim(coalesce(p_external_ticket_id, '')), '');
begin
  if p_admin_user_id is null
     or p_workspace_id is null
     or p_token_jti is null
     or coalesce(p_ttl_minutes, 0) < 1
     or p_ttl_minutes > 60
     or char_length(btrim(coalesce(p_justification, ''))) < 10
     or char_length(btrim(coalesce(p_acknowledged_by, ''))) < 2 then
    raise exception 'Invalid break-glass request' using errcode = '22023';
  end if;

  select p.auth_email
  into actor_email
  from public.profiles as p
  where p.id = p_admin_user_id
    and p.role = 'super_admin'
    and p.is_active is true
    and p.deleted_at is null
  for share;
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.workspaces as w
    where w.id = p_workspace_id
      and w.archived_at is null
  ) then
    raise exception 'Workspace unavailable' using errcode = '22023';
  end if;

  insert into public.jit_support_tickets (
    admin_user_id,
    workspace_id,
    scope,
    status,
    reason,
    external_ticket_id,
    ttl_minutes,
    token_jti,
    issued_at,
    expires_at,
    client_ip_hash,
    user_agent
  ) values (
    p_admin_user_id,
    p_workspace_id,
    'break_glass',
    'active',
    btrim(p_justification),
    coalesce(clean_external_ticket, clean_incident),
    p_ttl_minutes,
    p_token_jti,
    now_ts,
    now_ts + pg_catalog.make_interval(mins => p_ttl_minutes),
    nullif(btrim(coalesce(p_client_ip_hash, '')), ''),
    nullif(btrim(coalesce(p_user_agent, '')), '')
  )
  returning * into created_ticket;

  insert into public.break_glass_events (
    ticket_id,
    admin_user_id,
    workspace_id,
    incident_id,
    justification,
    acknowledged_by,
    alert_channels_attempted,
    alert_channels_delivered,
    alert_delivery_status,
    alert_dispatched_at
  ) values (
    created_ticket.id,
    p_admin_user_id,
    p_workspace_id,
    clean_incident,
    btrim(p_justification),
    btrim(p_acknowledged_by),
    coalesce(p_alert_channels_attempted, '[]'::jsonb),
    coalesce(p_alert_channels_delivered, '[]'::jsonb),
    coalesce(p_alert_delivery_status, 'delivered'),
    now_ts
  )
  returning id into created_event_id;

  perform public.append_jit_audit_log(
    'jit.break_glass.invoked',
    p_admin_user_id,
    actor_email,
    p_workspace_id,
    created_ticket.id,
    'break_glass',
    'invoke_break_glass',
    btrim(p_justification),
    clean_incident,
    btrim(p_acknowledged_by),
    p_client_ip_hash,
    p_user_agent,
    p_request_id,
    jsonb_build_object(
      'break_glass_event_id', created_event_id,
      'external_ticket_id', created_ticket.external_ticket_id,
      'ttl_minutes', created_ticket.ttl_minutes,
      'expires_at', created_ticket.expires_at,
      'alert_delivery_status', coalesce(p_alert_delivery_status, 'delivered'),
      'alert_channels_delivered', coalesce(p_alert_channels_delivered, '[]'::jsonb)
    ),
    p_event_signature
  );

  return query
    select created_ticket.id, created_event_id, created_ticket.token_jti, created_ticket.issued_at, created_ticket.expires_at;
end;
$$;

revoke all on function public.invoke_break_glass_access(uuid,uuid,text,text,text,text,integer,uuid,text,text,text,text,jsonb,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.invoke_break_glass_access(uuid,uuid,text,text,text,text,integer,uuid,text,text,text,text,jsonb,jsonb,text)
  to service_role;

-- Strictly verify an active, non-revoked, non-expired JIT ticket for actor, workspace, and scope.
create or replace function public.verify_jit_support_ticket(
  p_ticket_id uuid,
  p_token_jti uuid,
  p_admin_user_id uuid,
  p_workspace_id uuid,
  p_required_scope text default 'read_only',
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_ticket_id is not null
    and p_token_jti is not null
    and p_admin_user_id is not null
    and p_workspace_id is not null
    and p_required_scope in ('read_only', 'break_glass')
    and exists (
      select 1
      from public.jit_support_tickets as t
      join public.profiles as p
        on p.id = t.admin_user_id
      where t.id = p_ticket_id
        and t.token_jti = p_token_jti
        and t.admin_user_id = p_admin_user_id
        and t.workspace_id = p_workspace_id
        and t.status = 'active'
        and t.revoked_at is null
        and coalesce(p_at, now()) < t.expires_at
        and (p_required_scope = 'read_only' or t.scope = 'break_glass')
        and p.role = 'super_admin'
        and p.is_active is true
        and p.deleted_at is null
    );
$$;

revoke all on function public.verify_jit_support_ticket(uuid,uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.verify_jit_support_ticket(uuid,uuid,uuid,uuid,text,timestamptz)
  to service_role;

-- Instant pre-expiry ticket revocation with atomic immutable audit entry.
create or replace function public.revoke_jit_support_ticket(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_revoke_reason text default null,
  p_client_ip_hash text default null,
  p_user_agent text default null,
  p_request_id text default null,
  p_event_signature text default ''
)
returns public.jit_support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text;
  revoked_ticket public.jit_support_tickets;
  clean_reason text := nullif(btrim(coalesce(p_revoke_reason, '')), '');
begin
  if p_ticket_id is null or p_actor_id is null then
    raise exception 'Invalid revocation request' using errcode = '22023';
  end if;

  select p.auth_email
  into actor_email
  from public.profiles as p
  where p.id = p_actor_id
    and p.role = 'super_admin'
    and p.is_active is true
    and p.deleted_at is null
  for share;
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  update public.jit_support_tickets as t
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by = p_actor_id,
    revoke_reason = clean_reason
  where t.id = p_ticket_id
    and t.status = 'active'
    and t.revoked_at is null
  returning * into revoked_ticket;

  if not found then
    return null;
  end if;

  perform public.append_jit_audit_log(
    'jit.ticket.revoked',
    p_actor_id,
    actor_email,
    revoked_ticket.workspace_id,
    revoked_ticket.id,
    revoked_ticket.scope,
    'revoke_jit_ticket',
    coalesce(clean_reason, revoked_ticket.reason),
    null,
    null,
    p_client_ip_hash,
    p_user_agent,
    p_request_id,
    jsonb_build_object(
      'revoked_at', revoked_ticket.revoked_at,
      'original_expires_at', revoked_ticket.expires_at,
      'external_ticket_id', revoked_ticket.external_ticket_id
    ),
    p_event_signature
  );

  return revoked_ticket;
end;
$$;

revoke all on function public.revoke_jit_support_ticket(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.revoke_jit_support_ticket(uuid,uuid,text,text,text,text,text)
  to service_role;

-- Transition expired active tickets and write immutable expiry audit rows.
create or replace function public.expire_stale_jit_tickets(
  p_limit integer default 100
)
returns setof public.jit_support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  clamped_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  expired_row public.jit_support_tickets;
  actor_email text;
begin
  for expired_row in
    with due as (
      select id
      from public.jit_support_tickets
      where status = 'active'
        and revoked_at is null
        and expires_at <= now()
      order by expires_at asc
      limit clamped_limit
      for update skip locked
    )
    update public.jit_support_tickets as t
    set
      status = 'expired',
      expired_notified_at = now()
    from due
    where t.id = due.id
    returning t.*
  loop
    select p.auth_email into actor_email
    from public.profiles as p
    where p.id = expired_row.admin_user_id;

    perform public.append_jit_audit_log(
      'jit.ticket.expired',
      expired_row.admin_user_id,
      actor_email,
      expired_row.workspace_id,
      expired_row.id,
      expired_row.scope,
      'expire_jit_ticket',
      expired_row.reason,
      null,
      null,
      expired_row.client_ip_hash,
      expired_row.user_agent,
      null,
      jsonb_build_object(
        'expired_at', expired_row.expires_at,
        'external_ticket_id', expired_row.external_ticket_id
      ),
      ''
    );

    return next expired_row;
  end loop;
  return;
end;
$$;

revoke all on function public.expire_stale_jit_tickets(integer)
  from public, anon, authenticated;
grant execute on function public.expire_stale_jit_tickets(integer)
  to service_role;

-- Transactional JIT-verified wrappers for super-admin encrypted borrower mutations.
-- Preserves existing P-ITX-10 RPCs untouched while enforcing break_glass in Postgres.
create or replace function public.super_create_encrypted_borrower_with_jit(
  p_ticket_id uuid,
  p_token_jti uuid,
  p_id uuid,
  p_workspace_id uuid,
  p_actor_id uuid,
  p_encrypted_data text,
  p_nonce text,
  p_auth_tag text,
  p_borrower_id_hash text,
  p_borrower_email_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.verify_jit_support_ticket(
    p_ticket_id,
    p_token_jti,
    p_actor_id,
    p_workspace_id,
    'break_glass',
    now()
  ) then
    raise exception 'Valid break-glass JIT ticket required' using errcode = '42501';
  end if;

  return public.super_create_encrypted_borrower(
    p_id,
    p_workspace_id,
    p_actor_id,
    p_encrypted_data,
    p_nonce,
    p_auth_tag,
    p_borrower_id_hash,
    p_borrower_email_hash
  );
end;
$$;

revoke all on function public.super_create_encrypted_borrower_with_jit(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.super_create_encrypted_borrower_with_jit(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)
  to service_role;

create or replace function public.super_delete_encrypted_borrower_with_jit(
  p_ticket_id uuid,
  p_token_jti uuid,
  p_id uuid,
  p_workspace_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.verify_jit_support_ticket(
    p_ticket_id,
    p_token_jti,
    p_actor_id,
    p_workspace_id,
    'break_glass',
    now()
  ) then
    raise exception 'Valid break-glass JIT ticket required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.borrowers as b
    where b.id = p_id
      and b.workspace_id = p_workspace_id
  ) then
    return false;
  end if;

  return public.super_delete_encrypted_borrower(p_id, p_actor_id);
end;
$$;

revoke all on function public.super_delete_encrypted_borrower_with_jit(uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.super_delete_encrypted_borrower_with_jit(uuid,uuid,uuid,uuid,uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
