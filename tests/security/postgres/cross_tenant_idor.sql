\set ON_ERROR_STOP on
begin;
\ir ./security_fixture.sql

-- Tenant A admin: raw UUID probes must hide Tenant B rows and every direct
-- mutation must either hit zero rows or fail with PostgreSQL privilege SQLSTATE 42501.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"itx-security-session-a-admin","org_id":"itx-security-org-a"}', true);

do $$
declare
  affected integer;
  visible integer;
begin
  -- NULL-safe: a broken session lookup returning NULL would otherwise pass
  -- this guard and make every later visibility probe vacuously succeed.
  if (select public.current_workspace_id()) is distinct from '10000000-0000-4000-8000-000000000001'::uuid
     or (select public.current_user_role()) is distinct from 'workspace_admin' then
    raise exception 'fixture admin context is invalid';
  end if;

  select count(*) into visible from public.items
  where id in (
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000099'
  );
  if visible <> 0 then raise exception 'Tenant B item or existence leaked by raw UUID'; end if;

  select count(*) into visible from public.borrowers
  where id = '40000000-0000-4000-8000-000000000002'
     or borrower_id = 'ITX-B-BORROWER-SECRET';
  if visible <> 0 then raise exception 'Tenant B borrower record leaked by raw UUID'; end if;

  select count(*) into visible from public.item_logs
  where id = '50000000-0000-4000-8000-000000000002'
     or item_id = '30000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'Tenant B item log leaked by raw UUID'; end if;

  select count(*) into visible from public.item_status_history
  where id = '55000000-0000-4000-8000-000000000001'
     or item_id = '30000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'Tenant B item status history leaked by raw UUID'; end if;

  begin
    insert into public.item_status_history(workspace_id, item_id, status, note, changed_by)
    values (
      '10000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002',
      'lost',
      'forged Tenant B status change',
      '11000000-0000-4000-8000-000000000001'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant status history INSERT unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.item_status_history set note = 'tampered'
    where id = '55000000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant status history UPDATE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.item_status_history
    where id = '55000000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant status history DELETE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into visible from public.admin_audit_logs
  where id = '60000000-0000-4000-8000-000000000002'
     or entity_id = '30000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'Tenant B audit row leaked by raw UUID'; end if;

  -- Items are the current physical inventory relation. Location-like session
  -- fields are stored on account_sessions; there is no standalone locations table.
  select count(*) into visible from public.account_sessions
  where id = '70000000-0000-4000-8000-000000000003'
     or workspace_id = '10000000-0000-4000-8000-000000000002'
     or general_location = 'B-SECRET-LOCATION-RECORD';
  if visible <> 0 then raise exception 'Tenant B session/location data leaked'; end if;

  begin
    insert into public.account_sessions(
      workspace_id, profile_id, device_id, general_location, auth_session_id
    ) values (
      '10000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000003',
      'itx-admin-forged-location',
      'FORGED-TENANT-B-LOCATION',
      'itx-security-session-b-admin'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A admin inserted a Tenant B location/session record'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.account_sessions set general_location = 'tampered by Tenant A'
    where id = '70000000-0000-4000-8000-000000000003';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A admin updated Tenant B location/session data'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.account_sessions
    where id = '70000000-0000-4000-8000-000000000003';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A admin deleted Tenant B location/session data'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.items(workspace_id, name, status, barcode, access_mode)
    values ('10000000-0000-4000-8000-000000000002', 'forged cross-tenant item', 'available', 'ITX-FORGED-B-ITEM', 'all');
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant item INSERT unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.items set name = 'tampered by tenant A'
    where id = '30000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant item UPDATE unexpectedly affected a row'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.items where id = '30000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant item DELETE unexpectedly affected a row'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.borrowers(workspace_id, username, borrower_id, access_mode)
    values (
      '10000000-0000-4000-8000-000000000002',
      'forged cross-tenant borrower',
      'ITX-FORGED-B-BORROWER',
      'all'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant borrower INSERT unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.borrowers set username = 'tampered by Tenant A'
    where id = '40000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant borrower UPDATE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.borrowers
    where id = '40000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant borrower DELETE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.item_logs(workspace_id, item_id, checked_out_by, action_type, performed_by)
    values (
      '10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      'forged_cross_tenant_checkout',
      '11000000-0000-4000-8000-000000000001'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant item log INSERT unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.item_logs set action_type = 'tampered'
    where id = '50000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant item log UPDATE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.item_logs where id = '50000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant item log DELETE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.admin_audit_logs(
      workspace_id, actor_id, action_type, entity_type, entity_id, metadata
    ) values (
      '10000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000001',
      'forged_audit_event',
      'item',
      '30000000-0000-4000-8000-000000000002',
      jsonb_build_object(
        'sql', $attack$'); DELETE FROM public.items; --$attack$,
        'nested', jsonb_build_object('workspace_id', '10000000-0000-4000-8000-000000000002')
      )
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant audit INSERT unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.admin_audit_logs set metadata = '{"tampered":true}'
    where id = '60000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant audit UPDATE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.admin_audit_logs where id = '60000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'cross-tenant audit DELETE unexpectedly succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  -- A mixed batch may return only Tenant A rows. Direct writes are denied
  -- outright: grants are revoked (asserted by name at the end of this file),
  -- and the RLS layer is exercised separately with a temporary grant.
  select count(*) into visible from public.items
  where id in (
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002'
  );
  if visible <> 1 then raise exception 'mixed-tenant item SELECT did not return exactly Tenant A data'; end if;

  begin
    update public.items set name = 'Tenant A mixed-batch update'
    where id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'mixed-tenant item UPDATE touched % row(s); admins have no direct item write path', affected; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.items
    where id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'mixed-tenant item DELETE touched % row(s); admins have no direct item write path', affected; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.items(workspace_id, name, status, barcode, access_mode)
    values
      ('10000000-0000-4000-8000-000000000001', 'mixed payload Tenant A', 'available', 'ITX-BATCH-A', 'all'),
      ('10000000-0000-4000-8000-000000000002', 'mixed payload Tenant B', 'available', 'ITX-BATCH-B', 'all');
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'mixed-tenant item INSERT wrote % row(s); admins have no direct item write path', affected; end if;
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
    where id = '30000000-0000-4000-8000-000000000002'
      and name = 'Tenant B Secret Item'
      and workspace_id = '10000000-0000-4000-8000-000000000002'
  ) then raise exception 'failed Tenant A attack changed Tenant B item data'; end if;
  if not exists (
    select 1 from public.item_logs
    where id = '50000000-0000-4000-8000-000000000002'
      and action_type = 'checkout'
  ) then raise exception 'failed Tenant A attack changed Tenant B item logs'; end if;
  if not exists (
    select 1 from public.admin_audit_logs
    where id = '60000000-0000-4000-8000-000000000002'
      and metadata ->> 'marker' = 'tenant-b-secret'
  ) then raise exception 'failed Tenant A attack changed Tenant B audit data'; end if;
  if exists (select 1 from public.items where barcode in ('ITX-FORGED-B-ITEM', 'ITX-BATCH-B')) then
    raise exception 'rejected cross-tenant or mixed-batch insert mutated items';
  end if;
end
$$;

-- Tenant A standard member: forged tenant/role claims never change the
-- profile-derived workspace or role, and raw Tenant B UUIDs still reveal zero rows.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"service_role","session_id":"itx-security-session-a-member","org_id":"itx-security-org-b","workspace_id":"10000000-0000-4000-8000-000000000002","tenant_id":"10000000-0000-4000-8000-000000000002","app_metadata":{"role":"super_admin","workspace_id":"10000000-0000-4000-8000-000000000002"}}',
  true
);

do $$
declare
  affected integer;
  visible integer;
begin
  if auth.uid() is distinct from '11000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'authenticated subject changed unexpectedly';
  end if;
  if public.current_workspace_id() is distinct from '10000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'forged workspace/org claim overrode profile workspace';
  end if;
  if public.current_user_role() is distinct from 'tenant_account' then
    raise exception 'forged service/super admin role claim overrode profile role';
  end if;

  -- Positive control: the member can see its own workspace item, so the
  -- zero-row probes below measure tenant isolation rather than a dead session.
  select count(*) into visible from public.items
  where id = '30000000-0000-4000-8000-000000000001';
  if visible <> 1 then raise exception 'member positive control: own Tenant A item not visible'; end if;

  select count(*) into visible from public.items
  where id = '30000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'Tenant B item leaked to forged Tenant A member'; end if;
  select count(*) into visible from public.borrowers
  where id = '40000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'Tenant B borrower leaked to forged Tenant A member'; end if;
  select count(*) into visible from public.item_logs
  where id = '50000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'Tenant B item log leaked to forged Tenant A member'; end if;
  select count(*) into visible from public.admin_audit_logs
  where id = '60000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'Tenant B audit row leaked to forged Tenant A member'; end if;
  select count(*) into visible from public.account_sessions
  where id = '70000000-0000-4000-8000-000000000003'
     or general_location = 'B-SECRET-LOCATION-RECORD';
  if visible <> 0 then raise exception 'Tenant B location-like session metadata leaked'; end if;

  select count(*) into visible from public.item_status_history
  where id = '55000000-0000-4000-8000-000000000001'
     or item_id = '30000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'Tenant B item status history leaked to member'; end if;

  begin
    update public.items set name = 'member tamper'
    where id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member unexpectedly updated workspace items'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.items
    where id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member unexpectedly deleted workspace items'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.borrowers(workspace_id, username, borrower_id, access_mode)
    values (
      '10000000-0000-4000-8000-000000000002',
      'member forged cross-tenant borrower',
      'ITX-MEMBER-FORGED-B-BORROWER',
      'all'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member inserted a Tenant B borrower'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.borrowers set username = 'member tamper'
    where id = '40000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member updated Tenant B borrower data'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.borrowers
    where id = '40000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member deleted Tenant B borrower data'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.items(workspace_id, name, status, barcode, access_mode)
    values ('10000000-0000-4000-8000-000000000002', 'member forged inventory item', 'available', 'ITX-MEMBER-FORGED-B', 'all');
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member inserted a cross-tenant item'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.item_logs(workspace_id, item_id, checked_out_by, action_type, performed_by)
    values (
      '10000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      'member_forged_log',
      '11000000-0000-4000-8000-000000000002'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member inserted a cross-tenant item log'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.item_logs set action_type = 'member tamper'
    where id = '50000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member updated Tenant B item logs'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.item_logs
    where id = '50000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member deleted Tenant B item logs'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.item_status_history(workspace_id, item_id, status, note, changed_by)
    values (
      '10000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002',
      'lost',
      'member forged status history',
      '11000000-0000-4000-8000-000000000002'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member inserted Tenant B status history'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.item_status_history set note = 'member tamper'
    where id = '55000000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member updated Tenant B status history'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.item_status_history
    where id = '55000000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member deleted Tenant B status history'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.admin_audit_logs(workspace_id, actor_id, action_type, metadata)
    values (
      '10000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000002',
      'member_forged_audit',
      '{"nested":{"org_id":"itx-security-org-b"}}'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member inserted a Tenant B audit row'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.admin_audit_logs set metadata = '{"forged":true}'
    where id = '60000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member updated Tenant B audit data'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.admin_audit_logs
    where id = '60000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member deleted Tenant B audit data'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.account_sessions(
      workspace_id, profile_id, device_id, general_location, auth_session_id
    ) values (
      '10000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000003',
      'itx-member-forged-location',
      'FORGED-TENANT-B-LOCATION',
      'itx-security-session-b-admin'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member inserted a Tenant B location/session record'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.account_sessions set general_location = 'member tamper'
    where id = '70000000-0000-4000-8000-000000000003';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member updated Tenant B location/session data'; end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.account_sessions
    where id = '70000000-0000-4000-8000-000000000003';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Tenant A member deleted Tenant B location/session data'; end if;
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;
do $$
begin
  if not exists (select 1 from public.items where id = '30000000-0000-4000-8000-000000000002' and name = 'Tenant B Secret Item') then
    raise exception 'Tenant B row changed during mixed-batch or member attacks';
  end if;
  if not exists (
    select 1 from public.borrowers
    where id = '40000000-0000-4000-8000-000000000002'
      and username = 'Tenant B Secret Borrower'
      and workspace_id = '10000000-0000-4000-8000-000000000002'
  ) then raise exception 'Tenant B borrower changed during IDOR attempts'; end if;
  if not exists (select 1 from public.item_status_history where id = '55000000-0000-4000-8000-000000000001' and note = 'Tenant B status history secret') then
    raise exception 'Tenant B status history changed during IDOR attempts';
  end if;
  if not exists (select 1 from public.account_sessions where id = '70000000-0000-4000-8000-000000000003' and profile_id = '11000000-0000-4000-8000-000000000003' and general_location = 'B-SECRET-LOCATION-RECORD') then
    raise exception 'Tenant B location/session data changed during IDOR attempts';
  end if;
  if exists (select 1 from public.items where barcode in ('ITX-FORGED-B-ITEM', 'ITX-BATCH-B', 'ITX-MEMBER-FORGED-B')) then
    raise exception 'rejected cross-tenant inventory payload inserted a Tenant B item';
  end if;
  if exists (
    select 1 from public.borrowers
    where borrower_id in ('ITX-FORGED-B-BORROWER', 'ITX-MEMBER-FORGED-B-BORROWER')
  ) then raise exception 'rejected cross-tenant borrower payload inserted a row'; end if;
  if exists (select 1 from public.item_logs where action_type in ('forged_cross_tenant_checkout', 'member_forged_log')) then
    raise exception 'rejected cross-tenant item log payload inserted a row';
  end if;
  if exists (select 1 from public.account_sessions where device_id in ('itx-admin-forged-location', 'itx-member-forged-location')) then
    raise exception 'rejected cross-tenant location/session payload inserted a row';
  end if;
end
$$;

-- Layer 1 (grants): browser roles hold no direct write privilege on the
-- inventory tables, which is why the item/borrower/status-history probes above
-- end in SQLSTATE 42501 before RLS is consulted. Assert that by name so a
-- future re-grant fails here instead of silently shifting all protection onto
-- RLS.
--
-- `anon` still holds Supabase's default INSERT/UPDATE/DELETE grants on these
-- tables (verified on staging and production 2026-11-10); it is denied only
-- because RLS is enabled and no policy reaches anon/PUBLIC. Assert that
-- invariant explicitly. Once anon's write grants are revoked by a migration,
-- add 'anon' to the grantee loop below.
do $$
declare
  relation_name text;
  privilege_name text;
  anon_policy text;
begin
  foreach relation_name in array array[
    'public.items', 'public.borrowers', 'public.item_status_history'
  ] loop
    foreach privilege_name in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('authenticated', relation_name, privilege_name) then
        raise exception 'layer 1: authenticated unexpectedly holds % on %',
          privilege_name, relation_name;
      end if;
    end loop;

    if not (select relrowsecurity from pg_class where oid = relation_name::regclass) then
      raise exception 'layer 1: RLS is disabled on %; anon write grants would be live', relation_name;
    end if;
    select pol.polname into anon_policy
    from pg_policy as pol
    where pol.polrelid = relation_name::regclass
      and (
        0 = any(pol.polroles)
        or (select oid from pg_roles where rolname = 'anon') = any(pol.polroles)
      )
    limit 1;
    if anon_policy is not null then
      raise exception 'layer 1: policy % on % reaches anon/PUBLIC while anon holds write grants',
        anon_policy, relation_name;
    end if;
  end loop;
end
$$;

-- Layer 2 (RLS): restore the write grants inside this rolled-back transaction
-- so the same attacks reach the row-level policies. Workspace admins and
-- members have no direct write policy on these tables (workspace writes go
-- through service-role RPCs), so every write must touch zero rows or fail
-- WITH CHECK, including rows in the caller's own workspace.
grant insert, update, delete
  on public.items, public.borrowers, public.item_status_history
  to authenticated;

create function pg_temp.assert_rls_denies_direct_writes(label text)
returns void
language plpgsql
as $$
declare
  affected integer;
  visible integer;
  rejected boolean;
begin
  if not has_table_privilege('authenticated', 'public.items', 'UPDATE') then
    raise exception '%: temporary grant did not apply; RLS layer not exercised', label;
  end if;

  -- Positive control: the caller still resolves to Tenant A and sees its own
  -- item, so zero-row writes below are RLS decisions, not a dead session.
  select count(*) into visible from public.items
  where id in (
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002'
  );
  if visible <> 1 then
    raise exception '%: expected exactly the own Tenant A item to be visible, saw %', label, visible;
  end if;

  update public.items set name = 'rls layer mixed update'
  where id in (
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002'
  );
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception '%: RLS allowed direct item UPDATE of % row(s)', label, affected; end if;

  delete from public.items
  where id in (
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002'
  );
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception '%: RLS allowed direct item DELETE of % row(s)', label, affected; end if;

  update public.borrowers set username = 'rls layer mixed update'
  where id in (
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002'
  );
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception '%: RLS allowed direct borrower UPDATE of % row(s)', label, affected; end if;

  delete from public.borrowers
  where id in (
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002'
  );
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception '%: RLS allowed direct borrower DELETE of % row(s)', label, affected; end if;

  update public.item_status_history set note = 'rls layer tamper'
  where id = '55000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception '%: RLS allowed Tenant B status history UPDATE', label; end if;

  delete from public.item_status_history
  where id = '55000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception '%: RLS allowed Tenant B status history DELETE', label; end if;

  -- Inserts must fail WITH CHECK (42501) atomically: a mixed batch carrying a
  -- valid Tenant A row must not land that row either.
  rejected := false;
  begin
    insert into public.items(workspace_id, name, status, barcode, access_mode)
    values
      ('10000000-0000-4000-8000-000000000001', 'rls layer Tenant A', 'available', 'ITX-RLS-BATCH-A', 'all'),
      ('10000000-0000-4000-8000-000000000002', 'rls layer Tenant B', 'available', 'ITX-RLS-BATCH-B', 'all');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception '%: RLS accepted a mixed-tenant item INSERT', label; end if;

  rejected := false;
  begin
    insert into public.borrowers(workspace_id, username, borrower_id, access_mode)
    values ('10000000-0000-4000-8000-000000000002', 'rls layer borrower', 'ITX-RLS-B-BORROWER', 'all');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception '%: RLS accepted a Tenant B borrower INSERT', label; end if;

  rejected := false;
  begin
    insert into public.item_status_history(workspace_id, item_id, status, note, changed_by)
    values (
      '10000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002',
      'lost',
      'rls layer forged status',
      auth.uid()
    );
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception '%: RLS accepted a Tenant B status history INSERT', label; end if;
end
$$;
-- SECURITY INVOKER: runs with the caller's role, so RLS applies to each probe.
grant execute on function pg_temp.assert_rls_denies_direct_writes(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"itx-security-session-a-admin","org_id":"itx-security-org-a"}', true);
select pg_temp.assert_rls_denies_direct_writes('layer 2 / Tenant A admin');

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"service_role","session_id":"itx-security-session-a-member","org_id":"itx-security-org-b","workspace_id":"10000000-0000-4000-8000-000000000002","app_metadata":{"role":"super_admin"}}',
  true
);
select pg_temp.assert_rls_denies_direct_writes('layer 2 / Tenant A member with forged claims');

reset role;
do $$
begin
  if not exists (
    select 1 from public.items
    where id = '30000000-0000-4000-8000-000000000001'
      and name = 'Tenant A Fixture Item'
  ) or not exists (
    select 1 from public.items
    where id = '30000000-0000-4000-8000-000000000002'
      and name = 'Tenant B Secret Item'
  ) then raise exception 'layer 2: RLS-denied writes still changed item rows'; end if;
  if (select count(*) from public.borrowers where id in (
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002'
  )) <> 2 then raise exception 'layer 2: RLS-denied writes removed borrower rows'; end if;
  if exists (
    select 1 from public.items where barcode in ('ITX-RLS-BATCH-A', 'ITX-RLS-BATCH-B')
  ) or exists (
    select 1 from public.borrowers where borrower_id = 'ITX-RLS-B-BORROWER'
  ) or exists (
    select 1 from public.item_status_history where note = 'rls layer forged status'
  ) then raise exception 'layer 2: an RLS-rejected INSERT persisted a row'; end if;
end
$$;

rollback;
