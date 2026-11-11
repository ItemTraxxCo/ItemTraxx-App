-- Included by each integration scenario inside its own transaction. Stable
-- fixture IDs make raw-ID attacks reproducible; every scenario rolls back.
insert into auth.users (id, email) values
  ('11000000-0000-4000-8000-000000000001', 'itx-security-a-admin@example.test'),
  ('11000000-0000-4000-8000-000000000002', 'itx-security-a-member@example.test'),
  ('11000000-0000-4000-8000-000000000003', 'itx-security-b-admin@example.test');

insert into better_auth."user" (id, name, email, "emailVerified") values
  ('11000000-0000-4000-8000-000000000001', 'Security A Admin', 'itx-security-a-admin@example.test', true),
  ('11000000-0000-4000-8000-000000000002', 'Security A Member', 'itx-security-a-member@example.test', true),
  ('11000000-0000-4000-8000-000000000003', 'Security B Admin', 'itx-security-b-admin@example.test', true);

insert into better_auth.organization (id, name, slug, "createdAt") values
  ('itx-security-org-a', 'Security Tenant A', 'itx-security-tenant-a', now()),
  ('itx-security-org-b', 'Security Tenant B', 'itx-security-tenant-b', now());

insert into public.workspaces (
  id, name, slug, status, better_auth_organization_id
) values
  ('10000000-0000-4000-8000-000000000001', 'Security Tenant A', 'itx-security-tenant-a', 'active', 'itx-security-org-a'),
  ('10000000-0000-4000-8000-000000000002', 'Security Tenant B', 'itx-security-tenant-b', 'active', 'itx-security-org-b');

insert into public.profiles (
  id, workspace_id, role, auth_email, better_auth_user_id, is_active
) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'workspace_admin', 'itx-security-a-admin@example.test', '11000000-0000-4000-8000-000000000001', true),
  ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'tenant_account', 'itx-security-a-member@example.test', '11000000-0000-4000-8000-000000000002', true),
  ('11000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'workspace_admin', 'itx-security-b-admin@example.test', '11000000-0000-4000-8000-000000000003', true);

update public.workspaces
set primary_admin_profile_id = case id
  when '10000000-0000-4000-8000-000000000001' then '11000000-0000-4000-8000-000000000001'::uuid
  when '10000000-0000-4000-8000-000000000002' then '11000000-0000-4000-8000-000000000003'::uuid
end
where id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

insert into better_auth.member (
  id, "organizationId", "userId", role, "createdAt"
) values
  ('itx-security-member-a-admin', 'itx-security-org-a', '11000000-0000-4000-8000-000000000001', 'admin', now()),
  ('itx-security-member-a-user', 'itx-security-org-a', '11000000-0000-4000-8000-000000000002', 'tenant_account', now()),
  ('itx-security-member-b-admin', 'itx-security-org-b', '11000000-0000-4000-8000-000000000003', 'admin', now());

insert into better_auth.session (
  id, "expiresAt", token, "updatedAt", "userId", "activeOrganizationId"
) values
  ('itx-security-session-a-admin', now() + interval '1 hour', 'itx-security-token-a-admin', now(), '11000000-0000-4000-8000-000000000001', 'itx-security-org-a'),
  ('itx-security-session-a-member', now() + interval '1 hour', 'itx-security-token-a-member', now(), '11000000-0000-4000-8000-000000000002', 'itx-security-org-a'),
  ('itx-security-session-b-admin', now() + interval '1 hour', 'itx-security-token-b-admin', now(), '11000000-0000-4000-8000-000000000003', 'itx-security-org-b');

insert into public.account_sessions (
  id, workspace_id, profile_id, device_id, login_location, general_location,
  auth_session_id
) values
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'itx-security-a-admin-device', 'admin_login', 'Tenant A', 'itx-security-session-a-admin'),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'itx-security-a-member-device', 'regular_login', 'Tenant A', 'itx-security-session-a-member'),
  ('70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'itx-security-b-admin-device', 'admin_login', 'B-SECRET-LOCATION-RECORD', 'itx-security-session-b-admin');

-- account_category is explicit so the fixture does not depend on the column
-- default, which was invalid ('organization') until 20261111120000.
insert into public.workspace_policies (
  workspace_id, account_category, billing_email, billing_status,
  invoice_reference, max_admins, max_items
) values
  ('10000000-0000-4000-8000-000000000001', 'workspace', 'billing-a@example.test', 'active', 'INVOICE-A-SECRET', 5, 500),
  ('10000000-0000-4000-8000-000000000002', 'workspace', 'billing-b@example.test', 'past_due', 'INVOICE-B-SECRET', 5, 500);

insert into public.items (
  id, workspace_id, name, status, barcode, access_mode
) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Tenant A Fixture Item', 'available', 'ITX-SEC-A-ITEM', 'all'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Tenant B Secret Item', 'available', 'ITX-SEC-B-ITEM-SECRET', 'all');

insert into public.borrowers (
  id, workspace_id, username, borrower_id, access_mode
) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Tenant A Fixture Borrower', 'ITX-A-BORROWER', 'all'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Tenant B Secret Borrower', 'ITX-B-BORROWER-SECRET', 'all');

insert into public.item_logs (
  id, workspace_id, item_id, checked_out_by, action_type, performed_by
) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'checkout', '11000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'checkout', '11000000-0000-4000-8000-000000000003');

insert into public.item_status_history (
  id, workspace_id, item_id, status, note, changed_by
) values
  ('55000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'available', 'Tenant B status history secret', '11000000-0000-4000-8000-000000000003');

insert into public.admin_audit_logs (
  id, workspace_id, actor_id, action_type, entity_type, entity_id, metadata
) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'fixture_audit', 'item', '30000000-0000-4000-8000-000000000001', '{"marker":"tenant-a"}'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'fixture_audit', 'item', '30000000-0000-4000-8000-000000000002', '{"marker":"tenant-b-secret","billing":"INVOICE-B-SECRET"}');
