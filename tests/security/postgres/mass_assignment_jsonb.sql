\set ON_ERROR_STOP on
begin;
\ir ./security_fixture.sql

-- Direct browser CRUD is not the item creation path. Reserved columns must be
-- rejected even when the caller knows an authorized Tenant A item UUID.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"itx-security-session-a-admin","org_id":"itx-security-org-a"}',
  true
);

do $$
declare
  affected integer;
begin
  begin
    insert into public.items(
      id, workspace_id, name, status, barcode, created_at, deleted_at, access_mode
    ) values (
      '33000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'mass-assigned cross-tenant item',
      'available',
      'ITX-MASS-ASSIGN-DIRECT',
      '2000-01-01T00:00:00Z',
      now(),
      'all'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'direct reserved-column INSERT unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.items
    set id = '33000000-0000-4000-8000-000000000002',
        workspace_id = '10000000-0000-4000-8000-000000000002',
        created_at = '2000-01-01T00:00:00Z',
        deleted_at = now()
    where id = '30000000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'direct reserved-column UPDATE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.items
    where id = '30000000-0000-4000-8000-000000000001'
      and workspace_id = '10000000-0000-4000-8000-000000000001'
      and name = 'Tenant A Fixture Item'
      and deleted_at is null
  ) then raise exception 'failed direct mass assignment changed the fixture item'; end if;
  if exists (select 1 from public.items where barcode = 'ITX-MASS-ASSIGN-DIRECT') then
    raise exception 'failed direct mass assignment inserted a row';
  end if;
end
$$;

-- Exercise the actual server-owned import RPC under its required DB role. The
-- RPC must select only allowlisted scalar fields, bind workspace from its
-- trusted argument, and ignore system columns, billing context, distribution,
-- and nested JSONB supplied as extra keys.
set local role service_role;
do $$
declare
  result jsonb;
  row_id uuid;
  row_workspace uuid;
  row_name text;
  row_created_at timestamptz;
  row_deleted_at timestamptz;
  audit_metadata jsonb;
  before_audits integer;
  after_audits integer;
  payload jsonb;
  rejected boolean;
begin
  select count(*) into before_audits from public.admin_audit_logs
  where workspace_id = '10000000-0000-4000-8000-000000000001'
    and action_type = 'item_bulk_import';

  payload := jsonb_build_array(jsonb_build_object(
      'id', '33000000-0000-4000-8000-000000000099',
    'workspace_id', '10000000-0000-4000-8000-000000000002',
    'name', $attack$  Gadget'; DELETE FROM public.items; --  $attack$,
    'barcode', 'ITX-MASS-ASSIGN-RPC',
    'serial_number', 'SERIAL-''; UPDATE public.profiles SET role=''super_admin'';--',
    'status', 'available',
    'notes', '{"$where":"1=1","nested":{"sql":"''; DELETE FROM public.admin_audit_logs; --","__proto__":{"workspace_id":"10000000-0000-4000-8000-000000000002"}}}',
    'created_at', '2000-01-01T00:00:00Z',
    'deleted_at', '2000-01-01T00:00:00Z',
    'is_super_admin', true,
    'billing_status', 'active',
    'distribution', jsonb_build_object(
      'workspace_id', '10000000-0000-4000-8000-000000000002',
      'item_ids', jsonb_build_array('30000000-0000-4000-8000-000000000002'),
      'metadata', jsonb_build_object('$sql', 'DROP TABLE public.workspaces')
    ),
    'metadata', jsonb_build_object(
      'workspace_id', '10000000-0000-4000-8000-000000000002',
      'action_type', 'forged_chain_of_custody_export',
      'nested', jsonb_build_object('retention_days', 0)
    )
  ));

  result := public.import_items_with_audit(
    '10000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    payload,
    0
  );
  if jsonb_array_length(result) <> 1 then
    raise exception 'allowlisted item import did not create exactly one row';
  end if;

  select id, workspace_id, name, created_at, deleted_at
  into row_id, row_workspace, row_name, row_created_at, row_deleted_at
  from public.items where barcode = 'ITX-MASS-ASSIGN-RPC';
  if not found then raise exception 'server-owned import row was not created'; end if;
  -- The payload injects id 33000000-…-099; the server must generate its own.
  -- `is distinct from` keeps a NULL column from silently satisfying the check.
  if row_id = '33000000-0000-4000-8000-000000000099'::uuid
     or row_id = '30000000-0000-4000-8000-000000000002'::uuid
     or row_workspace is distinct from '10000000-0000-4000-8000-000000000001'::uuid
     or row_name is distinct from $attack$Gadget'; DELETE FROM public.items; --$attack$
     or row_created_at is null
     or row_created_at < now() - interval '1 minute'
     or row_deleted_at is not null then
    raise exception 'server import honored an attacker-controlled system field';
  end if;

  select metadata into audit_metadata from public.admin_audit_logs
  where workspace_id = '10000000-0000-4000-8000-000000000001'
    and actor_id = '11000000-0000-4000-8000-000000000001'
    and action_type = 'item_bulk_import'
  order by created_at desc limit 1;
  if audit_metadata is distinct from '{"source":"server_admin_ops","inserted":1,"skipped":0}'::jsonb then
    raise exception 'client-supplied metadata altered the server-owned audit event';
  end if;

  -- SQL-shaped field data remains inert text; malformed barcode and oversized
  -- notes are rejected atomically before item or audit rows are added.
  rejected := false;
  begin
    perform public.import_items_with_audit(
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'name', 'unsafe barcode attempt',
        'barcode', $attack$X'); DELETE FROM public.items; --$attack$,
        'status', 'available'
      )),
      0
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'SQLi barcode vector was not rejected'; end if;

  rejected := false;
  begin
    perform public.import_items_with_audit(
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'name', 'oversized note attempt',
        'barcode', 'ITX-OVERSIZED-NOTE',
        'status', 'available',
        'notes', repeat('x', 501)
      )),
      0
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'oversized item note was not rejected'; end if;

  rejected := false;
  begin
    select jsonb_agg(jsonb_build_object(
      'name', 'overflow ' || item_number,
      'barcode', 'ITX-OVERFLOW-' || item_number,
      'status', 'available'
    )) into payload
    from generate_series(1, 1001) as item_number;
    perform public.import_items_with_audit(
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      payload,
      0
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'oversized bulk payload was not rejected'; end if;

  select count(*) into after_audits from public.admin_audit_logs
  where workspace_id = '10000000-0000-4000-8000-000000000001'
    and action_type = 'item_bulk_import';
  if after_audits <> before_audits + 1 then
    raise exception 'rejected JSONB payloads partially mutated audit rows';
  end if;
  if exists (
    select 1 from public.items
    where barcode in (
        $attack$X'); DELETE FROM public.items; --$attack$,
        'ITX-OVERSIZED-NOTE'
      )
       or barcode like 'ITX-OVERFLOW-%'
  ) then raise exception 'rejected JSONB payload partially mutated items'; end if;
  if (select count(*) from public.workspaces where id in (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002'
  )) <> 2 then raise exception 'SQL-shaped text altered workspace data'; end if;
end
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.items
    where barcode = 'ITX-MASS-ASSIGN-RPC'
      and workspace_id = '10000000-0000-4000-8000-000000000001'
      and deleted_at is null
  ) then raise exception 'safe allowlisted import did not remain within Tenant A'; end if;
  if exists (
    select 1 from public.items
    where id = '33000000-0000-4000-8000-000000000099'
       or (barcode = 'ITX-MASS-ASSIGN-RPC'
           and id = '30000000-0000-4000-8000-000000000002')
  ) then raise exception 'reserved id field changed the new item id'; end if;
  if not exists (
    select 1 from public.items
    where id = '30000000-0000-4000-8000-000000000002'
      and name = 'Tenant B Secret Item'
      and workspace_id = '10000000-0000-4000-8000-000000000002'
  ) then raise exception 'JSONB mass assignment changed Tenant B data'; end if;
end
$$;

rollback;
