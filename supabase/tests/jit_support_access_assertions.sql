-- Synthetic records only. Every change is rolled back.
\set ON_ERROR_STOP on
begin;

insert into public.workspaces(id, name, slug, status)
values
  ('91a10200-0000-4000-8000-000000000001', 'JIT Test Workspace A', 'jit-test-ws-a', 'active'),
  ('91a10200-0000-4000-8000-000000000002', 'JIT Test Workspace B', 'jit-test-ws-b', 'active');

insert into public.profiles(id, workspace_id, role, auth_email, is_active)
values
  ('91a10200-0000-4000-8000-000000000010', null, 'super_admin', 'jit-super@example.test', true),
  ('91a10200-0000-4000-8000-000000000011', '91a10200-0000-4000-8000-000000000001', 'workspace_admin', 'jit-wsadmin@example.test', true);

do $$
declare
  readonly_ticket public.jit_support_tickets;
  bg_record record;
  revoked_ticket public.jit_support_tickets;
  audit_id uuid;
  jti_ro uuid := '91a10200-0000-4000-8000-000000000101';
  jti_bg uuid := '91a10200-0000-4000-8000-000000000102';
begin
  -- Standing super-admin PostgREST policies must be removed from tenant tables.
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'super_admin_all_borrowers',
        'super_admin_all_items',
        'super_admin_all_item_logs',
        'super_admin_all_item_status_history'
      )
  ) then
    raise exception 'standing super_admin_all_* policy still exists';
  end if;

  -- Service-only RPCs must not be executable by authenticated users.
  if has_function_privilege('authenticated', 'public.issue_jit_support_ticket(uuid,uuid,text,text,integer,uuid,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.invoke_break_glass_access(uuid,uuid,text,text,text,text,integer,uuid,text,text,text,text,jsonb,jsonb,text)', 'execute')
     or has_function_privilege('authenticated', 'public.verify_jit_support_ticket(uuid,uuid,uuid,uuid,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.revoke_jit_support_ticket(uuid,uuid,text,text,text,text,text)', 'execute') then
    raise exception 'JIT RPC exposed to authenticated role';
  end if;

  -- Non-super-admin cannot be issued a JIT ticket.
  begin
    perform public.issue_jit_support_ticket(
      '91a10200-0000-4000-8000-000000000011',
      '91a10200-0000-4000-8000-000000000001',
      'Unauthorized attempt',
      'SUP-100',
      15,
      gen_random_uuid()
    );
    raise exception 'non-super-admin issued JIT ticket';
  exception when insufficient_privilege then null;
  end;

  -- TTL > 60 minutes must be rejected.
  begin
    perform public.issue_jit_support_ticket(
      '91a10200-0000-4000-8000-000000000010',
      '91a10200-0000-4000-8000-000000000001',
      'Excessive TTL test',
      'SUP-101',
      61,
      gen_random_uuid()
    );
    raise exception 'TTL > 60m succeeded';
  exception when invalid_parameter_value then null;
  end;

  -- Issue valid read_only JIT ticket.
  readonly_ticket := public.issue_jit_support_ticket(
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000001',
    'Investigate borrower checkout sync issue',
    'SUP-202',
    15,
    jti_ro,
    'iphash-test',
    'test-agent',
    'req-001',
    'v1=sig001'
  );

  -- Valid at T-1s for matching workspace & read_only scope.
  if not public.verify_jit_support_ticket(
    readonly_ticket.id,
    jti_ro,
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000001',
    'read_only',
    readonly_ticket.expires_at - interval '1 second'
  ) then
    raise exception 'valid ticket rejected at T-1s';
  end if;

  -- Rejected at exact expiry (T) and T+1s.
  if public.verify_jit_support_ticket(
    readonly_ticket.id,
    jti_ro,
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000001',
    'read_only',
    readonly_ticket.expires_at
  ) then
    raise exception 'expired ticket accepted at T';
  end if;

  if public.verify_jit_support_ticket(
    readonly_ticket.id,
    jti_ro,
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000001',
    'read_only',
    readonly_ticket.expires_at + interval '1 second'
  ) then
    raise exception 'expired ticket accepted at T+1s';
  end if;

  -- Scope enforcement: read_only ticket cannot satisfy break_glass.
  if public.verify_jit_support_ticket(
    readonly_ticket.id,
    jti_ro,
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000001',
    'break_glass',
    readonly_ticket.expires_at - interval '1 second'
  ) then
    raise exception 'read_only ticket satisfied break_glass scope';
  end if;

  -- Cross-workspace isolation: ticket for Workspace A cannot access Workspace B.
  if public.verify_jit_support_ticket(
    readonly_ticket.id,
    jti_ro,
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000002',
    'read_only',
    readonly_ticket.expires_at - interval '1 second'
  ) then
    raise exception 'ticket verified for wrong workspace';
  end if;

  -- Instant revocation invalidates ticket before TTL.
  revoked_ticket := public.revoke_jit_support_ticket(
    readonly_ticket.id,
    '91a10200-0000-4000-8000-000000000010',
    'Support session complete'
  );
  if revoked_ticket.id is null or revoked_ticket.status <> 'revoked' then
    raise exception 'revocation did not mark ticket revoked';
  end if;
  if public.verify_jit_support_ticket(
    readonly_ticket.id,
    jti_ro,
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000001',
    'read_only',
    readonly_ticket.issued_at + interval '1 second'
  ) then
    raise exception 'revoked ticket remained valid';
  end if;

  -- Break-glass invocation works with optional incident_id omitted.
  select * into bg_record
  from public.invoke_break_glass_access(
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000001',
    'Emergency borrower repair requested by district admin',
    'Dennis Frenkel',
    null,
    'SUP-999',
    15,
    jti_bg,
    'iphash-test',
    'test-agent',
    'req-002',
    'v1=sig002',
    '["incident_io","resend_email"]'::jsonb,
    '["resend_email"]'::jsonb,
    'partial'
  );

  if bg_record.ticket_id is null or bg_record.break_glass_event_id is null then
    raise exception 'break-glass invocation failed';
  end if;

  if not public.verify_jit_support_ticket(
    bg_record.ticket_id,
    jti_bg,
    '91a10200-0000-4000-8000-000000000010',
    '91a10200-0000-4000-8000-000000000001',
    'break_glass',
    bg_record.expires_at - interval '1 second'
  ) then
    raise exception 'break-glass ticket not valid for break_glass scope';
  end if;

  -- Immutability check: UPDATE and DELETE on jit_audit_log must fail even as owner/service_role.
  select id into audit_id from public.jit_audit_log where ticket_id = bg_record.ticket_id limit 1;
  if audit_id is null then
    raise exception 'break-glass audit row missing';
  end if;

  begin
    update public.jit_audit_log set reason = 'tampered' where id = audit_id;
    raise exception 'UPDATE on immutable jit_audit_log succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.jit_audit_log where id = audit_id;
    raise exception 'DELETE on immutable jit_audit_log succeeded';
  exception when insufficient_privilege then null;
  end;

  -- Workspace deletion must succeed even while immutable jit_audit_log references its UUID.
  delete from public.workspaces where id = '91a10200-0000-4000-8000-000000000001';
  if not exists (select 1 from public.jit_audit_log where id = audit_id) then
    raise exception 'jit_audit_log row disappeared after workspace delete';
  end if;
end $$;

rollback;
