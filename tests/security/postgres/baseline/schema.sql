-- GENERATED FILE: do not edit by hand. Regenerate with
-- `npm run test:security:baseline` (see generate-baseline.sql).
-- Schema-only DDL for public, private and better_auth; contains no rows.
-- Source: staging project; generated 2026-11-11T06:33:49Z
-- Applied migrations captured by this baseline:
--   20260725205401 workspace_model_role_redesign
--   20260725205441 workspace_model_security_hardening
--   20260725205939 workspace_dashboard_rpc_hardening
--   20260725212230 workspace_primary_admin_integrity
--   20260725221922 item_borrower_physical_rename
--   20260728212707 provision_sales_leads_tables
--   20260728212735 rename_sales_lead_plan_keys
--   20260728212802 rename_workspace_policy_plan_keys
--   20260728214420 offline_checkout_mvp_server
--   20260728215025 fix_create_borrower_identity_service_role_auth
--   20260728215039 create_borrower_identity_audit_trail
--   20260728215137 least_privilege_rest_surface
--   20260801045521 harden_privileged_rls_and_rate_limits
--   20260801053630 restore_checkout_borrower_lookup_rate_window
--   20260815192140 move_pg_trgm_to_extensions
--   20260816203434 checkout_return_atomicity
--   20260817015950 20260816150000_align_reporting_item_total
--   20260830032303 harden_remaining_security_boundaries
--   20260907210000 better_auth_foundation
--   20260908130000 better_auth_data_api
--   20260908185903 fix_better_auth_workspace_lifecycle
--   20260919120000 individual_accounts
--   20260920185122 20260920100000_harden_account_session_lifecycle
--   20260920185153 20260920101000_harden_workspace_usage_policy
--   20260920185154 20260920102000_enforce_offline_pack_expiry
--   20260921034830 allow_individual_primary_admin
--   20260921034928 repair_individual_primary_admins
--   20260921042237 fix_better_auth_actor_foreign_keys
--   20260922174513 20260922120000_sync_better_auth_session_registry
--   20260923035430 20260923120000_remove_privileged_verification_ttl
--   20260925011630 20260924120000_sync_better_auth_workspace_names
--   20260929202842 20260814010000_fix_reporting_refresh_rpc
--   20260929202843 20260929143000_workspace_account_role_management
--   20261004031748 reserve_offline_quick_return_audit_source
--   20261004075847 enforce_workspace_admin_limit
--   20261004075909 secure_workspace_account_invitations
--   20261004200305 audit_borrower_mutations_atomically
--   20261007013039 20261003124000_validate_account_session_expiry
--   20261007014622 20261003125000_bound_and_chunk_offline_checkout_packs
--   20261007015552 20261007015200_fix_offline_pack_borrower_uuid_cast
--   20261009045822 20261009030000_require_fresh_super_admin_stepup
--   20261009083624 20260814010000_fix_reporting_refresh_rpc
--   20261009083625 20260929143000_workspace_account_role_management
--   20261009083626 20261008120000_enforce_turnstile_token_single_use
--   20261009083627 20261008203000_harden_super_approval_write_boundary
--   20261018203904 enforce_active_better_auth_workspace_lifecycle
--   20261023220413 20261023190000_revoke_api_sequence_update
--   20261024164156 20261023100000_require_live_session_for_account_session_reads
--   20261101220517 20261101120000_atomic_item_mutations
--   20261102015215 security_audit_logs
--   20261104120000
--   20261104130000
--   20261104140000
--   20261105005045
--   20261105011752
--   20261105014558
--   20261109013752 20261109013752_workspace_purge_better_auth_user_fk
--   20261109052911 20261109120000_workspace_purge_better_auth_organization_fk
-- END MIGRATIONS

set check_function_bodies = off;
set client_min_messages = warning;

do $role$ begin if not exists (select 1 from pg_roles where rolname = 'pg_database_owner') then create role pg_database_owner nologin; end if; end $role$;

create schema if not exists better_auth;

create schema if not exists private;

create extension if not exists pg_trgm with schema extensions;

create extension if not exists pgcrypto with schema extensions;

create extension if not exists "uuid-ossp" with schema extensions;

create table better_auth.account (
  id text not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp with time zone,
  "refreshTokenExpiresAt" timestamp with time zone,
  scope text,
  password text,
  "createdAt" timestamp with time zone not null,
  "updatedAt" timestamp with time zone not null
);

create table better_auth.invitation (
  id text not null,
  "organizationId" text not null,
  email text not null,
  role text,
  status text not null,
  "expiresAt" timestamp with time zone not null,
  "createdAt" timestamp with time zone not null,
  "inviterId" text not null
);

create table better_auth.jwks (
  id text not null,
  "publicKey" text not null,
  "privateKey" text not null,
  "createdAt" timestamp with time zone not null,
  "expiresAt" timestamp with time zone,
  alg text,
  crv text
);

create table better_auth.member (
  id text not null,
  "organizationId" text not null,
  "userId" text not null,
  role text not null,
  "createdAt" timestamp with time zone not null
);

create table better_auth.organization (
  id text not null,
  name text not null,
  slug text not null,
  logo text,
  "createdAt" timestamp with time zone not null,
  metadata text
);

create table better_auth.passkey (
  id text not null,
  name text,
  "publicKey" text not null,
  "userId" text not null,
  "credentialID" text not null,
  counter integer not null,
  "deviceType" text not null,
  "backedUp" boolean not null,
  transports text,
  "createdAt" timestamp with time zone,
  aaguid text
);

create table better_auth.session (
  id text not null,
  "expiresAt" timestamp with time zone not null,
  token text not null,
  "createdAt" timestamp with time zone not null,
  "updatedAt" timestamp with time zone not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null,
  "activeOrganizationId" text,
  "impersonatedBy" text
);

create table better_auth."ssoProvider" (
  id text not null,
  issuer text not null,
  "oidcConfig" text,
  "samlConfig" text,
  "userId" text not null,
  "providerId" text not null,
  "organizationId" text,
  domain text not null,
  "domainVerified" boolean
);

create table better_auth."twoFactor" (
  id text not null,
  secret text not null,
  "backupCodes" text not null,
  "userId" text not null,
  verified boolean,
  "failedVerificationCount" integer,
  "lockedUntil" timestamp with time zone
);

create table better_auth."user" (
  id text not null,
  name text not null,
  email text not null,
  "emailVerified" boolean not null,
  image text,
  "createdAt" timestamp with time zone not null,
  "updatedAt" timestamp with time zone not null,
  role text,
  banned boolean,
  "banReason" text,
  "banExpires" timestamp with time zone,
  "twoFactorEnabled" boolean
);

create table better_auth.verification (
  id text not null,
  identifier text not null,
  value text not null,
  "expiresAt" timestamp with time zone not null,
  "createdAt" timestamp with time zone not null,
  "updatedAt" timestamp with time zone not null
);

create table private.turnstile_token_redemptions (
  token_hash text not null,
  redeemed_at timestamp with time zone not null,
  expires_at timestamp with time zone not null
);

create table private.workspace_purge_external_cleanup (
  workspace_id uuid not null,
  organization_logo_deleted_at timestamp with time zone not null
);

create table public.account_sessions (
  id uuid not null,
  workspace_id uuid not null,
  profile_id uuid not null,
  device_id text not null,
  device_label text,
  user_agent text,
  login_method text,
  login_location text,
  general_location text,
  auth_session_id text,
  auth_token_hash text,
  auth_token_issued_at timestamp with time zone,
  created_at timestamp with time zone not null,
  last_seen_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  revoked_by uuid
);

create table public.admin_audit_logs (
  id uuid not null,
  workspace_id uuid not null,
  actor_id uuid not null,
  action_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamp with time zone not null
);

create table public.app_runtime_config (
  key text not null,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamp with time zone not null
);

create table public.better_auth_email_change_requests (
  id uuid not null,
  profile_id uuid not null,
  better_auth_user_id text not null,
  current_email text not null,
  new_email text not null,
  approval_token_hash text not null,
  verification_token_hash text,
  created_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  current_email_approved_at timestamp with time zone,
  completed_at timestamp with time zone,
  revoked_at timestamp with time zone
);

create table public.borrower_access_grants (
  borrower_id uuid not null,
  profile_id uuid not null,
  granted_at timestamp with time zone not null,
  granted_by uuid
);

create table public.borrowers (
  id uuid not null,
  workspace_id uuid not null,
  borrower_id text,
  created_at timestamp with time zone not null,
  deleted_at timestamp with time zone,
  deleted_by uuid,
  username text not null,
  access_mode text not null
);

create table public.customer_status_logs (
  id uuid not null,
  lead_id uuid not null,
  invoice_id text not null,
  status text not null,
  created_at timestamp with time zone not null,
  created_by uuid
);

create table public.item_access_grants (
  item_id uuid not null,
  profile_id uuid not null,
  granted_at timestamp with time zone not null,
  granted_by uuid
);

create table public.item_logs (
  id uuid not null,
  workspace_id uuid not null,
  item_id uuid not null,
  checked_out_by uuid,
  action_type text,
  action_time timestamp with time zone not null,
  performed_by uuid,
  operation_id text
);

create table public.item_status_history (
  id uuid not null,
  workspace_id uuid not null,
  item_id uuid not null,
  status text not null,
  note text,
  changed_by uuid,
  changed_at timestamp with time zone not null
);

create table public.items (
  id uuid not null,
  workspace_id uuid not null,
  name text not null,
  status text not null,
  notes text,
  created_at timestamp with time zone not null,
  barcode text,
  checked_out_by uuid,
  checked_out_at timestamp with time zone,
  serial_number text,
  deleted_at timestamp with time zone,
  deleted_by uuid,
  access_mode text not null
);

create table public.legal_acceptances (
  id uuid not null,
  profile_id uuid,
  terms_version text,
  acceptance_method text not null,
  agreement_context text,
  ip_hash text,
  user_agent text,
  accepted_at timestamp with time zone not null,
  created_at timestamp with time zone not null,
  workspace_id uuid,
  document_type text,
  document_version text,
  document_hash text,
  ip_address inet
);

create table public.legal_document_versions (
  document_type text not null,
  version text not null,
  content_sha256 text not null,
  url_path text not null,
  required_for_roles text[] not null,
  effective_at timestamp with time zone not null,
  retired_at timestamp with time zone,
  created_at timestamp with time zone not null
);

create table public.offline_checkout_conflicts (
  id uuid not null,
  pack_id uuid not null,
  workspace_id uuid not null,
  profile_id uuid not null,
  device_id text not null,
  operation_id text not null,
  offline_payload jsonb not null,
  server_state jsonb not null,
  status text not null,
  resolution text,
  resolution_result jsonb,
  created_at timestamp with time zone not null,
  resolved_at timestamp with time zone,
  resolved_by uuid
);

create table public.offline_checkout_pack_borrowers (
  pack_id uuid not null,
  borrower_id uuid not null
);

create table public.offline_checkout_pack_items (
  pack_id uuid not null,
  item_id uuid not null,
  snapshot_status text not null,
  snapshot_checked_out_by uuid
);

create table public.offline_checkout_packs (
  id uuid not null,
  workspace_id uuid not null,
  profile_id uuid not null,
  device_id text not null,
  prepared_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  invalidated_at timestamp with time zone,
  item_count integer not null,
  borrower_count integer not null,
  download_complete boolean not null,
  downloaded_bytes integer not null
);

create table public.privileged_session_stepups (
  id uuid not null,
  user_id uuid not null,
  role_scope text not null,
  binding_key text not null,
  issued_by text not null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  expires_at timestamp with time zone
);

create table public.profiles (
  id uuid not null,
  workspace_id uuid,
  role text not null,
  created_at timestamp with time zone not null,
  auth_email text,
  is_active boolean not null,
  deleted_at timestamp with time zone,
  better_auth_user_id text
);

create table public.rate_limits (
  workspace_id uuid not null,
  actor_id uuid not null,
  scope text not null,
  window_start timestamp with time zone not null,
  count integer not null
);

create table public.rate_limits_prelogin (
  rate_key text not null,
  scope text not null,
  window_start timestamp with time zone not null,
  count integer not null
);

create table public.sales_leads (
  id uuid not null,
  plan text not null,
  lead_state text not null,
  stage text not null,
  schools_count integer,
  name text not null,
  organization text,
  reply_email text not null,
  details text,
  source text not null,
  ip_hash text,
  user_agent text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone
);

create table public.security_audit_logs (
  id uuid not null,
  created_at timestamp with time zone not null,
  actor_id uuid not null,
  workspace_id uuid not null,
  action text not null,
  target_type text not null,
  target_resource_id uuid not null,
  route text not null,
  method text not null,
  request_id text not null
);

create table public.super_admin_sessions (
  id uuid not null,
  profile_id uuid not null,
  device_id text not null,
  device_label text,
  user_agent text,
  login_method text,
  login_location text,
  general_location text,
  auth_session_id text,
  auth_token_issued_at timestamp with time zone,
  created_at timestamp with time zone not null,
  last_seen_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  revoked_by uuid
);

create table public.workspace_account_invitations (
  id uuid not null,
  workspace_id uuid not null,
  inviter_profile_id uuid not null,
  email text not null,
  account_role text not null,
  token_hash text not null,
  created_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  accepted_at timestamp with time zone,
  accepted_profile_id uuid,
  revoked_at timestamp with time zone
);

create table public.workspace_deletion_certificates (
  id uuid not null,
  workspace_id uuid not null,
  purged_at timestamp with time zone not null,
  deleted_row_counts jsonb not null,
  external_cleanup jsonb not null
);

create table public.workspace_policies (
  workspace_id uuid not null,
  max_admins integer,
  max_borrowers integer,
  max_items integer,
  barcode_pattern text,
  updated_by uuid,
  updated_at timestamp with time zone not null,
  checkout_due_hours integer not null,
  escalation_level_1_hours integer not null,
  escalation_level_2_hours integer not null,
  escalation_level_3_hours integer not null,
  account_category text not null,
  plan_code text,
  feature_flags jsonb not null,
  contact_name text,
  support_email text,
  billing_email text,
  billing_status text,
  renewal_date date,
  invoice_reference text
);

create table public.workspace_security_controls (
  workspace_id uuid not null,
  force_reauth_after timestamp with time zone,
  updated_by uuid,
  updated_at timestamp with time zone not null
);

create table public.workspace_usage (
  workspace_id uuid not null,
  active_items integer not null,
  active_borrowers integer not null,
  updated_at timestamp with time zone not null
);

create table public.workspaces (
  id uuid not null,
  name text not null,
  slug text not null,
  status text not null,
  primary_admin_profile_id uuid,
  archived_at timestamp with time zone,
  purge_after timestamp with time zone,
  purge_state text not null,
  purged_at timestamp with time zone,
  created_at timestamp with time zone not null,
  better_auth_organization_id text,
  purge_claimed_at timestamp with time zone
);

CREATE OR REPLACE FUNCTION public.accept_workspace_account_invitation(p_token_hash text, p_profile_id uuid, p_user_id text, p_account_id text, p_member_id text, p_password_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invitation public.workspace_account_invitations%rowtype;
  v_workspace_id uuid;
  v_workspace_status text;
  v_archived_at timestamptz;
  v_organization_id text;
  v_account_category text;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_membership_count integer;
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_profile_id is null
     or nullif(p_user_id, '') is null
     or nullif(p_account_id, '') is null
     or nullif(p_member_id, '') is null
     or nullif(p_password_hash, '') is null then
    raise exception 'invitation cannot be accepted';
  end if;

  -- Match the lock order used by create_workspace_account_invitation: lock
  -- the workspace first, then the invitation and inviter rows. This prevents
  -- deadlocks when an admin refreshes an invite while its recipient accepts.
  select invitation.workspace_id into v_workspace_id
  from public.workspace_account_invitations as invitation
  where invitation.token_hash = p_token_hash;

  if not found or v_workspace_id is null then
    raise exception 'invitation cannot be accepted';
  end if;

  select workspace.status, workspace.archived_at,
         workspace.better_auth_organization_id, policy.account_category
    into v_workspace_status, v_archived_at,
         v_organization_id, v_account_category
  from public.workspaces as workspace
  left join public.workspace_policies as policy
    on policy.workspace_id = workspace.id
  where workspace.id = v_workspace_id
  for update of workspace;

  if not found
     or v_archived_at is not null
     or v_workspace_status is distinct from 'active'
     or v_organization_id is null
     or v_account_category = 'individual' then
    raise exception 'invitation cannot be accepted';
  end if;

  select invitation.* into v_invitation
  from public.workspace_account_invitations as invitation
  where invitation.token_hash = p_token_hash
    and invitation.workspace_id = v_workspace_id
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > now()
  for update;

  if not found then
    raise exception 'invitation cannot be accepted';
  end if;

  select profile.workspace_id, profile.role, profile.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles as profile
  where profile.id = v_invitation.inviter_profile_id
    and profile.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from v_invitation.workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true then
    raise exception 'invitation cannot be accepted';
  end if;

  if v_invitation.account_role = 'workspace_admin' then
    perform public.workspace_admin_create_profile(
      v_invitation.inviter_profile_id,
      v_invitation.workspace_id,
      p_profile_id,
      v_invitation.email
    );
  else
    insert into public.profiles (
      id, workspace_id, auth_email, role, is_active
    ) values (
      p_profile_id, v_invitation.workspace_id, v_invitation.email,
      'tenant_account', true
    );
  end if;

  perform public.better_auth_create_user(
    p_profile_id,
    p_user_id,
    p_account_id,
    v_invitation.email,
    v_invitation.email,
    'user',
    p_password_hash,
    v_invitation.workspace_id,
    p_member_id,
    v_invitation.account_role
  );

  if v_invitation.account_role = 'workspace_admin' then
    update better_auth.member
    set role = 'admin'
    where "userId" = p_user_id
      and role = 'workspace_admin';
    get diagnostics v_membership_count = row_count;
    if v_membership_count <> 1 then
      raise exception 'invitation cannot be accepted';
    end if;
  end if;

  update public.workspace_account_invitations
  set accepted_at = now(), accepted_profile_id = p_profile_id
  where id = v_invitation.id;

  return jsonb_build_object(
    'profile_id', p_profile_id,
    'workspace_id', v_invitation.workspace_id,
    'email', v_invitation.email,
    'role', v_invitation.account_role
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.append_security_audit_entries(p_entries jsonb)
 RETURNS TABLE(enumeration_tripwire boolean, distinct_target_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.apply_checkout_return_item(p_workspace_id uuid, p_profile_id uuid, p_item_id uuid, p_operation_id text, p_action_type text, p_borrower_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.apply_offline_checkout_item(p_workspace_id uuid, p_profile_id uuid, p_device_id text, p_pack_id uuid, p_operation_id text, p_item_id uuid, p_barcode text, p_intent text, p_borrower_id uuid, p_expected_status text, p_expected_checked_out_by uuid, p_conflict_id uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1
    from public.offline_checkout_packs pack
    where pack.id = p_pack_id
      and pack.workspace_id = p_workspace_id
      and pack.profile_id = p_profile_id
      and pack.device_id = p_device_id
      and pack.invalidated_at is null
      and pack.expires_at > now()
  ) then
    raise exception 'Offline checkout pack is expired' using errcode = '42501';
  end if;

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
$function$
;

CREATE OR REPLACE FUNCTION public.apply_offline_checkout_item_unchecked(p_workspace_id uuid, p_profile_id uuid, p_device_id text, p_pack_id uuid, p_operation_id text, p_item_id uuid, p_barcode text, p_intent text, p_borrower_id uuid, p_expected_status text, p_expected_checked_out_by uuid, p_conflict_id uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.approve_better_auth_email_change(p_approval_token_hash text, p_verification_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.better_auth_email_change_requests%rowtype;
begin
  if p_approval_token_hash is null
     or p_approval_token_hash !~ '^[0-9a-f]{64}$'
     or p_verification_token_hash is null
     or p_verification_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'email change request is invalid';
  end if;

  select request.* into v_request
  from public.better_auth_email_change_requests as request
  where request.approval_token_hash = p_approval_token_hash
    and request.current_email_approved_at is null
    and request.completed_at is null
    and request.revoked_at is null
    and request.expires_at > now()
  for update;

  if not found then
    raise exception 'email change request is invalid';
  end if;

  update public.better_auth_email_change_requests
  set current_email_approved_at = coalesce(current_email_approved_at, now()),
      verification_token_hash = p_verification_token_hash
  where id = v_request.id;

  return jsonb_build_object(
    'request_id', v_request.id,
    'new_email', v_request.new_email
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_borrower_with_audit(p_workspace_id uuid, p_actor_id uuid, p_borrower_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resolved_actor_role text;
  archived_id uuid;
  archived_username text;
  archived_borrower_id text;
begin
  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  update public.borrowers as borrower
  set deleted_at = now(), deleted_by = p_actor_id
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is null
  returning borrower.id, borrower.username, borrower.borrower_id
  into archived_id, archived_username, archived_borrower_id;

  if not found then
    return false;
  end if;

  insert into public.admin_audit_logs(
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'borrower_archive',
    'borrower',
    archived_id,
    jsonb_build_object('borrower_id', archived_borrower_id, 'username', archived_username)
  );

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.better_auth_create_organization(p_workspace_id uuid, p_name text, p_slug text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_workspace_id is null or nullif(trim(p_name), '') is null or nullif(trim(p_slug), '') is null then
    raise exception 'invalid organization input';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id and archived_at is null) then
    raise exception 'workspace not found';
  end if;
  insert into better_auth.organization(id, name, slug, "createdAt")
  values (p_workspace_id::text, trim(p_name), lower(trim(p_slug)), now());
  update public.workspaces
  set better_auth_organization_id = p_workspace_id::text
  where id = p_workspace_id;
  return p_workspace_id::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.better_auth_create_user(p_profile_id uuid, p_user_id text, p_account_id text, p_email text, p_name text, p_global_role text, p_password_hash text, p_workspace_id uuid DEFAULT NULL::uuid, p_member_id text DEFAULT NULL::text, p_member_role text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.claim_workspaces_due_for_purge(p_limit integer DEFAULT 3)
 RETURNS TABLE(id uuid, name text, slug text, better_auth_organization_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  return query
  with due as (
    select w.id
    from public.workspaces w
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
    for update skip locked
  )
  update public.workspaces w
  set purge_state = 'purging', purge_claimed_at = pg_catalog.clock_timestamp()
  from due
  where w.id = due.id
  returning w.id, null::text, null::text, w.better_auth_organization_id::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_better_auth_email_change(p_verification_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.better_auth_email_change_requests%rowtype;
  v_profile_id uuid;
  v_better_auth_user_id text;
  v_updated_rows integer;
begin
  if p_verification_token_hash is null
     or p_verification_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('success', false);
  end if;

  -- Request creation locks the Better Auth user, profile, then request row.
  -- Follow that same order here; the email-sync trigger updates profiles.
  select request.profile_id, request.better_auth_user_id
    into v_profile_id, v_better_auth_user_id
  from public.better_auth_email_change_requests as request
  where request.verification_token_hash = p_verification_token_hash
    and request.current_email_approved_at is not null
    and request.completed_at is null
    and request.revoked_at is null
    and request.expires_at > now();

  if not found then
    return jsonb_build_object('success', false);
  end if;

  if nullif(v_better_auth_user_id, '') is null then
    return jsonb_build_object('success', false);
  end if;

  perform 1
  from better_auth."user" as auth_user
  where auth_user.id = v_better_auth_user_id
  for update;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = v_profile_id
    and profile.better_auth_user_id = v_better_auth_user_id
    and profile.is_active is true
    and profile.deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  select request.* into v_request
  from public.better_auth_email_change_requests as request
  where request.verification_token_hash = p_verification_token_hash
    and request.profile_id = v_profile_id
    and request.better_auth_user_id = v_better_auth_user_id
    and request.current_email_approved_at is not null
    and request.completed_at is null
    and request.revoked_at is null
    and request.expires_at > now()
  for update;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  begin
    update better_auth."user" as auth_user
    set email = v_request.new_email,
        "emailVerified" = true,
        "updatedAt" = now()
    where auth_user.id = v_request.better_auth_user_id
      and lower(trim(auth_user.email)) = v_request.current_email;
    get diagnostics v_updated_rows = row_count;
  exception when unique_violation then
    update public.better_auth_email_change_requests
    set revoked_at = now(), verification_token_hash = null
    where id = v_request.id;
    return jsonb_build_object('success', false);
  end;

  if v_updated_rows <> 1 then
    update public.better_auth_email_change_requests
    set revoked_at = now(), verification_token_hash = null
    where id = v_request.id;
    return jsonb_build_object('success', false);
  end if;

  update public.better_auth_email_change_requests
  set completed_at = now(), verification_token_hash = null
  where id = v_request.id;

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_offline_checkout_pack(p_pack_id uuid, p_workspace_id uuid, p_profile_id uuid, p_device_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pack_row public.offline_checkout_packs%rowtype;
  stored_item_count integer;
  stored_borrower_count integer;
begin
  if p_pack_id is null or p_workspace_id is null or p_profile_id is null
     or coalesce(btrim(p_device_id), '') = '' or char_length(p_device_id) > 128 then
    raise exception 'Invalid offline pack completion request' using errcode = '22023';
  end if;

  select * into pack_row
  from public.offline_checkout_packs
  where id = p_pack_id
    and workspace_id = p_workspace_id
    and profile_id = p_profile_id
    and device_id = p_device_id
  for update;

  if not found or pack_row.invalidated_at is not null
     or pack_row.expires_at <= now() then
    raise exception 'Offline pack is not available for completion' using errcode = '42501';
  end if;

  if pack_row.item_count + pack_row.borrower_count > 10000
     or pack_row.downloaded_bytes > 26214400 then
    raise exception 'Offline pack exceeds the server safety limit' using errcode = '22023';
  end if;

  select count(*)::integer into stored_item_count
  from public.offline_checkout_pack_items
  where pack_id = p_pack_id;
  select count(*)::integer into stored_borrower_count
  from public.offline_checkout_pack_borrowers
  where pack_id = p_pack_id;

  if stored_item_count <> pack_row.item_count
     or stored_borrower_count <> pack_row.borrower_count then
    raise exception 'Offline pack contents are incomplete' using errcode = '23514';
  end if;

  if not pack_row.download_complete then
    update public.offline_checkout_packs
    set download_complete = true
    where id = p_pack_id;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  n timestamptz := now();
  actor uuid := auth.uid();
  workspace uuid := coalesce(public.current_workspace_id(), actor);
  requested_scope text := lower(trim(coalesce(p_scope, '')));
  seconds integer;
  policy_limit integer;
  maximum integer;
  bucket timestamptz;
  next_count integer;
begin
  if actor is null then
    raise exception 'Unauthorized';
  end if;

  case requested_scope
    when 'admin' then seconds := 60; policy_limit := 30;
    when 'workspace' then seconds := 60; policy_limit := 25;
    when 'super_admin' then seconds := 60; policy_limit := 60;
    when 'offline_checkout_prepare_pack' then seconds := 60; policy_limit := 3;
    when 'offline_checkout_prepare_pack_chunk' then seconds := 60; policy_limit := 120;
    when 'offline_checkout_complete_pack' then seconds := 60; policy_limit := 3;
    when 'offline_checkout_activate_pack' then seconds := 60; policy_limit := 3;
    when 'offline_checkout_cancel_pack' then seconds := 60; policy_limit := 10;
    when 'offline_checkout_sync' then seconds := 60; policy_limit := 20;
    when 'offline_checkout_resolve' then seconds := 60; policy_limit := 20;
    when 'checkout_borrower_lookup' then seconds := 30; policy_limit := 20;
    else raise exception 'Invalid rate-limit scope';
  end case;

  maximum := least(greatest(coalesce(p_limit, 0), 1), policy_limit);
  bucket := timestamptz 'epoch' +
    floor(extract(epoch from n) / seconds) * seconds * interval '1 second';

  delete from public.rate_limits
  where workspace_id = workspace
    and actor_id = actor
    and window_start < n - make_interval(secs => seconds);

  insert into public.rate_limits(workspace_id, actor_id, scope, window_start, count)
  values (workspace, actor, requested_scope, bucket, 1)
  on conflict(workspace_id, actor_id, scope, window_start)
  do update set count = public.rate_limits.count + 1
  where public.rate_limits.count < maximum
  returning count into next_count;

  if not found then
    return query select false,
      greatest(
        ceil(extract(epoch from bucket + make_interval(secs => seconds) - n))::integer,
        0
      );
  else
    return query select true, null::integer;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n timestamptz:=now(); seconds integer:=greatest(coalesce(p_window_seconds,0),1); maximum integer:=greatest(coalesce(p_limit,0),1); bucket timestamptz:=timestamptz 'epoch'+floor(extract(epoch from n)/seconds)*seconds*interval '1 second'; next_count integer;
begin delete from public.rate_limits_prelogin where rate_key=trim(p_key) and scope=trim(p_scope) and window_start<n-make_interval(secs=>seconds); insert into public.rate_limits_prelogin(rate_key,scope,window_start,count) values(trim(p_key),trim(p_scope),bucket,1) on conflict(rate_key,scope,window_start) do update set count=public.rate_limits_prelogin.count+1 where public.rate_limits_prelogin.count<maximum returning count into next_count; if not found then return query select false,greatest(ceil(extract(epoch from bucket+make_interval(secs=>seconds)-n))::integer,0);else return query select true,null::integer;end if;end $function$
;

CREATE OR REPLACE FUNCTION public.consume_turnstile_token(p_token_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  requested_hash text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_token_hash, '')));
  now_at timestamptz := pg_catalog.clock_timestamp();
  claimed_hash text;
begin
  if requested_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into private.turnstile_token_redemptions (
    token_hash,
    redeemed_at,
    expires_at
  ) values (
    requested_hash,
    now_at,
    now_at + interval '10 minutes'
  )
  on conflict (token_hash) do update
    set redeemed_at = excluded.redeemed_at,
        expires_at = excluded.expires_at
    where private.turnstile_token_redemptions.expires_at <= now_at
  returning token_hash into claimed_hash;

  return claimed_hash is not null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_better_auth_email_change_request(p_profile_id uuid, p_new_email text, p_approval_token_hash text, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_better_auth_user_id text;
  v_current_email text;
  v_new_email text := lower(trim(coalesce(p_new_email, '')));
  v_request_id uuid;
begin
  if p_profile_id is null
     or v_new_email = ''
     or p_approval_token_hash is null
     or p_approval_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '61 minutes' then
    raise exception 'email change request is invalid';
  end if;

  select profile.better_auth_user_id
    into v_better_auth_user_id
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.is_active is true
    and profile.deleted_at is null;

  if not found or nullif(v_better_auth_user_id, '') is null then
    raise exception 'email change request is invalid';
  end if;

  perform 1
  from better_auth."user" as auth_user
  where auth_user.id = v_better_auth_user_id
  for update;

  if not found then
    raise exception 'email change request is invalid';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.better_auth_user_id = v_better_auth_user_id
    and profile.is_active is true
    and profile.deleted_at is null
  for update;

  if not found then
    raise exception 'email change request is invalid';
  end if;

  select auth_user.email into v_current_email
  from better_auth."user" as auth_user
  where auth_user.id = v_better_auth_user_id
  for update;

  v_current_email := lower(trim(coalesce(v_current_email, '')));
  if v_current_email = '' or v_current_email = v_new_email then
    raise exception 'email change request is invalid';
  end if;

  delete from public.better_auth_email_change_requests as request
  where request.expires_at <= now() - interval '30 days'
     or request.completed_at <= now() - interval '30 days'
     or request.revoked_at <= now() - interval '30 days';

  update public.better_auth_email_change_requests as request
  set revoked_at = now()
  where request.profile_id = p_profile_id
    and request.completed_at is null
    and request.revoked_at is null;

  insert into public.better_auth_email_change_requests (
    profile_id, better_auth_user_id, current_email, new_email,
    approval_token_hash, created_at, expires_at
  ) values (
    p_profile_id, v_better_auth_user_id, v_current_email, v_new_email,
    p_approval_token_hash, now(), p_expires_at
  ) returning id into v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'current_email', v_current_email
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_borrower_identity(p_workspace_id uuid, p_username text, p_borrower_id text, p_access_mode text, p_profile_ids uuid[] DEFAULT '{}'::uuid[], p_granted_by uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, workspace_id uuid, username text, borrower_id text, access_mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_username text := coalesce(trim(p_username), '');
  normalized_borrower_id text := upper(coalesce(trim(p_borrower_id), ''));
  normalized_profile_ids uuid[] := coalesce(p_profile_ids, '{}'::uuid[]);
  created_id uuid;
  actor_role text := (select current_setting('role', true));
  resolved_actor_role text;
begin
  if p_workspace_id is null or p_granted_by is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_granted_by
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';

  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if actor_role is distinct from 'service_role' then
    if p_workspace_id <> (select public.current_workspace_id())
       or resolved_actor_role <> 'workspace_admin'
       or not (select private.current_account_session_is_active()) then
      raise exception 'Unauthorized' using errcode = '42501';
    end if;
  end if;

  if p_access_mode is null
     or p_access_mode not in ('all', 'restricted')
     or (p_access_mode = 'restricted' and cardinality(normalized_profile_ids) = 0) then
    raise exception 'Access choice is required' using errcode = '22023';
  end if;
  if resolved_actor_role = 'individual_account'
     and (p_access_mode <> 'all' or cardinality(normalized_profile_ids) > 0) then
    raise exception 'Individual Account borrowers must be available to the account owner.' using errcode = '22023';
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
      from unnest(normalized_profile_ids) as target(profile_id)
      left join public.profiles as profile on profile.id = target.profile_id
      where profile.id is null
        or profile.workspace_id <> p_workspace_id
        or profile.role <> 'tenant_account'
        or not profile.is_active
        or profile.deleted_at is not null
    ) then
      raise exception 'Invalid Tenant Account grant' using errcode = '22023';
    end if;
    insert into public.borrower_access_grants(borrower_id, profile_id, granted_by)
    select created_id, profile_id, p_granted_by
    from unnest(normalized_profile_ids) as target(profile_id);
  end if;

  insert into public.admin_audit_logs(
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_granted_by,
    'borrower_create',
    'borrower',
    created_id,
    jsonb_build_object(
      'borrower_id', normalized_borrower_id,
      'username', normalized_username,
      'access_mode', p_access_mode,
      'profile_ids', case
        when p_access_mode = 'restricted' then to_jsonb(normalized_profile_ids)
        else '[]'::jsonb
      end
    )
  );

  return query
  select borrower.id, borrower.workspace_id, borrower.username,
    borrower.borrower_id, borrower.access_mode
  from public.borrowers as borrower
  where borrower.id = created_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_item_with_access_and_audit(p_workspace_id uuid, p_name text, p_barcode text, p_serial_number text, p_status text, p_notes text, p_access_mode text, p_profile_ids uuid[], p_actor_id uuid)
 RETURNS TABLE(id uuid, workspace_id uuid, name text, barcode text, serial_number text, status text, notes text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_profile_ids uuid[] := coalesce(p_profile_ids, '{}'::uuid[]);
  actor_role text := current_setting('role', true);
  resolved_actor_role text;
  created_id uuid;
begin
  if p_workspace_id is null or p_actor_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';

  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if actor_role is distinct from 'service_role' then
    if p_workspace_id <> (select public.current_workspace_id())
       or resolved_actor_role <> 'workspace_admin'
       or not (select private.current_account_session_is_active()) then
      raise exception 'Unauthorized' using errcode = '42501';
    end if;
  end if;

  if p_access_mode is null
     or p_access_mode not in ('all', 'restricted')
     or (p_access_mode = 'restricted' and cardinality(normalized_profile_ids) = 0)
     or p_name is null
     or btrim(p_name) = ''
     or p_barcode is null
     or btrim(p_barcode) = ''
     or p_status is null
     or p_status not in (
       'available', 'checked_out', 'damaged', 'lost', 'in_repair',
       'retired', 'in_studio_only'
     ) then
    raise exception 'Invalid item mutation' using errcode = '22023';
  end if;

  if resolved_actor_role = 'individual_account'
     and (p_access_mode <> 'all' or cardinality(normalized_profile_ids) > 0) then
    raise exception 'Individual Account items must be available to the account owner.' using errcode = '22023';
  end if;

  if p_access_mode = 'restricted' and exists (
    select 1
    from unnest(normalized_profile_ids) as target(profile_id)
    left join public.profiles as profile on profile.id = target.profile_id
    where profile.id is null
       or profile.workspace_id <> p_workspace_id
       or profile.role <> 'tenant_account'
       or profile.is_active is not true
       or profile.deleted_at is not null
  ) then
    raise exception 'Invalid Tenant Account grant' using errcode = '22023';
  end if;

  insert into public.items(
    workspace_id, name, barcode, serial_number, status, notes, access_mode
  ) values (
    p_workspace_id, btrim(p_name), btrim(p_barcode), nullif(btrim(p_serial_number), ''),
    p_status, nullif(btrim(p_notes), ''), p_access_mode
  ) returning items.id into created_id;

  if p_access_mode = 'restricted' then
    insert into public.item_access_grants(item_id, profile_id, granted_by)
    select created_id, target.profile_id, p_actor_id
    from unnest(normalized_profile_ids) as target(profile_id);
  end if;

  if p_status not in ('available', 'checked_out') then
    insert into public.item_status_history(
      workspace_id, item_id, status, note, changed_by
    ) values (
      p_workspace_id, created_id, p_status, nullif(btrim(p_notes), ''), p_actor_id
    );
  end if;

  insert into public.admin_audit_logs(
    workspace_id, actor_id, action_type, entity_type, entity_id, metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'item_create',
    'items',
    created_id,
    jsonb_build_object(
      'barcode', btrim(p_barcode),
      'status', p_status,
      'has_serial_number', nullif(btrim(p_serial_number), '') is not null,
      'access_mode', p_access_mode,
      'profile_ids', case when p_access_mode = 'restricted'
        then to_jsonb(normalized_profile_ids) else '[]'::jsonb end
    )
  );

  return query
  select item.id, item.workspace_id, item.name, item.barcode,
    item.serial_number, item.status, item.notes
  from public.items as item
  where item.id = created_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_workspace_account_invitation(p_workspace_id uuid, p_inviter_profile_id uuid, p_email text, p_account_role text, p_token_hash text, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace_status text;
  v_archived_at timestamptz;
  v_primary_admin_profile_id uuid;
  v_account_category text;
  v_max_admins integer;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_admin_count integer;
  v_pending_admin_invites integer;
  v_invitation_id uuid;
  v_send_email boolean := false;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if p_workspace_id is null
     or p_inviter_profile_id is null
     or v_email = ''
     or p_account_role is null
     or p_account_role not in ('tenant_account', 'workspace_admin')
     or p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '73 hours' then
    raise exception 'invalid invitation';
  end if;

  select workspace.status, workspace.archived_at,
         workspace.primary_admin_profile_id, policy.account_category,
         policy.max_admins
    into v_workspace_status, v_archived_at,
         v_primary_admin_profile_id, v_account_category, v_max_admins
  from public.workspaces as workspace
  left join public.workspace_policies as policy
    on policy.workspace_id = workspace.id
  where workspace.id = p_workspace_id
  for update of workspace;

  if not found
     or v_archived_at is not null
     or v_workspace_status is distinct from 'active'
     or v_account_category = 'individual' then
    raise exception 'workspace is unavailable';
  end if;

  select profile.workspace_id, profile.role, profile.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles as profile
  where profile.id = p_inviter_profile_id
    and profile.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from p_workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true then
    raise exception 'active workspace admin access required';
  end if;

  if p_account_role = 'workspace_admin' then
    if v_primary_admin_profile_id is distinct from p_inviter_profile_id then
      raise exception 'active primary workspace admin access required';
    end if;

    select count(*)::integer into v_admin_count
    from public.profiles as profile
    where profile.workspace_id = p_workspace_id
      and profile.role = 'workspace_admin'
      and profile.deleted_at is null;

    select count(*)::integer into v_pending_admin_invites
    from public.workspace_account_invitations as invitation
    where invitation.workspace_id = p_workspace_id
      and invitation.account_role = 'workspace_admin'
      and invitation.email <> v_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now();

    if v_max_admins is not null
       and v_admin_count + v_pending_admin_invites >= v_max_admins then
      raise exception 'workspace administrator limit reached';
    end if;
  end if;

  delete from public.workspace_account_invitations as invitation
  where invitation.expires_at <= now() - interval '30 days';

  insert into public.workspace_account_invitations as current_invitation (
    workspace_id, inviter_profile_id, email, account_role,
    token_hash, created_at, expires_at, accepted_at,
    accepted_profile_id, revoked_at
  ) values (
    p_workspace_id, p_inviter_profile_id, v_email, p_account_role,
    p_token_hash, now(), p_expires_at, null, null, null
  )
  on conflict (workspace_id, lower(email))
    where accepted_at is null and revoked_at is null
  do update set
    inviter_profile_id = excluded.inviter_profile_id,
    account_role = excluded.account_role,
    token_hash = excluded.token_hash,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at,
    accepted_profile_id = null
  where current_invitation.account_role = excluded.account_role
     or excluded.account_role = 'workspace_admin'
     or (
       excluded.account_role = 'tenant_account'
       and v_primary_admin_profile_id = p_inviter_profile_id
     )
  returning id into v_invitation_id;

  v_send_email := v_invitation_id is not null;
  return jsonb_build_object('send_email', v_send_email);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_session_binding_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when coalesce(auth.jwt() ->> 'session_id', '') <> ''
      then 'session:' || (auth.jwt() ->> 'session_id')
    else null
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active and p.deleted_at is null;
$function$
;

CREATE OR REPLACE FUNCTION public.current_workspace_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.workspace_id from public.profiles p
  where p.id = (select auth.uid()) and p.is_active and p.deleted_at is null;
$function$
;

CREATE OR REPLACE FUNCTION public.has_recent_privileged_step_up(p_role_scope text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_role_scope is not null and exists (
    select 1
    from public.privileged_session_stepups s
    where s.user_id = auth.uid()
      and s.role_scope = p_role_scope
      and s.binding_key = public.current_session_binding_key()
      and (
        p_role_scope <> 'super_admin'
        or (
          s.updated_at >= now() - interval '5 minutes'
          and s.updated_at <= now() + interval '30 seconds'
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_better_auth_session_active(p_session_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from better_auth.session as auth_session
    where auth_session.id = p_session_id
      and auth_session."expiresAt" > now()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.list_pending_legal_acceptances(p_profile_id uuid)
 RETURNS TABLE(document_type text, document_version text, document_hash text, url_path text, effective_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  profile_role text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select p.role into profile_role from public.profiles p where p.id = p_profile_id;
  if profile_role is null then
    return;
  end if;

  return query
  with current_documents as (
    select distinct on (v.document_type)
      v.document_type, v.version, v.content_sha256, v.url_path, v.effective_at
    from public.legal_document_versions v
    where v.retired_at is null
      and v.effective_at <= now()
      and profile_role = any (v.required_for_roles)
    order by v.document_type, v.effective_at desc, v.version desc
  )
  select c.document_type, c.version, c.content_sha256, c.url_path, c.effective_at
  from current_documents c
  where not exists (
    select 1 from public.legal_acceptances a
    where a.profile_id = p_profile_id
      and a.document_type = c.document_type
      and a.document_version = c.version
  )
  order by c.document_type;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_workspace_support_attachment_paths(p_workspace_id uuid)
 RETURNS TABLE(storage_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_workspace_id is null then
    raise exception 'Workspace is required' using errcode = '22023';
  end if;

  if pg_catalog.to_regclass('public.support_requests') is null
     or pg_catalog.to_regclass('public.support_request_attachments') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'support_requests'
         and column_name in ('id', 'workspace_id')
       group by table_name having count(*) = 2
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'support_request_attachments'
         and column_name in ('support_request_id', 'storage_path')
       group by table_name having count(*) = 2
     ) then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_request_attachments'
      and column_name = 'storage_bucket'
  ) then
    return query execute
      'select distinct attachment.storage_path
         from public.support_requests as request
         join public.support_request_attachments as attachment
           on attachment.support_request_id = request.id
        where request.workspace_id = $1
          and attachment.storage_path is not null
          and coalesce(attachment.storage_bucket, ''support-request-attachments'') = ''support-request-attachments''
        order by attachment.storage_path'
      using p_workspace_id;
  else
    return query execute
      'select distinct attachment.storage_path
         from public.support_requests as request
         join public.support_request_attachments as attachment
           on attachment.support_request_id = request.id
        where request.workspace_id = $1
          and attachment.storage_path is not null
        order by attachment.storage_path'
      using p_workspace_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.apply_workspace_purge_external_cleanup_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.borrower_is_in_current_workspace(p_borrower_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.borrowers borrower
    where borrower.id = p_borrower_id
      and borrower.workspace_id = (select public.current_workspace_id())
  );
$function$
;

CREATE OR REPLACE FUNCTION private.current_account_session_is_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when (select public.current_user_role()) = 'super_admin'
      then exists (
        select 1
        from better_auth.session s
        join public.profiles p on p.better_auth_user_id = s."userId"
        where p.id = (select auth.uid())
          and p.is_active
          and p.deleted_at is null
          and s.id = (select auth.jwt() ->> 'session_id')
          and s."expiresAt" > now()
      ) and (select private.super_admin_session_not_revoked())
    else exists (
      select 1
      from better_auth.session s
      join public.profiles p on p.better_auth_user_id = s."userId"
      join public.workspaces w on w.id = p.workspace_id
      where p.id = (select auth.uid())
        and p.is_active
        and p.deleted_at is null
        and w.status = 'active'
        and s.id = (select auth.jwt() ->> 'session_id')
        and s."expiresAt" > now()
        and not exists (
          select 1
          from public.account_sessions a
          where a.workspace_id = p.workspace_id
            and a.profile_id = p.id
            and a.auth_session_id = s.id
            and a.revoked_at is not null
        )
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.current_profile_can_access_borrower(p_borrower_id uuid, p_access_mode text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_access_mode = 'all' or exists (
    select 1 from public.borrower_access_grants grant_row
    where grant_row.borrower_id = p_borrower_id
      and grant_row.profile_id = (select auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION private.current_profile_can_access_item(p_item_id uuid, p_access_mode text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_access_mode = 'all' or exists (
    select 1 from public.item_access_grants grant_row
    where grant_row.item_id = p_item_id
      and grant_row.profile_id = (select auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION private.delete_better_auth_session_for_account_revoke()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from better_auth.session
  where id = old.auth_session_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.enforce_active_better_auth_workspace_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace_id uuid;
begin
  -- Invitations that are canceled or rejected cannot grant access and must
  -- remain manageable after archive. Pending and accepted invitations can
  -- grant membership, so they must stay inside an active workspace.
  if tg_table_name = 'invitation' then
    -- Better Auth marks an invitation accepted before it creates the member.
    -- If member creation then fails (for example, because archiving won the
    -- race), it compensates by restoring accepted -> pending. Permit only that
    -- status rollback, with all invitation fields otherwise unchanged.
    if tg_op = 'UPDATE'
       and old.status = 'accepted'
       and new.status = 'pending'
       and new."organizationId" = old."organizationId"
       and (to_jsonb(new) - 'status' - 'updatedAt')
         is not distinct from (to_jsonb(old) - 'status' - 'updatedAt') then
      return new;
    end if;

    if new.status not in ('pending', 'accepted') then
      return new;
    end if;
  end if;

  -- FOR SHARE conflicts with the row lock taken by workspace status updates.
  -- This serializes membership grants with archive/suspend operations instead
  -- of relying on a request-time check that can race the workspace update.
  select w.id
    into v_workspace_id
  from public.workspaces as w
  where w.better_auth_organization_id = new."organizationId"
    and w.status = 'active'
    and w.archived_at is null
  for share;

  if not found then
    raise exception 'Better Auth organization requires an active workspace';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.enforce_active_inventory_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.enforce_individual_membership_boundary()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.enforce_individual_policy_boundary()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.enforce_individual_profile_boundary()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.guard_linked_better_auth_organization_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.initialize_workspace_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.workspace_usage (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.item_is_in_current_workspace(p_item_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.items item
    where item.id = p_item_id
      and item.workspace_id = (select public.current_workspace_id())
  );
$function$
;

CREATE OR REPLACE FUNCTION private.legal_acceptances_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'profile_id' - 'workspace_id')
         is not distinct from (to_jsonb(old) - 'profile_id' - 'workspace_id')
       and (new.profile_id is null or new.profile_id is not distinct from old.profile_id)
       and (new.workspace_id is null or new.workspace_id is not distinct from old.workspace_id) then
      return new;
    end if;
  end if;
  raise exception 'legal_acceptances is append-only' using errcode = '42501';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.revoke_account_sessions_for_better_auth_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.account_sessions
  set revoked_at = coalesce(revoked_at, now())
  where auth_session_id = old.id
    and revoked_at is null;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.super_admin_session_not_revoked()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not exists (
    select 1
    from public.super_admin_sessions s
    where s.profile_id = (select auth.uid())
      and s.revoked_at is not null
      and (
        s.auth_session_id = (select auth.jwt() ->> 'session_id')
        or s.revoked_at >= to_timestamp(((select auth.jwt() ->> 'iat'))::double precision)
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.sync_better_auth_email_to_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if lower(trim(new.email)) is not distinct from lower(trim(old.email)) then
    return new;
  end if;

  update public.profiles as profile
  set auth_email = lower(trim(new.email))
  where profile.better_auth_user_id = new.id
    and profile.auth_email is distinct from lower(trim(new.email));

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.validate_workspace_primary_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if new.primary_admin_profile_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new.primary_admin_profile_id
      and p.workspace_id = new.id
      and p.role in ('workspace_admin', 'individual_account')
      and p.is_active
      and p.deleted_at is null
  ) then
    raise exception 'Primary account profile must be active in the same workspace'
      using errcode = '23514';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_workspace_better_auth_user(p_workspace_id uuid, p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace public.workspaces%rowtype;
  v_better_auth_user_id text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_profile_id is null then
    raise exception 'Invalid workspace purge user input' using errcode = '22023';
  end if;

  select * into v_workspace
  from public.workspaces
  where id = p_workspace_id
  for update;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if v_workspace.purge_state <> 'purging'
     or v_workspace.archived_at is null
     or v_workspace.purge_after is null
     or v_workspace.purge_after > pg_catalog.clock_timestamp() then
    raise exception 'Workspace is not due for purge' using errcode = '42501';
  end if;

  select profile.better_auth_user_id into v_better_auth_user_id
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.workspace_id = v_workspace.id
  for update;
  if not found then
    raise exception 'Workspace profile does not exist' using errcode = 'P0002';
  end if;

  update public.profiles
  set better_auth_user_id = null
  where id = p_profile_id
    and workspace_id = v_workspace.id;

  if v_better_auth_user_id is not null then
    delete from better_auth."user"
    where id = v_better_auth_user_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_workspace_data(p_workspace_id uuid, p_external_cleanup jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ws public.workspaces%rowtype;
  counts jsonb := '{}'::jsonb;
  external_summary jsonb;
  affected integer;
  purged_ts timestamptz;
  fk record;
  unlinked_table record;
  profile_fk record;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_workspace_id is null or jsonb_typeof(coalesce(p_external_cleanup, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid workspace purge input' using errcode = '22023';
  end if;

  select * into ws
  from public.workspaces
  where id = p_workspace_id
  for update;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if ws.purge_state <> 'purging'
     or ws.archived_at is null
     or ws.purge_after is null
     or ws.purge_after > pg_catalog.clock_timestamp() then
    raise exception 'Workspace is not due for purge' using errcode = '42501';
  end if;

  -- These workspace-scoped audit tables also refer to profiles with RESTRICT
  -- or NO ACTION semantics, so remove them before their actor profiles.
  delete from public.security_audit_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || pg_catalog.jsonb_build_object('security_audit_logs', affected);

  delete from public.admin_audit_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || pg_catalog.jsonb_build_object('admin_audit_logs', affected);

  delete from public.item_logs where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || pg_catalog.jsonb_build_object('item_logs', affected);

  -- Super-admin audit rows are workspace-associated too: metadata can contain
  -- customer names and actor_email is personal data. Keep only the separate,
  -- PII-minimized deletion certificate below.
  if pg_catalog.to_regclass('public.super_admin_audit_logs') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'super_admin_audit_logs'
         and column_name in ('target_type', 'target_id', 'metadata')
       group by table_name having count(*) = 3
     ) then
    execute
      'delete from public.super_admin_audit_logs
        where (lower(target_type) = ''workspace'' and target_id::text = $1)
           or metadata ->> ''workspace_id'' = $1'
      using ws.id::text;
    get diagnostics affected = row_count;
    counts := counts || pg_catalog.jsonb_build_object('super_admin_audit_logs', affected);
  end if;

  -- Delete every remaining non-cascading FK child of the workspace, including
  -- optional tables such as consent records, client reports, email logs, and
  -- support requests. Profiles are deleted after all of their dependent rows.
  for fk in
    select distinct
      source_ns.nspname as schema_name,
      source_rel.relname as table_name,
      source_att.attname as column_name
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class source_rel on source_rel.oid = con.conrelid
    join pg_catalog.pg_namespace source_ns on source_ns.oid = source_rel.relnamespace
    join lateral unnest(con.conkey) with ordinality source_key(attnum, position) on true
    join lateral unnest(con.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_att
      on source_att.attrelid = source_rel.oid and source_att.attnum = source_key.attnum
    join pg_catalog.pg_attribute target_att
      on target_att.attrelid = con.confrelid and target_att.attnum = target_key.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.workspaces'::regclass
      and con.confdeltype <> 'c'
      and target_att.attname = 'id'
      and source_rel.oid not in (
        'public.workspaces'::regclass,
        'public.profiles'::regclass,
        'public.workspace_deletion_certificates'::regclass
      )
      and source_rel.relname not in ('security_audit_logs', 'admin_audit_logs', 'item_logs')
    order by schema_name, table_name, column_name
  loop
    execute pg_catalog.format(
      'delete from %I.%I where %I = $1',
      fk.schema_name,
      fk.table_name,
      fk.column_name
    ) using ws.id;
    get diagnostics affected = row_count;
    counts := counts || pg_catalog.jsonb_build_object(
      fk.table_name,
      coalesce((counts ->> fk.table_name)::integer, 0) + affected
    );
  end loop;

  -- Legacy workspace_id tables without an FK (currently rate_limits) must not
  -- survive as detached customer rows. The deletion certificate is the sole
  -- intentional exception because it is the requested PII-minimized receipt.
  for unlinked_table in
    select ns.nspname as schema_name, rel.relname as table_name
    from pg_catalog.pg_class rel
    join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace
    join pg_catalog.pg_attribute att on att.attrelid = rel.oid
    where ns.nspname = 'public'
      and rel.relkind in ('r', 'p')
      and att.attname = 'workspace_id'
      and att.attnum > 0
      and not att.attisdropped
      and rel.oid not in (
        'public.workspaces'::regclass,
        'public.workspace_deletion_certificates'::regclass
      )
      and not exists (
        select 1
        from pg_catalog.pg_constraint con
        join lateral unnest(con.conkey) with ordinality source_key(attnum, position) on true
        join lateral unnest(con.confkey) with ordinality target_key(attnum, position)
          on target_key.position = source_key.position
        join pg_catalog.pg_attribute target_att
          on target_att.attrelid = con.confrelid and target_att.attnum = target_key.attnum
        where con.contype = 'f'
          and con.conrelid = rel.oid
          and con.confrelid = 'public.workspaces'::regclass
          and source_key.attnum = att.attnum
          and target_att.attname = 'id'
      )
    order by ns.nspname, rel.relname
  loop
    execute pg_catalog.format(
      'delete from %I.%I where workspace_id = $1',
      unlinked_table.schema_name,
      unlinked_table.table_name
    ) using ws.id;
    get diagnostics affected = row_count;
    counts := counts || pg_catalog.jsonb_build_object(unlinked_table.table_name, affected);
  end loop;

  select count(*) into affected from public.borrowers where workspace_id = ws.id;
  counts := counts || pg_catalog.jsonb_build_object('borrowers', affected);
  select count(*) into affected from public.items where workspace_id = ws.id;
  counts := counts || pg_catalog.jsonb_build_object('items', affected);

  -- Remove non-cascading rows that still reference this workspace's profiles,
  -- even if a legacy audit row has a null or inconsistent workspace_id. This
  -- prevents RESTRICT/NO ACTION profile FKs from aborting the purge.
  for profile_fk in
    select distinct
      source_ns.nspname as schema_name,
      source_rel.relname as table_name,
      source_att.attname as column_name
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class source_rel on source_rel.oid = con.conrelid
    join pg_catalog.pg_namespace source_ns on source_ns.oid = source_rel.relnamespace
    join lateral unnest(con.conkey) with ordinality source_key(attnum, position) on true
    join lateral unnest(con.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_att
      on source_att.attrelid = source_rel.oid and source_att.attnum = source_key.attnum
    join pg_catalog.pg_attribute target_att
      on target_att.attrelid = con.confrelid and target_att.attnum = target_key.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and con.confdeltype in ('a', 'r')
      and target_att.attname = 'id'
      and source_rel.oid not in (
        'public.profiles'::regclass,
        'public.workspace_deletion_certificates'::regclass
      )
    order by schema_name, table_name, column_name
  loop
    execute pg_catalog.format(
      'delete from %I.%I as child where child.%I in (select profile.id from public.profiles as profile where profile.workspace_id = $1)',
      profile_fk.schema_name,
      profile_fk.table_name,
      profile_fk.column_name
    ) using ws.id;
    get diagnostics affected = row_count;
    counts := counts || pg_catalog.jsonb_build_object(
      profile_fk.table_name,
      coalesce((counts ->> profile_fk.table_name)::integer, 0) + affected
    );
  end loop;

  delete from public.profiles where workspace_id = ws.id;
  get diagnostics affected = row_count;
  counts := counts || pg_catalog.jsonb_build_object('profiles', affected);

  delete from public.workspaces where id = ws.id;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Workspace purge did not delete exactly one workspace' using errcode = '40001';
  end if;

  purged_ts := pg_catalog.clock_timestamp();
  external_summary := pg_catalog.jsonb_build_object(
    'better_auth_users', case
      when coalesce(p_external_cleanup ->> 'better_auth_users', '') ~ '^[0-9]{1,9}$'
      then (p_external_cleanup ->> 'better_auth_users')::integer else 0 end,
    'support_attachment_files', case
      when coalesce(p_external_cleanup ->> 'support_attachment_files', '') ~ '^[0-9]{1,9}$'
      then (p_external_cleanup ->> 'support_attachment_files')::integer else 0 end,
    'organization_logo', case
      when coalesce(p_external_cleanup ->> 'organization_logo', '') ~ '^[0-9]{1,9}$'
      then least((p_external_cleanup ->> 'organization_logo')::integer, 1) else 0 end
  );

  insert into public.workspace_deletion_certificates (
    workspace_id, purged_at, deleted_row_counts, external_cleanup
  ) values (
    ws.id, purged_ts, counts, external_summary
  );

  return pg_catalog.jsonb_build_object(
    'workspace_id', ws.id,
    'purged_at', purged_ts,
    'deleted_row_counts', counts
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_legal_acceptance(p_profile_id uuid, p_document_type text, p_document_version text, p_document_hash text, p_ip_address text, p_user_agent text, p_acceptance_method text DEFAULT 'clickwrap'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  profile_row public.profiles%rowtype;
  registry_row public.legal_document_versions%rowtype;
  existing_row public.legal_acceptances%rowtype;
  inserted_row public.legal_acceptances%rowtype;
  parsed_ip inet;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select * into profile_row from public.profiles where id = p_profile_id;
  if not found or profile_row.is_active is not true or profile_row.deleted_at is not null then
    raise exception 'Account access denied' using errcode = '42501';
  end if;

  select * into registry_row
  from public.legal_document_versions v
  where v.document_type = p_document_type
    and v.version = p_document_version
    and v.content_sha256 = lower(p_document_hash)
    and v.retired_at is null
    and v.effective_at <= now();
  if not found then
    raise exception 'Unknown or retired legal document version' using errcode = '22023';
  end if;

  if not (profile_row.role = any (registry_row.required_for_roles)) then
    raise exception 'Document does not apply to this account' using errcode = '42501';
  end if;

  select * into existing_row
  from public.legal_acceptances a
  where a.profile_id = p_profile_id
    and a.document_type = p_document_type
    and a.document_version = p_document_version;
  if found then
    return jsonb_build_object('accepted_at', existing_row.accepted_at, 'already_accepted', true);
  end if;

  begin
    parsed_ip := nullif(btrim(p_ip_address), '')::inet;
  exception when others then
    parsed_ip := null;
  end;

  insert into public.legal_acceptances (
    profile_id, workspace_id, document_type, document_version, document_hash,
    terms_version, acceptance_method, agreement_context, ip_address, user_agent
  )
  values (
    p_profile_id, profile_row.workspace_id, p_document_type, p_document_version,
    registry_row.content_sha256, left(p_document_version, 32),
    case when p_acceptance_method in ('clickwrap', 'admin_login_clickwrap', 'signed_school_agreement')
      then p_acceptance_method else 'clickwrap' end,
    'document_acceptance', parsed_ip, left(p_user_agent, 500)
  )
  returning * into inserted_row;

  return jsonb_build_object('accepted_at', inserted_row.accepted_at, 'already_accepted', false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_super_reporting_views()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  refresh materialized view public.super_reporting_workspace_metrics;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_workspace_purge_claim(p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  update public.workspaces
  set purge_state = 'grace', purge_claimed_at = null
  where id = p_workspace_id and purge_state = 'purging';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_public_workspace_by_id(p_id uuid)
 RETURNS TABLE(id uuid, name text, slug text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select w.id, w.name, w.slug, w.status
  from public.workspaces w where w.id = p_id and w.status = 'active';
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_public_workspace_by_slug(p_slug text)
 RETURNS TABLE(id uuid, name text, slug text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select w.id, w.name, w.slug, w.status
  from public.workspaces w
  where w.slug = lower(trim(p_slug)) and w.status = 'active';
$function$
;

CREATE OR REPLACE FUNCTION public.restore_borrower_with_audit(p_workspace_id uuid, p_actor_id uuid, p_borrower_id uuid)
 RETURNS TABLE(id uuid, workspace_id uuid, username text, borrower_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resolved_actor_role text;
  archived_row record;
  restored_id uuid;
  restored_workspace_id uuid;
  restored_username text;
  restored_borrower_id text;
begin
  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select borrower.id, borrower.workspace_id, borrower.username, borrower.borrower_id, borrower.deleted_at
  into archived_row
  from public.borrowers as borrower
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is not null
  for update;
  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_id:' || upper(archived_row.borrower_id), 0));
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':username:' || lower(archived_row.username), 0));

  if exists (
    select 1
    from public.borrowers as borrower
    where borrower.workspace_id = p_workspace_id
      and borrower.id <> archived_row.id
      and borrower.deleted_at is null
      and (
        upper(borrower.borrower_id) = upper(archived_row.borrower_id)
        or lower(borrower.username) = lower(archived_row.username)
      )
  ) then
    raise exception 'Borrower ID or username already exists.' using errcode = '23505';
  end if;

  update public.borrowers as borrower
  set deleted_at = null, deleted_by = null
  where borrower.id = archived_row.id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is not null
  returning borrower.id, borrower.workspace_id, borrower.username, borrower.borrower_id
  into restored_id, restored_workspace_id, restored_username, restored_borrower_id;
  if not found then
    return;
  end if;

  insert into public.admin_audit_logs(
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'borrower_restore',
    'borrower',
    restored_id,
    jsonb_build_object(
      'borrower_id', restored_borrower_id,
      'username', restored_username,
      'previous_deleted_at', archived_row.deleted_at
    )
  );

  return query select restored_id, restored_workspace_id, restored_username, restored_borrower_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_data_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  soft_delete_cfg jsonb;
  audit_cfg jsonb;
  now_ts timestamptz := now();
  borrowers_deleted int := 0;
  items_deleted int := 0;
  admin_audit_deleted int := 0;
  super_audit_deleted int := 0;
  step_errors jsonb := '[]'::jsonb;
begin
  if to_regclass('public.data_retention_policies') is null then
    return jsonb_build_object('ran_at', now_ts, 'skipped', 'retention policy table unavailable');
  end if;

  select value into soft_delete_cfg
  from public.data_retention_policies
  where key = 'soft_delete';

  select value into audit_cfg
  from public.data_retention_policies
  where key = 'audit_logs';

  -- Each step is its own sub-transaction: a failure is recorded and the
  -- remaining steps still run.
  if coalesce((soft_delete_cfg ->> 'borrowers_enabled')::boolean, false) then
    begin
      delete from public.borrowers
      where deleted_at is not null
        and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg ->> 'borrowers_days')::int, 365)));
      get diagnostics borrowers_deleted = row_count;
    exception when others then
      step_errors := step_errors || jsonb_build_object('step', 'borrowers', 'sqlstate', sqlstate, 'message', sqlerrm);
      raise warning 'run_data_retention step borrowers failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  if coalesce((soft_delete_cfg ->> 'items_enabled')::boolean, false) then
    begin
      delete from public.items
      where deleted_at is not null
        and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg ->> 'items_days')::int, 730)));
      get diagnostics items_deleted = row_count;
    exception when others then
      step_errors := step_errors || jsonb_build_object('step', 'items', 'sqlstate', sqlstate, 'message', sqlerrm);
      raise warning 'run_data_retention step items failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  if coalesce((audit_cfg ->> 'enabled')::boolean, false) then
    begin
      delete from public.admin_audit_logs
      where created_at < now_ts - make_interval(days => greatest(30, coalesce((audit_cfg ->> 'admin_audit_days')::int, 730)));
      get diagnostics admin_audit_deleted = row_count;
    exception when others then
      step_errors := step_errors || jsonb_build_object('step', 'admin_audit_logs', 'sqlstate', sqlstate, 'message', sqlerrm);
      raise warning 'run_data_retention step admin_audit_logs failed: % (%)', sqlerrm, sqlstate;
    end;

    begin
      delete from public.super_admin_audit_logs
      where created_at < now_ts - make_interval(days => greatest(30, coalesce((audit_cfg ->> 'super_audit_days')::int, 1095)));
      get diagnostics super_audit_deleted = row_count;
    exception when others then
      step_errors := step_errors || jsonb_build_object('step', 'super_admin_audit_logs', 'sqlstate', sqlstate, 'message', sqlerrm);
      raise warning 'run_data_retention step super_admin_audit_logs failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  return jsonb_build_object(
    'ran_at', now_ts,
    'borrowers_deleted', borrowers_deleted,
    'items_deleted', items_deleted,
    'admin_audit_deleted', admin_audit_deleted,
    'super_audit_deleted', super_audit_deleted,
    'errors', step_errors
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.store_offline_checkout_pack_chunk(p_pack_id uuid, p_workspace_id uuid, p_profile_id uuid, p_device_id text, p_items jsonb, p_borrower_ids jsonb, p_chunk_bytes integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pack_row public.offline_checkout_packs%rowtype;
  stored_item_count integer;
  stored_borrower_count integer;
  new_item_count integer;
  new_borrower_count integer;
  item_chunk_size integer;
  borrower_chunk_size integer;
begin
  if p_pack_id is null or p_workspace_id is null or p_profile_id is null
     or coalesce(btrim(p_device_id), '') = '' or char_length(p_device_id) > 128
     or p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or p_borrower_ids is null or jsonb_typeof(p_borrower_ids) is distinct from 'array'
     or p_chunk_bytes is null or p_chunk_bytes < 0 or p_chunk_bytes > 1048576 then
    raise exception 'Invalid offline pack chunk' using errcode = '22023';
  end if;

  item_chunk_size := jsonb_array_length(p_items);
  borrower_chunk_size := jsonb_array_length(p_borrower_ids);
  if item_chunk_size > 100 or borrower_chunk_size > 100 then
    raise exception 'Offline pack chunk is too large' using errcode = '22023';
  end if;

  select * into pack_row
  from public.offline_checkout_packs
  where id = p_pack_id
    and workspace_id = p_workspace_id
    and profile_id = p_profile_id
    and device_id = p_device_id
  for update;

  if not found or pack_row.invalidated_at is not null
     or pack_row.expires_at <= now() or pack_row.download_complete then
    raise exception 'Offline pack is not available for chunk transfer' using errcode = '42501';
  end if;
  if pack_row.item_count + pack_row.borrower_count > 10000 then
    raise exception 'Offline pack exceeds the server safety limit' using errcode = '22023';
  end if;

  select count(*)::integer into stored_item_count
  from public.offline_checkout_pack_items where pack_id = p_pack_id;
  select count(*)::integer into stored_borrower_count
  from public.offline_checkout_pack_borrowers where pack_id = p_pack_id;
  select count(*)::integer into new_item_count
  from (
    select distinct chunk.item_id
    from jsonb_to_recordset(p_items) as chunk(item_id uuid)
  ) incoming
  where not exists (
    select 1 from public.offline_checkout_pack_items current_rows
    where current_rows.pack_id = p_pack_id and current_rows.item_id = incoming.item_id
  );
  select count(*)::integer into new_borrower_count
  from (
    select distinct chunk.borrower_id::uuid as borrower_id
    from jsonb_array_elements_text(p_borrower_ids) as chunk(borrower_id)
  ) incoming
  where not exists (
    select 1 from public.offline_checkout_pack_borrowers current_rows
    where current_rows.pack_id = p_pack_id and current_rows.borrower_id = incoming.borrower_id
  );
  if stored_item_count + new_item_count > pack_row.item_count
     or stored_borrower_count + new_borrower_count > pack_row.borrower_count then
    raise exception 'Offline pack chunk exceeds its declared size' using errcode = '22023';
  end if;
  if (new_item_count > 0 or new_borrower_count > 0)
     and (p_chunk_bytes = 0 or pack_row.downloaded_bytes + p_chunk_bytes > 26214400) then
    raise exception 'Offline pack exceeds the server byte limit' using errcode = '22023';
  end if;

  insert into public.offline_checkout_pack_items(
    pack_id, item_id, snapshot_status, snapshot_checked_out_by
  )
  select p_pack_id, chunk.item_id, chunk.snapshot_status, chunk.snapshot_checked_out_by
  from jsonb_to_recordset(p_items) as chunk(
    item_id uuid,
    snapshot_status text,
    snapshot_checked_out_by uuid
  )
  on conflict (pack_id, item_id) do nothing;

  insert into public.offline_checkout_pack_borrowers(pack_id, borrower_id)
  select p_pack_id, chunk.borrower_id::uuid
  from jsonb_array_elements_text(p_borrower_ids) as chunk(borrower_id)
  on conflict (pack_id, borrower_id) do nothing;

  select count(*)::integer into stored_item_count
  from public.offline_checkout_pack_items where pack_id = p_pack_id;
  select count(*)::integer into stored_borrower_count
  from public.offline_checkout_pack_borrowers where pack_id = p_pack_id;
  if stored_item_count > pack_row.item_count
     or stored_borrower_count > pack_row.borrower_count then
    raise exception 'Offline pack chunk exceeds its declared size' using errcode = '22023';
  end if;
  if new_item_count > 0 or new_borrower_count > 0 then
    update public.offline_checkout_packs
    set downloaded_bytes = downloaded_bytes + p_chunk_bytes
    where id = p_pack_id;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_workspace_name_from_better_auth_organization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.workspaces
  set name = new.name
  where better_auth_organization_id = new.id;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_borrower_access_with_audit(p_workspace_id uuid, p_actor_id uuid, p_borrower_id uuid, p_access_mode text, p_profile_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resolved_actor_role text;
  borrower_username text;
  borrower_identifier text;
  previous_access_mode text;
  previous_profile_ids uuid[];
  requested_profile_ids uuid[];
  applied_profile_ids uuid[];
  valid_profile_count bigint;
begin
  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';
  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_access_mode is null or p_access_mode not in ('all', 'restricted') then
    raise exception 'Access choice is required' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct requested.profile_id order by requested.profile_id), '{}'::uuid[])
  into requested_profile_ids
  from unnest(coalesce(p_profile_ids, '{}'::uuid[])) as requested(profile_id);
  if array_position(requested_profile_ids, null::uuid) is not null then
    raise exception 'Invalid Tenant Account selection.' using errcode = '22023';
  end if;

  if resolved_actor_role = 'individual_account'
     and (p_access_mode <> 'all' or cardinality(requested_profile_ids) > 0) then
    raise exception 'Individual Account borrowers must be available to the account owner.' using errcode = '22023';
  end if;
  if p_access_mode = 'restricted' and cardinality(requested_profile_ids) = 0 then
    raise exception 'Select at least one Tenant Account.' using errcode = '22023';
  end if;

  if cardinality(requested_profile_ids) > 0 then
    select count(*) into valid_profile_count
    from public.profiles as profile
    where profile.id = any(requested_profile_ids)
      and profile.workspace_id = p_workspace_id
      and profile.role = 'tenant_account'
      and profile.is_active is true
      and profile.deleted_at is null;
    if valid_profile_count <> cardinality(requested_profile_ids) then
      raise exception 'Invalid Tenant Account selection.' using errcode = '22023';
    end if;
  end if;

  select borrower.username, borrower.borrower_id, borrower.access_mode
  into borrower_username, borrower_identifier, previous_access_mode
  from public.borrowers as borrower
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is null
  for update;
  if not found then
    return false;
  end if;

  select coalesce(array_agg(grant_row.profile_id order by grant_row.profile_id), '{}'::uuid[])
  into previous_profile_ids
  from public.borrower_access_grants as grant_row
  where grant_row.borrower_id = p_borrower_id;

  applied_profile_ids := case
    when p_access_mode = 'restricted' then requested_profile_ids
    else '{}'::uuid[]
  end;

  update public.borrowers as borrower
  set access_mode = p_access_mode
  where borrower.id = p_borrower_id
    and borrower.workspace_id = p_workspace_id
    and borrower.deleted_at is null;

  delete from public.borrower_access_grants as grant_row
  where grant_row.borrower_id = p_borrower_id;

  if p_access_mode = 'restricted' then
    insert into public.borrower_access_grants(borrower_id, profile_id, granted_by)
    select p_borrower_id, requested.profile_id, p_actor_id
    from unnest(applied_profile_ids) as requested(profile_id);
  end if;

  insert into public.admin_audit_logs(
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'borrower_access_update',
    'borrower',
    p_borrower_id,
    jsonb_build_object(
      'borrower_id', borrower_identifier,
      'username', borrower_username,
      'before', jsonb_build_object(
        'access_mode', previous_access_mode,
        'profile_ids', to_jsonb(previous_profile_ids)
      ),
      'after', jsonb_build_object(
        'access_mode', p_access_mode,
        'profile_ids', to_jsonb(applied_profile_ids)
      )
    )
  );

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_item_with_access_and_audit(p_workspace_id uuid, p_item_id uuid, p_name text, p_barcode text, p_status text, p_notes text, p_access_mode text, p_profile_ids uuid[], p_actor_id uuid, p_expected_status text, p_expected_checked_out_by uuid, p_expected_checked_out_at timestamp with time zone)
 RETURNS TABLE(id uuid, workspace_id uuid, name text, barcode text, serial_number text, status text, notes text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_profile_ids uuid[] := coalesce(p_profile_ids, '{}'::uuid[]);
  actor_role text := current_setting('role', true);
  resolved_actor_role text;
  current_item public.items%rowtype;
begin
  if p_workspace_id is null or p_item_id is null or p_actor_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select profile.role
  into resolved_actor_role
  from public.profiles as profile
  join public.workspaces as workspace on workspace.id = profile.workspace_id
  where profile.id = p_actor_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('workspace_admin', 'individual_account')
    and profile.is_active is true
    and profile.deleted_at is null
    and workspace.status = 'active';

  if not found then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if actor_role is distinct from 'service_role' then
    if p_workspace_id <> (select public.current_workspace_id())
       or resolved_actor_role <> 'workspace_admin'
       or not (select private.current_account_session_is_active()) then
      raise exception 'Unauthorized' using errcode = '42501';
    end if;
  end if;

  if p_access_mode is null
     or p_access_mode not in ('all', 'restricted')
     or (p_access_mode = 'restricted' and cardinality(normalized_profile_ids) = 0)
     or p_name is null
     or btrim(p_name) = ''
     or p_barcode is null
     or btrim(p_barcode) = ''
     or p_status is null
     or p_status not in (
       'available', 'checked_out', 'damaged', 'lost', 'in_repair',
       'retired', 'in_studio_only'
     ) then
    raise exception 'Invalid item mutation' using errcode = '22023';
  end if;

  if resolved_actor_role = 'individual_account'
     and (p_access_mode <> 'all' or cardinality(normalized_profile_ids) > 0) then
    raise exception 'Individual Account items must be available to the account owner.' using errcode = '22023';
  end if;

  if p_access_mode = 'restricted' and exists (
    select 1
    from unnest(normalized_profile_ids) as target(profile_id)
    left join public.profiles as profile on profile.id = target.profile_id
    where profile.id is null
       or profile.workspace_id <> p_workspace_id
       or profile.role <> 'tenant_account'
       or profile.is_active is not true
       or profile.deleted_at is not null
  ) then
    raise exception 'Invalid Tenant Account grant' using errcode = '22023';
  end if;

  select item.*
  into current_item
  from public.items as item
  where item.id = p_item_id
    and item.workspace_id = p_workspace_id
    and item.deleted_at is null
  for update;

  if not found
     or current_item.status is distinct from p_expected_status
     or current_item.checked_out_by is distinct from p_expected_checked_out_by
     or current_item.checked_out_at is distinct from p_expected_checked_out_at then
    return;
  end if;

  if (current_item.status = 'checked_out'
      or current_item.checked_out_by is not null
      or current_item.checked_out_at is not null)
     and p_status <> 'checked_out' then
    raise exception 'Return this item before changing its checkout status.' using errcode = '22023';
  end if;

  update public.items as item
  set name = btrim(p_name),
      barcode = btrim(p_barcode),
      status = p_status,
      notes = nullif(btrim(p_notes), ''),
      access_mode = p_access_mode
  where item.id = p_item_id
    and item.workspace_id = p_workspace_id
    and item.deleted_at is null;

  delete from public.item_access_grants as grant_row
  where grant_row.item_id = p_item_id;

  if p_access_mode = 'restricted' then
    insert into public.item_access_grants(item_id, profile_id, granted_by)
    select p_item_id, target.profile_id, p_actor_id
    from unnest(normalized_profile_ids) as target(profile_id);
  end if;

  if current_item.status is distinct from p_status
     and p_status not in ('available', 'checked_out') then
    insert into public.item_status_history(
      workspace_id, item_id, status, note, changed_by
    ) values (
      p_workspace_id, p_item_id, p_status, nullif(btrim(p_notes), ''), p_actor_id
    );
  end if;

  insert into public.admin_audit_logs(
    workspace_id, actor_id, action_type, entity_type, entity_id, metadata
  ) values (
    p_workspace_id,
    p_actor_id,
    'item_update',
    'items',
    p_item_id,
    jsonb_build_object(
      'barcode', btrim(p_barcode),
      'previous_status', current_item.status,
      'status', p_status,
      'access_mode', p_access_mode,
      'profile_ids', case when p_access_mode = 'restricted'
        then to_jsonb(normalized_profile_ids) else '[]'::jsonb end
    )
  );

  return query
  select item.id, item.workspace_id, item.name, item.barcode,
    item.serial_number, item.status, item.notes
  from public.items as item
  where item.id = p_item_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.workspace_account_dashboard()
 RETURNS TABLE(profile_id uuid, auth_email text, item_count bigint, borrower_count bigint, active_checkouts bigint, overdue_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.workspace_admin_create_profile(p_actor_profile_id uuid, p_workspace_id uuid, p_profile_id uuid, p_auth_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace_status text;
  v_workspace_archived_at timestamptz;
  v_primary_admin_profile_id uuid;
  v_max_admins integer;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_admin_count integer;
begin
  select w.status, w.archived_at, w.primary_admin_profile_id, policy.max_admins
    into v_workspace_status, v_workspace_archived_at,
         v_primary_admin_profile_id, v_max_admins
  from public.workspaces as w
  left join public.workspace_policies as policy
    on policy.workspace_id = w.id
  where w.id = p_workspace_id
  for update of w;

  if not found or v_workspace_archived_at is not null or v_workspace_status is distinct from 'active' then
    raise exception 'workspace is unavailable';
  end if;

  select profile.workspace_id, profile.role, profile.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles as profile
  where profile.id = p_actor_profile_id
    and profile.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from p_workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true
     or v_primary_admin_profile_id is distinct from p_actor_profile_id then
    raise exception 'active primary workspace admin access required';
  end if;

  select count(*)::integer into v_admin_count
  from public.profiles as profile
  where profile.workspace_id = p_workspace_id
    and profile.role = 'workspace_admin'
    and profile.deleted_at is null;

  if v_max_admins is not null and v_admin_count >= v_max_admins then
    raise exception 'workspace administrator limit reached';
  end if;

  insert into public.profiles(id, workspace_id, auth_email, role, is_active)
  values (p_profile_id, p_workspace_id, p_auth_email, 'workspace_admin', true);

  return p_profile_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.workspace_admin_set_profile_role(p_actor_profile_id uuid, p_workspace_id uuid, p_profile_id uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace_status text;
  v_workspace_archived_at timestamptz;
  v_primary_admin_profile_id uuid;
  v_organization_id text;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_target_role text;
  v_better_auth_user_id text;
  v_membership_role text;
  v_updated_memberships integer;
begin
  if p_role is null or p_role not in ('tenant_account', 'workspace_admin') then
    raise exception 'invalid workspace account role';
  end if;

  select w.status, w.archived_at, w.primary_admin_profile_id,
         w.better_auth_organization_id
    into v_workspace_status, v_workspace_archived_at,
         v_primary_admin_profile_id, v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id
  for update;

  if not found or v_workspace_archived_at is not null or v_workspace_status is distinct from 'active' then
    raise exception 'workspace is unavailable';
  end if;

  select p.workspace_id, p.role, p.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles p
  where p.id = p_actor_profile_id
    and p.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from p_workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true then
    raise exception 'active workspace admin access required';
  end if;

  select p.role, p.better_auth_user_id
    into v_target_role, v_better_auth_user_id
  from public.profiles p
  where p.id = p_profile_id
    and p.workspace_id = p_workspace_id
    and p.deleted_at is null
  for update;

  if not found or v_target_role not in ('tenant_account', 'workspace_admin') then
    raise exception 'workspace account not found';
  end if;
  if p_profile_id = v_primary_admin_profile_id and p_role <> 'workspace_admin' then
    raise exception 'primary admin role cannot be changed';
  end if;
  if p_profile_id = p_actor_profile_id and p_role <> 'workspace_admin' then
    raise exception 'workspace admins cannot change their own role';
  end if;

  if v_target_role = p_role then
    return;
  end if;
  if v_better_auth_user_id is null or v_organization_id is null then
    raise exception 'workspace account identity is not fully provisioned';
  end if;

  v_membership_role := case
    when p_role = 'workspace_admin' then 'admin'
    else 'tenant_account'
  end;

  update public.profiles
  set role = p_role
  where id = p_profile_id
    and workspace_id = p_workspace_id;

  update better_auth.member
  set role = v_membership_role
  where "userId" = v_better_auth_user_id
    and "organizationId" = v_organization_id;
  get diagnostics v_updated_memberships = row_count;

  if v_updated_memberships <> 1 then
    raise exception 'workspace account membership could not be synchronized';
  end if;

  insert into public.admin_audit_logs (
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_profile_id,
    'set_workspace_account_role',
    'profile',
    p_profile_id,
    jsonb_build_object('previous_role', v_target_role, 'role', p_role)
  );
end;
$function$
;

alter table only better_auth.account alter column "createdAt" set default CURRENT_TIMESTAMP;

alter table only better_auth.invitation alter column "createdAt" set default CURRENT_TIMESTAMP;

alter table only better_auth.session alter column "createdAt" set default CURRENT_TIMESTAMP;

alter table only better_auth."ssoProvider" alter column "domainVerified" set default false;

alter table only better_auth."twoFactor" alter column "failedVerificationCount" set default 0;

alter table only better_auth."twoFactor" alter column verified set default false;

alter table only better_auth."user" alter column "createdAt" set default CURRENT_TIMESTAMP;

alter table only better_auth."user" alter column "twoFactorEnabled" set default false;

alter table only better_auth."user" alter column "updatedAt" set default CURRENT_TIMESTAMP;

alter table only better_auth.verification alter column "createdAt" set default CURRENT_TIMESTAMP;

alter table only better_auth.verification alter column "updatedAt" set default CURRENT_TIMESTAMP;

alter table only private.workspace_purge_external_cleanup alter column organization_logo_deleted_at set default clock_timestamp();

alter table only public.account_sessions alter column created_at set default now();

alter table only public.account_sessions alter column id set default gen_random_uuid();

alter table only public.account_sessions alter column last_seen_at set default now();

alter table only public.admin_audit_logs alter column created_at set default now();

alter table only public.admin_audit_logs alter column id set default gen_random_uuid();

alter table only public.app_runtime_config alter column updated_at set default now();

alter table only public.app_runtime_config alter column value set default '{}'::jsonb;

alter table only public.better_auth_email_change_requests alter column created_at set default now();

alter table only public.better_auth_email_change_requests alter column id set default gen_random_uuid();

alter table only public.borrower_access_grants alter column granted_at set default now();

alter table only public.borrowers alter column access_mode set default 'all'::text;

alter table only public.borrowers alter column created_at set default now();

alter table only public.borrowers alter column id set default gen_random_uuid();

alter table only public.customer_status_logs alter column created_at set default now();

alter table only public.customer_status_logs alter column id set default gen_random_uuid();

alter table only public.item_access_grants alter column granted_at set default now();

alter table only public.item_logs alter column action_time set default now();

alter table only public.item_logs alter column id set default gen_random_uuid();

alter table only public.item_status_history alter column changed_at set default now();

alter table only public.item_status_history alter column id set default gen_random_uuid();

alter table only public.items alter column access_mode set default 'all'::text;

alter table only public.items alter column created_at set default now();

alter table only public.items alter column id set default gen_random_uuid();

alter table only public.legal_acceptances alter column accepted_at set default now();

alter table only public.legal_acceptances alter column created_at set default now();

alter table only public.legal_acceptances alter column id set default gen_random_uuid();

alter table only public.legal_document_versions alter column created_at set default now();

alter table only public.legal_document_versions alter column effective_at set default now();

alter table only public.legal_document_versions alter column required_for_roles set default ARRAY['workspace_admin'::text, 'tenant_account'::text, 'individual_account'::text];

alter table only public.offline_checkout_conflicts alter column created_at set default now();

alter table only public.offline_checkout_conflicts alter column id set default gen_random_uuid();

alter table only public.offline_checkout_conflicts alter column status set default 'pending'::text;

alter table only public.offline_checkout_packs alter column borrower_count set default 0;

alter table only public.offline_checkout_packs alter column download_complete set default true;

alter table only public.offline_checkout_packs alter column downloaded_bytes set default 0;

alter table only public.offline_checkout_packs alter column id set default gen_random_uuid();

alter table only public.offline_checkout_packs alter column item_count set default 0;

alter table only public.offline_checkout_packs alter column prepared_at set default now();

alter table only public.privileged_session_stepups alter column created_at set default now();

alter table only public.privileged_session_stepups alter column id set default gen_random_uuid();

alter table only public.privileged_session_stepups alter column updated_at set default now();

alter table only public.profiles alter column created_at set default now();

alter table only public.profiles alter column is_active set default true;

alter table only public.rate_limits alter column count set default 0;

alter table only public.rate_limits alter column window_start set default now();

alter table only public.rate_limits_prelogin alter column count set default 0;

alter table only public.rate_limits_prelogin alter column window_start set default now();

alter table only public.sales_leads alter column created_at set default now();

alter table only public.sales_leads alter column id set default gen_random_uuid();

alter table only public.sales_leads alter column lead_state set default 'open'::text;

alter table only public.sales_leads alter column source set default 'pricing_page'::text;

alter table only public.sales_leads alter column stage set default 'waiting_for_quote'::text;

alter table only public.security_audit_logs alter column created_at set default now();

alter table only public.security_audit_logs alter column id set default gen_random_uuid();

alter table only public.super_admin_sessions alter column created_at set default now();

alter table only public.super_admin_sessions alter column id set default gen_random_uuid();

alter table only public.super_admin_sessions alter column last_seen_at set default now();

alter table only public.workspace_account_invitations alter column created_at set default now();

alter table only public.workspace_account_invitations alter column id set default gen_random_uuid();

alter table only public.workspace_deletion_certificates alter column deleted_row_counts set default '{}'::jsonb;

alter table only public.workspace_deletion_certificates alter column external_cleanup set default '{}'::jsonb;

alter table only public.workspace_deletion_certificates alter column id set default gen_random_uuid();

alter table only public.workspace_deletion_certificates alter column purged_at set default now();

alter table only public.workspace_policies alter column account_category set default 'organization'::text;

alter table only public.workspace_policies alter column checkout_due_hours set default 72;

alter table only public.workspace_policies alter column escalation_level_1_hours set default 120;

alter table only public.workspace_policies alter column escalation_level_2_hours set default 168;

alter table only public.workspace_policies alter column escalation_level_3_hours set default 240;

alter table only public.workspace_policies alter column feature_flags set default '{"enable_notifications": true, "enable_status_tracking": true, "enable_bulk_item_import": true, "enable_barcode_generator": true, "enable_bulk_student_tools": true}'::jsonb;

alter table only public.workspace_policies alter column updated_at set default now();

alter table only public.workspace_security_controls alter column updated_at set default now();

alter table only public.workspace_usage alter column active_borrowers set default 0;

alter table only public.workspace_usage alter column active_items set default 0;

alter table only public.workspace_usage alter column updated_at set default now();

alter table only public.workspaces alter column created_at set default now();

alter table only public.workspaces alter column id set default gen_random_uuid();

alter table only public.workspaces alter column purge_state set default 'none'::text;

alter table only public.workspaces alter column status set default 'active'::text;

alter table only better_auth.account add constraint account_pkey PRIMARY KEY (id);

alter table only better_auth.invitation add constraint invitation_pkey PRIMARY KEY (id);

alter table only better_auth.jwks add constraint jwks_pkey PRIMARY KEY (id);

alter table only better_auth.member add constraint "member_organizationId_userId_key" UNIQUE ("organizationId", "userId");

alter table only better_auth.member add constraint member_pkey PRIMARY KEY (id);

alter table only better_auth.organization add constraint organization_pkey PRIMARY KEY (id);

alter table only better_auth.organization add constraint organization_slug_key UNIQUE (slug);

alter table only better_auth.passkey add constraint "passkey_credentialID_key" UNIQUE ("credentialID");

alter table only better_auth.passkey add constraint passkey_pkey PRIMARY KEY (id);

alter table only better_auth.session add constraint session_pkey PRIMARY KEY (id);

alter table only better_auth.session add constraint session_token_key UNIQUE (token);

alter table only better_auth."ssoProvider" add constraint "ssoProvider_pkey" PRIMARY KEY (id);

alter table only better_auth."ssoProvider" add constraint "ssoProvider_providerId_key" UNIQUE ("providerId");

alter table only better_auth."twoFactor" add constraint "twoFactor_pkey" PRIMARY KEY (id);

alter table only better_auth."user" add constraint user_email_key UNIQUE (email);

alter table only better_auth."user" add constraint user_pkey PRIMARY KEY (id);

alter table only better_auth.verification add constraint verification_pkey PRIMARY KEY (id);

alter table only private.turnstile_token_redemptions add constraint turnstile_token_redemptions_check CHECK ((expires_at > redeemed_at));

alter table only private.turnstile_token_redemptions add constraint turnstile_token_redemptions_pkey PRIMARY KEY (token_hash);

alter table only private.turnstile_token_redemptions add constraint turnstile_token_redemptions_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text));

alter table only private.workspace_purge_external_cleanup add constraint workspace_purge_external_cleanup_pkey PRIMARY KEY (workspace_id);

alter table only public.account_sessions add constraint account_sessions_pkey PRIMARY KEY (id);

alter table only public.admin_audit_logs add constraint admin_audit_logs_pkey PRIMARY KEY (id);

alter table only public.app_runtime_config add constraint app_runtime_config_pkey PRIMARY KEY (key);

alter table only public.better_auth_email_change_requests add constraint better_auth_email_change_emails_normalized CHECK (((current_email <> ''::text) AND (current_email = lower(TRIM(BOTH FROM current_email))) AND (new_email <> ''::text) AND (new_email = lower(TRIM(BOTH FROM new_email))) AND (current_email <> new_email)));

alter table only public.better_auth_email_change_requests add constraint better_auth_email_change_requests_verification_token_hash_key UNIQUE (verification_token_hash);

alter table only public.better_auth_email_change_requests add constraint better_auth_email_change_verification_token_format CHECK (((verification_token_hash IS NULL) OR (verification_token_hash ~ '^[0-9a-f]{64}$'::text)));

alter table only public.better_auth_email_change_requests add constraint better_auth_email_change_expiry CHECK ((expires_at > created_at));

alter table only public.better_auth_email_change_requests add constraint better_auth_email_change_approval_token_format CHECK ((approval_token_hash ~ '^[0-9a-f]{64}$'::text));

alter table only public.better_auth_email_change_requests add constraint better_auth_email_change_requests_approval_token_hash_key UNIQUE (approval_token_hash);

alter table only public.better_auth_email_change_requests add constraint better_auth_email_change_requests_pkey PRIMARY KEY (id);

alter table only public.borrower_access_grants add constraint borrower_access_grants_pkey PRIMARY KEY (borrower_id, profile_id);

alter table only public.borrowers add constraint borrowers_access_mode_check CHECK ((access_mode = ANY (ARRAY['all'::text, 'restricted'::text])));

alter table only public.borrowers add constraint borrowers_pkey PRIMARY KEY (id);

alter table only public.customer_status_logs add constraint customer_status_logs_pkey PRIMARY KEY (id);

alter table only public.customer_status_logs add constraint customer_status_logs_status_check CHECK ((status = ANY (ARRAY['paid_on_time'::text, 'paid_late'::text, 'awaiting_payment'::text, 'canceling'::text])));

alter table only public.item_access_grants add constraint item_access_grants_pkey PRIMARY KEY (item_id, profile_id);

alter table only public.item_logs add constraint item_logs_pkey PRIMARY KEY (id);

alter table only public.item_status_history add constraint item_status_history_pkey PRIMARY KEY (id);

alter table only public.items add constraint item_access_mode_check CHECK ((access_mode = ANY (ARRAY['all'::text, 'restricted'::text])));

alter table only public.items add constraint item_pkey PRIMARY KEY (id);

alter table only public.legal_acceptances add constraint legal_acceptances_document_fields_check CHECK ((((document_type IS NULL) AND (document_version IS NULL) AND (document_hash IS NULL)) OR ((document_type IS NOT NULL) AND (document_version IS NOT NULL) AND (document_hash IS NOT NULL))));

alter table only public.legal_acceptances add constraint legal_acceptances_document_hash_check CHECK (((document_hash IS NULL) OR (document_hash ~ '^[0-9a-f]{64}$'::text)));

alter table only public.legal_acceptances add constraint legal_acceptances_document_type_check CHECK (((document_type IS NULL) OR (document_type = ANY (ARRAY['terms_of_service'::text, 'privacy_policy'::text, 'student_privacy_notice'::text, 'dpa'::text]))));

alter table only public.legal_acceptances add constraint legal_acceptances_document_version_check CHECK (((document_version IS NULL) OR ((length(document_version) >= 1) AND (length(document_version) <= 64))));

alter table only public.legal_acceptances add constraint legal_acceptances_ip_hash_check CHECK (((ip_hash IS NULL) OR (length(ip_hash) = 64)));

alter table only public.legal_acceptances add constraint legal_acceptances_method_check CHECK ((acceptance_method = ANY (ARRAY['admin_login_clickwrap'::text, 'signed_school_agreement'::text, 'clickwrap'::text])));

alter table only public.legal_acceptances add constraint legal_acceptances_pkey PRIMARY KEY (id);

alter table only public.legal_acceptances add constraint legal_acceptances_terms_version_check CHECK (((length(terms_version) >= 1) AND (length(terms_version) <= 32)));

alter table only public.legal_acceptances add constraint legal_acceptances_user_agent_check CHECK (((user_agent IS NULL) OR (length(user_agent) <= 500)));

alter table only public.legal_document_versions add constraint legal_document_versions_content_sha256_check CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table only public.legal_document_versions add constraint legal_document_versions_document_type_check CHECK ((document_type = ANY (ARRAY['terms_of_service'::text, 'privacy_policy'::text, 'student_privacy_notice'::text, 'dpa'::text])));

alter table only public.legal_document_versions add constraint legal_document_versions_pkey PRIMARY KEY (document_type, version);

alter table only public.legal_document_versions add constraint legal_document_versions_url_path_check CHECK ((url_path ~ '^/'::text));

alter table only public.legal_document_versions add constraint legal_document_versions_version_check CHECK (((length(version) >= 1) AND (length(version) <= 64)));

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_device_length CHECK (((char_length(device_id) >= 1) AND (char_length(device_id) <= 128)));

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_operation_length CHECK (((char_length(operation_id) >= 1) AND (char_length(operation_id) <= 128)));

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_operation_key UNIQUE (workspace_id, profile_id, operation_id);

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_payload_array CHECK ((jsonb_typeof(offline_payload) = 'array'::text));

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_pkey PRIMARY KEY (id);

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['keep_server'::text, 'apply_offline'::text]))));

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'kept_server'::text, 'applied_offline'::text])));

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_state_array CHECK ((jsonb_typeof(server_state) = 'array'::text));

alter table only public.offline_checkout_pack_borrowers add constraint offline_checkout_pack_borrowers_pkey PRIMARY KEY (pack_id, borrower_id);

alter table only public.offline_checkout_pack_items add constraint offline_checkout_pack_items_pkey PRIMARY KEY (pack_id, item_id);

alter table only public.offline_checkout_packs add constraint offline_checkout_packs_borrower_count_check CHECK ((borrower_count >= 0));

alter table only public.offline_checkout_packs add constraint offline_checkout_packs_device_length CHECK (((char_length(device_id) >= 1) AND (char_length(device_id) <= 128)));

alter table only public.offline_checkout_packs add constraint offline_checkout_packs_downloaded_bytes_check CHECK (((downloaded_bytes >= 0) AND (downloaded_bytes <= 26214400)));

alter table only public.offline_checkout_packs add constraint offline_checkout_packs_expiry CHECK (((expires_at > prepared_at) AND (expires_at <= (prepared_at + '24:00:00'::interval))));

alter table only public.offline_checkout_packs add constraint offline_checkout_packs_item_count_check CHECK ((item_count >= 0));

alter table only public.offline_checkout_packs add constraint offline_checkout_packs_pkey PRIMARY KEY (id);

alter table only public.privileged_session_stepups add constraint privileged_session_stepups_pkey PRIMARY KEY (id);

alter table only public.privileged_session_stepups add constraint privileged_session_stepups_role_scope_check CHECK ((role_scope = ANY (ARRAY['super_admin'::text, 'workspace_admin'::text, 'individual_account'::text])));

alter table only public.profiles add constraint profiles_better_auth_user_id_key UNIQUE (better_auth_user_id);

alter table only public.profiles add constraint profiles_pkey PRIMARY KEY (id);

alter table only public.profiles add constraint profiles_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'workspace_admin'::text, 'tenant_account'::text, 'individual_account'::text])));

alter table only public.rate_limits add constraint rate_limits_pkey PRIMARY KEY (workspace_id, actor_id, scope, window_start);

alter table only public.rate_limits_prelogin add constraint rate_limits_prelogin_count_nonnegative CHECK ((count >= 0));

alter table only public.rate_limits_prelogin add constraint rate_limits_prelogin_pkey PRIMARY KEY (rate_key, scope, window_start);

alter table only public.sales_leads add constraint sales_leads_lead_state_check CHECK ((lead_state = ANY (ARRAY['open'::text, 'closed'::text, 'converted_to_customer'::text])));

alter table only public.sales_leads add constraint sales_leads_pkey PRIMARY KEY (id);

alter table only public.sales_leads add constraint sales_leads_plan_check CHECK ((plan = ANY (ARRAY['workspace_core'::text, 'workspace_growth'::text, 'workspace_enterprise'::text, 'education'::text, 'custom'::text, 'individual_yearly'::text, 'individual_monthly'::text, 'other'::text])));

alter table only public.sales_leads add constraint sales_leads_schools_count_check CHECK (((schools_count IS NULL) OR (schools_count > 0)));

alter table only public.sales_leads add constraint sales_leads_stage_check CHECK ((stage = ANY (ARRAY['waiting_for_quote'::text, 'quote_generated'::text, 'quote_sent'::text, 'quote_converted_to_invoice'::text, 'invoice_sent'::text, 'invoice_paid'::text])));

alter table only public.security_audit_logs add constraint security_audit_logs_action_check CHECK ((action ~ '^[a-z][a-z0-9_.-]{0,63}$'::text));

alter table only public.security_audit_logs add constraint security_audit_logs_method_check CHECK ((method = ANY (ARRAY['GET'::text, 'HEAD'::text, 'POST'::text, 'PUT'::text, 'PATCH'::text, 'DELETE'::text])));

alter table only public.security_audit_logs add constraint security_audit_logs_pkey PRIMARY KEY (id);

alter table only public.security_audit_logs add constraint security_audit_logs_request_id_check CHECK (((length(request_id) >= 1) AND (length(request_id) <= 128)));

alter table only public.security_audit_logs add constraint security_audit_logs_route_check CHECK ((length(route) <= 256));

alter table only public.security_audit_logs add constraint security_audit_logs_target_type_check CHECK ((target_type ~ '^[a-z][a-z0-9_.-]{0,63}$'::text));

alter table only public.super_admin_sessions add constraint super_admin_sessions_pkey PRIMARY KEY (id);

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_token_hash_format CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text));

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_account_role_check CHECK ((account_role = ANY (ARRAY['tenant_account'::text, 'workspace_admin'::text])));

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_token_hash_key UNIQUE (token_hash);

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_email_normalized CHECK (((email <> ''::text) AND (email = lower(TRIM(BOTH FROM email)))));

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_expiry CHECK ((expires_at > created_at));

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_pkey PRIMARY KEY (id);

alter table only public.workspace_deletion_certificates add constraint workspace_deletion_certificates_pkey PRIMARY KEY (id);

alter table only public.workspace_policies add constraint workspace_policies_account_category_check CHECK ((account_category = ANY (ARRAY['workspace'::text, 'education'::text, 'custom'::text, 'individual'::text])));

alter table only public.workspace_policies add constraint workspace_policies_pkey PRIMARY KEY (workspace_id);

alter table only public.workspace_policies add constraint workspace_policies_plan_code_check CHECK (((plan_code = ANY (ARRAY['workspace_core'::text, 'workspace_growth'::text, 'workspace_enterprise'::text, 'education'::text, 'custom'::text, 'individual_yearly'::text, 'individual_monthly'::text])) OR (plan_code IS NULL)));

alter table only public.workspace_security_controls add constraint workspace_security_controls_pkey PRIMARY KEY (workspace_id);

alter table only public.workspace_usage add constraint workspace_usage_active_borrowers_check CHECK ((active_borrowers >= 0));

alter table only public.workspace_usage add constraint workspace_usage_active_items_check CHECK ((active_items >= 0));

alter table only public.workspace_usage add constraint workspace_usage_pkey PRIMARY KEY (workspace_id);

alter table only public.workspaces add constraint workspaces_better_auth_organization_id_key UNIQUE (better_auth_organization_id);

alter table only public.workspaces add constraint workspaces_pkey PRIMARY KEY (id);

alter table only public.workspaces add constraint workspaces_purge_state_check CHECK ((purge_state = ANY (ARRAY['none'::text, 'grace'::text, 'pending'::text, 'purging'::text, 'purged'::text])));

alter table only public.workspaces add constraint workspaces_slug_format_check CHECK ((slug ~ '^[a-z0-9-]{2,63}$'::text));

alter table only public.workspaces add constraint workspaces_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])));

alter table only better_auth.account add constraint "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;

alter table only better_auth.invitation add constraint "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;

alter table only better_auth.invitation add constraint "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES better_auth.organization(id) ON DELETE CASCADE;

alter table only better_auth.member add constraint "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES better_auth.organization(id) ON DELETE CASCADE;

alter table only better_auth.member add constraint "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;

alter table only better_auth.passkey add constraint "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;

alter table only better_auth.session add constraint "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;

alter table only better_auth."ssoProvider" add constraint "ssoProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES better_auth.organization(id) ON DELETE CASCADE;

alter table only better_auth."ssoProvider" add constraint "ssoProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;

alter table only better_auth."twoFactor" add constraint "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;

alter table only public.account_sessions add constraint account_sessions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.account_sessions add constraint account_sessions_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table only public.account_sessions add constraint account_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.admin_audit_logs add constraint admin_audit_logs_actor_id_profile_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) NOT VALID;

alter table only public.admin_audit_logs add constraint admin_audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.app_runtime_config add constraint app_runtime_config_updated_by_profile_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL NOT VALID;

alter table only public.better_auth_email_change_requests add constraint better_auth_email_change_requests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.borrower_access_grants add constraint borrower_access_grants_borrower_id_fkey FOREIGN KEY (borrower_id) REFERENCES borrowers(id) ON DELETE CASCADE;

alter table only public.borrower_access_grants add constraint borrower_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table only public.borrower_access_grants add constraint borrower_access_grants_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.borrowers add constraint borrowers_deleted_by_profile_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL NOT VALID;

alter table only public.borrowers add constraint borrowers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.customer_status_logs add constraint customer_status_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table only public.customer_status_logs add constraint customer_status_logs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES sales_leads(id) ON DELETE CASCADE;

alter table only public.item_access_grants add constraint item_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table only public.item_access_grants add constraint item_access_grants_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

alter table only public.item_access_grants add constraint item_access_grants_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.item_logs add constraint item_logs_checked_out_by_fkey FOREIGN KEY (checked_out_by) REFERENCES borrowers(id) ON DELETE SET NULL;

alter table only public.item_logs add constraint item_logs_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id);

alter table only public.item_logs add constraint item_logs_performed_by_profile_fkey FOREIGN KEY (performed_by) REFERENCES profiles(id);

alter table only public.item_logs add constraint item_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.item_status_history add constraint item_status_history_changed_by_profile_fkey FOREIGN KEY (changed_by) REFERENCES profiles(id) ON DELETE SET NULL NOT VALID;

alter table only public.item_status_history add constraint item_status_history_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

alter table only public.item_status_history add constraint item_status_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.items add constraint item_checked_out_by_fkey FOREIGN KEY (checked_out_by) REFERENCES borrowers(id) ON UPDATE CASCADE ON DELETE SET NULL;

alter table only public.items add constraint item_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.items add constraint items_deleted_by_profile_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL NOT VALID;

alter table only public.legal_acceptances add constraint legal_acceptances_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

alter table only public.legal_acceptances add constraint legal_acceptances_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES offline_checkout_packs(id) ON DELETE CASCADE;

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table only public.offline_checkout_conflicts add constraint offline_checkout_conflicts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.offline_checkout_pack_borrowers add constraint offline_checkout_pack_borrowers_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES offline_checkout_packs(id) ON DELETE CASCADE;

alter table only public.offline_checkout_pack_borrowers add constraint offline_checkout_pack_borrowers_borrower_id_fkey FOREIGN KEY (borrower_id) REFERENCES borrowers(id) ON DELETE CASCADE;

alter table only public.offline_checkout_pack_items add constraint offline_checkout_pack_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

alter table only public.offline_checkout_pack_items add constraint offline_checkout_pack_items_snapshot_checked_out_by_fkey FOREIGN KEY (snapshot_checked_out_by) REFERENCES borrowers(id) ON DELETE SET NULL;

alter table only public.offline_checkout_pack_items add constraint offline_checkout_pack_items_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES offline_checkout_packs(id) ON DELETE CASCADE;

alter table only public.offline_checkout_packs add constraint offline_checkout_packs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.offline_checkout_packs add constraint offline_checkout_packs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.privileged_session_stepups add constraint privileged_session_stepups_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.profiles add constraint profiles_better_auth_user_id_fkey FOREIGN KEY (better_auth_user_id) REFERENCES better_auth."user"(id) ON DELETE RESTRICT;

alter table only public.profiles add constraint profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

alter table only public.security_audit_logs add constraint security_audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE RESTRICT;

alter table only public.security_audit_logs add constraint security_audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

alter table only public.super_admin_sessions add constraint super_admin_sessions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.super_admin_sessions add constraint super_admin_sessions_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES profiles(id) ON DELETE SET NULL;

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_accepted_profile_id_fkey FOREIGN KEY (accepted_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.workspace_account_invitations add constraint workspace_account_invitations_inviter_profile_id_fkey FOREIGN KEY (inviter_profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table only public.workspace_policies add constraint workspace_policies_updated_by_profile_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL NOT VALID;

alter table only public.workspace_policies add constraint workspace_policies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.workspace_security_controls add constraint workspace_security_controls_updated_by_profile_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL NOT VALID;

alter table only public.workspace_security_controls add constraint workspace_security_controls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.workspace_usage add constraint workspace_usage_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table only public.workspaces add constraint workspaces_better_auth_organization_id_fkey FOREIGN KEY (better_auth_organization_id) REFERENCES better_auth.organization(id) ON DELETE SET NULL;

alter table only public.workspaces add constraint workspaces_primary_admin_profile_id_fkey FOREIGN KEY (primary_admin_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX account_sessions_auth_session_idx ON public.account_sessions USING btree (profile_id, auth_session_id) WHERE ((revoked_at IS NULL) AND (auth_session_id IS NOT NULL));

CREATE INDEX account_sessions_profile_active_idx ON public.account_sessions USING btree (workspace_id, profile_id, last_seen_at DESC) WHERE (revoked_at IS NULL);

CREATE INDEX account_sessions_revoked_by_idx ON public.account_sessions USING btree (revoked_by);

CREATE INDEX admin_audit_logs_workspace_time_idx ON public.admin_audit_logs USING btree (workspace_id, created_at DESC);

CREATE INDEX account_user_id_idx ON better_auth.account USING btree ("userId");

CREATE INDEX invitation_email_idx ON better_auth.invitation USING btree (email);

CREATE INDEX invitation_organization_id_idx ON better_auth.invitation USING btree ("organizationId");

CREATE INDEX member_organization_id_idx ON better_auth.member USING btree ("organizationId");

CREATE INDEX member_user_id_idx ON better_auth.member USING btree ("userId");

CREATE INDEX passkey_user_id_idx ON better_auth.passkey USING btree ("userId");

CREATE INDEX session_user_id_idx ON better_auth.session USING btree ("userId");

CREATE INDEX two_factor_secret_idx ON better_auth."twoFactor" USING btree (secret);

CREATE INDEX two_factor_user_id_idx ON better_auth."twoFactor" USING btree ("userId");

CREATE INDEX verification_identifier_idx ON better_auth.verification USING btree (identifier);

CREATE INDEX better_auth_email_change_expiry_idx ON public.better_auth_email_change_requests USING btree (expires_at);

CREATE UNIQUE INDEX better_auth_email_change_one_pending_per_profile ON public.better_auth_email_change_requests USING btree (profile_id) WHERE ((completed_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX borrower_access_grants_granted_by_idx ON public.borrower_access_grants USING btree (granted_by);

CREATE INDEX borrower_access_grants_profile_idx ON public.borrower_access_grants USING btree (profile_id, borrower_id);

CREATE UNIQUE INDEX borrowers_active_workspace_borrower_id_unique ON public.borrowers USING btree (workspace_id, borrower_id) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX borrowers_active_workspace_username_unique ON public.borrowers USING btree (workspace_id, lower(username)) WHERE (deleted_at IS NULL);

CREATE INDEX borrowers_workspace_deleted_idx ON public.borrowers USING btree (workspace_id, deleted_at);

CREATE INDEX customer_status_logs_lead_created_idx ON public.customer_status_logs USING btree (lead_id, created_at DESC);

CREATE UNIQUE INDEX idx_admin_audit_offline_quick_return_item ON public.admin_audit_logs USING btree (workspace_id, actor_id, ((metadata ->> 'operation_id'::text)), ((metadata ->> 'item_id'::text))) WHERE ((action_type = 'quick_return'::text) AND ((metadata ->> 'source'::text) = 'offline_replay'::text));

CREATE UNIQUE INDEX idx_item_logs_operation_conflict ON public.item_logs USING btree (workspace_id, item_id, action_type, operation_id);

CREATE INDEX idx_rate_limits_lookup ON public.rate_limits USING btree (workspace_id, actor_id, scope, window_start DESC);

CREATE INDEX idx_rate_limits_prelogin_lookup ON public.rate_limits_prelogin USING btree (rate_key, scope, window_start DESC);

CREATE INDEX item_access_grants_granted_by_idx ON public.item_access_grants USING btree (granted_by);

CREATE INDEX item_access_grants_profile_idx ON public.item_access_grants USING btree (profile_id, item_id);

CREATE UNIQUE INDEX item_active_workspace_barcode_unique ON public.items USING btree (workspace_id, barcode) WHERE ((deleted_at IS NULL) AND (barcode IS NOT NULL));

CREATE INDEX item_logs_workspace_time_idx ON public.item_logs USING btree (workspace_id, action_time DESC);

CREATE INDEX item_status_history_workspace_time_idx ON public.item_status_history USING btree (workspace_id, changed_at DESC);

CREATE INDEX item_workspace_status_deleted_idx ON public.items USING btree (workspace_id, status, deleted_at);

CREATE UNIQUE INDEX legal_acceptances_profile_document_uidx ON public.legal_acceptances USING btree (profile_id, document_type, document_version) WHERE ((profile_id IS NOT NULL) AND (document_type IS NOT NULL));

CREATE INDEX legal_acceptances_workspace_idx ON public.legal_acceptances USING btree (workspace_id, accepted_at DESC) WHERE (workspace_id IS NOT NULL);

CREATE INDEX offline_checkout_conflicts_pending_idx ON public.offline_checkout_conflicts USING btree (workspace_id, profile_id, created_at) WHERE (status = 'pending'::text);

CREATE INDEX offline_checkout_pack_items_item_idx ON public.offline_checkout_pack_items USING btree (item_id, pack_id);

CREATE INDEX offline_checkout_packs_expiry_idx ON public.offline_checkout_packs USING btree (expires_at);

CREATE INDEX offline_checkout_packs_owner_device_idx ON public.offline_checkout_packs USING btree (profile_id, device_id, prepared_at DESC);

CREATE INDEX offline_checkout_packs_workspace_id_purge_idx ON public.offline_checkout_packs USING btree (workspace_id);

CREATE INDEX turnstile_token_redemptions_expires_at_idx ON private.turnstile_token_redemptions USING btree (expires_at);

CREATE UNIQUE INDEX privileged_session_stepups_binding_uidx ON public.privileged_session_stepups USING btree (user_id, role_scope, binding_key);

CREATE INDEX privileged_session_stepups_lookup_idx ON public.privileged_session_stepups USING btree (user_id, role_scope, expires_at DESC);

CREATE INDEX profiles_workspace_id_purge_idx ON public.profiles USING btree (workspace_id);

CREATE INDEX profiles_workspace_role_active_idx ON public.profiles USING btree (workspace_id, role, is_active) WHERE (deleted_at IS NULL);

CREATE INDEX sales_leads_created_at_idx ON public.sales_leads USING btree (created_at DESC);

CREATE INDEX sales_leads_plan_idx ON public.sales_leads USING btree (plan);

CREATE INDEX sales_leads_stage_idx ON public.sales_leads USING btree (stage);

CREATE INDEX security_audit_logs_actor_time_idx ON public.security_audit_logs USING btree (actor_id, created_at DESC);

CREATE INDEX security_audit_logs_target_time_idx ON public.security_audit_logs USING btree (target_type, target_resource_id, created_at DESC);

CREATE INDEX security_audit_logs_workspace_time_idx ON public.security_audit_logs USING btree (workspace_id, created_at DESC);

CREATE INDEX super_admin_sessions_auth_session_revoked_idx ON public.super_admin_sessions USING btree (profile_id, auth_session_id, revoked_at DESC) WHERE ((auth_session_id IS NOT NULL) AND (revoked_at IS NOT NULL));

CREATE INDEX super_admin_sessions_profile_active_idx ON public.super_admin_sessions USING btree (profile_id, last_seen_at DESC) WHERE (revoked_at IS NULL);

CREATE INDEX workspace_account_invitations_expiry_idx ON public.workspace_account_invitations USING btree (expires_at);

CREATE UNIQUE INDEX workspace_account_invitations_one_pending_per_email ON public.workspace_account_invitations USING btree (workspace_id, lower(email)) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

CREATE UNIQUE INDEX workspace_deletion_certificates_workspace_uidx ON public.workspace_deletion_certificates USING btree (workspace_id);

CREATE INDEX workspaces_purge_due_idx ON public.workspaces USING btree (purge_after, purge_claimed_at, id) WHERE ((archived_at IS NOT NULL) AND (purge_after IS NOT NULL) AND (purge_state = ANY (ARRAY['grace'::text, 'purging'::text])));

CREATE UNIQUE INDEX workspaces_slug_key ON public.workspaces USING btree (slug);

create materialized view public.super_reporting_workspace_metrics as
 WITH gear_counts AS (
         SELECT items.workspace_id,
            count(*) FILTER (WHERE (items.deleted_at IS NULL)) AS gear_total,
            count(*) FILTER (WHERE ((items.deleted_at IS NULL) AND (items.status = 'checked_out'::text))) AS active_checkouts,
            count(*) FILTER (WHERE ((items.deleted_at IS NULL) AND (items.status = 'checked_out'::text) AND (items.checked_out_at < (now() - make_interval(hours => 72))))) AS overdue_items
           FROM items
          GROUP BY items.workspace_id
        ), borrower_counts AS (
         SELECT borrowers.workspace_id,
            count(*) FILTER (WHERE (borrowers.deleted_at IS NULL)) AS borrowers_total
           FROM borrowers
          GROUP BY borrowers.workspace_id
        ), tx_counts AS (
         SELECT item_logs.workspace_id,
            count(*) FILTER (WHERE (item_logs.action_time >= (now() - '7 days'::interval))) AS transactions_7d
           FROM item_logs
          GROUP BY item_logs.workspace_id
        )
 SELECT w.id AS workspace_id,
    w.name AS workspace_name,
    COALESCE(g.gear_total, (0)::bigint) AS item_total,
    COALESCE(b.borrowers_total, (0)::bigint) AS borrowers_total,
    COALESCE(g.active_checkouts, (0)::bigint) AS active_checkouts,
    COALESCE(g.overdue_items, (0)::bigint) AS overdue_items,
    COALESCE(t.transactions_7d, (0)::bigint) AS transactions_7d,
    now() AS computed_at
   FROM (((workspaces w
     LEFT JOIN gear_counts g ON ((g.workspace_id = w.id)))
     LEFT JOIN borrower_counts b ON ((b.workspace_id = w.id)))
     LEFT JOIN tx_counts t ON ((t.workspace_id = w.id)))
with no data;

CREATE UNIQUE INDEX super_reporting_workspace_metrics_workspace_idx ON public.super_reporting_workspace_metrics USING btree (workspace_id);

alter table better_auth.account enable row level security;

alter table better_auth.invitation enable row level security;

alter table better_auth.jwks enable row level security;

alter table better_auth.member enable row level security;

alter table better_auth.organization enable row level security;

alter table better_auth.passkey enable row level security;

alter table better_auth.session enable row level security;

alter table better_auth."ssoProvider" enable row level security;

alter table better_auth."twoFactor" enable row level security;

alter table better_auth."user" enable row level security;

alter table better_auth.verification enable row level security;

alter table private.turnstile_token_redemptions enable row level security;

alter table private.workspace_purge_external_cleanup enable row level security;

alter table public.account_sessions enable row level security;

alter table public.admin_audit_logs enable row level security;

alter table public.app_runtime_config enable row level security;

alter table public.better_auth_email_change_requests enable row level security;

alter table public.borrower_access_grants enable row level security;

alter table public.borrowers enable row level security;

alter table public.customer_status_logs enable row level security;

alter table public.item_access_grants enable row level security;

alter table public.item_logs enable row level security;

alter table public.item_status_history enable row level security;

alter table public.items enable row level security;

alter table public.legal_acceptances enable row level security;

alter table public.legal_document_versions enable row level security;

alter table public.offline_checkout_conflicts enable row level security;

alter table public.offline_checkout_pack_borrowers enable row level security;

alter table public.offline_checkout_pack_items enable row level security;

alter table public.offline_checkout_packs enable row level security;

alter table public.privileged_session_stepups enable row level security;

alter table public.profiles enable row level security;

alter table public.rate_limits enable row level security;

alter table public.sales_leads enable row level security;

alter table public.security_audit_logs enable row level security;

alter table public.super_admin_sessions enable row level security;

alter table public.workspace_account_invitations enable row level security;

alter table public.workspace_deletion_certificates enable row level security;

alter table public.workspace_policies enable row level security;

alter table public.workspace_security_controls enable row level security;

alter table public.workspace_usage enable row level security;

alter table public.workspaces enable row level security;

create policy account_sessions_select_own on public.account_sessions as permissive for select to authenticated using (((profile_id = ( SELECT auth.uid() AS uid)) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy admin_audit_logs_restrict_offline_quick_return on public.admin_audit_logs as restrictive for insert to authenticated with check (((action_type IS DISTINCT FROM 'quick_return'::text) OR ((metadata ->> 'source'::text) IS DISTINCT FROM 'offline_replay'::text)));

create policy individual_account_insert_audit on public.admin_audit_logs as permissive for insert to authenticated with check (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (actor_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy individual_account_select_audit on public.admin_audit_logs as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_all_audit on public.admin_audit_logs as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_admin_insert_audit on public.admin_audit_logs as permissive for insert to authenticated with check (((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (actor_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy workspace_admin_select_audit on public.admin_audit_logs as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy access_grants_tenant_account_select_borrowers on public.borrower_access_grants as permissive for select to authenticated using (((profile_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy access_grants_workspace_admin_select_borrowers on public.borrower_access_grants as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) AND ( SELECT private.borrower_is_in_current_workspace(borrower_access_grants.borrower_id) AS borrower_is_in_current_workspace) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy individual_account_select_borrowers on public.borrowers as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (deleted_at IS NULL) AND (access_mode = 'all'::text) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy individual_account_write_borrowers on public.borrowers as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (access_mode = 'all'::text) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active))) with check (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (access_mode = 'all'::text) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_all_borrowers on public.borrowers as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_members_select_borrowers on public.borrowers as permissive for select to authenticated using (((workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (deleted_at IS NULL) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active) AND ((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) OR ((( SELECT current_user_role() AS current_user_role) = 'tenant_account'::text) AND ( SELECT private.current_profile_can_access_borrower(borrowers.id, borrowers.access_mode) AS current_profile_can_access_borrower)))));

create policy super_admin_select_customer_status_logs on public.customer_status_logs as permissive for select to authenticated using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_active = true) AND (p.role = 'super_admin'::text)))) AND ( SELECT has_recent_privileged_step_up('super_admin'::text) AS has_recent_privileged_step_up) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy access_grants_tenant_account_select_items on public.item_access_grants as permissive for select to authenticated using (((profile_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy access_grants_workspace_admin_select_items on public.item_access_grants as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) AND ( SELECT private.item_is_in_current_workspace(item_access_grants.item_id) AS item_is_in_current_workspace) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy individual_account_select_item_logs on public.item_logs as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_all_item_logs on public.item_logs as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_admin_select_item_logs on public.item_logs as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy individual_account_select_item_status_history on public.item_status_history as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy individual_account_write_item_status_history on public.item_status_history as permissive for insert to authenticated with check (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_all_item_status_history on public.item_status_history as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_admin_select_item_status_history on public.item_status_history as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy individual_account_select_items on public.items as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (deleted_at IS NULL) AND (access_mode = 'all'::text) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy individual_account_write_items on public.items as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (access_mode = 'all'::text) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active))) with check (((( SELECT current_user_role() AS current_user_role) = 'individual_account'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (access_mode = 'all'::text) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_all_items on public.items as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_members_select_items on public.items as permissive for select to authenticated using (((workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND (deleted_at IS NULL) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active) AND ((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) OR ((( SELECT current_user_role() AS current_user_role) = 'tenant_account'::text) AND ( SELECT private.current_profile_can_access_item(items.id, items.access_mode) AS current_profile_can_access_item)))));

create policy self_select_profile on public.profiles as permissive for select to authenticated using (((id = ( SELECT auth.uid() AS uid)) AND is_active AND (deleted_at IS NULL)));

create policy super_admin_all_profiles on public.profiles as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_admin_select_profiles on public.profiles as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_select_sales_leads on public.sales_leads as permissive for select to authenticated using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_active = true) AND (p.role = 'super_admin'::text)))) AND ( SELECT has_recent_privileged_step_up('super_admin'::text) AS has_recent_privileged_step_up) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy super_admin_all_policies on public.workspace_policies as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_members_select_policies on public.workspace_policies as permissive for select to authenticated using (((workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_all_security_controls on public.workspace_security_controls as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_admin_select_security_controls on public.workspace_security_controls as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'workspace_admin'::text) AND (workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_all_usage on public.workspace_usage as permissive for select to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT has_recent_privileged_step_up('super_admin'::text) AS has_recent_privileged_step_up) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy workspace_members_select_usage on public.workspace_usage as permissive for select to authenticated using (((workspace_id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

create policy super_admin_all_workspaces on public.workspaces as permissive for all to authenticated using (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked))) with check (((( SELECT current_user_role() AS current_user_role) = 'super_admin'::text) AND ( SELECT private.super_admin_session_not_revoked() AS super_admin_session_not_revoked)));

create policy workspace_self_select on public.workspaces as permissive for select to authenticated using (((id = ( SELECT current_workspace_id() AS current_workspace_id)) AND ( SELECT private.current_account_session_is_active() AS current_account_session_is_active)));

CREATE TRIGGER enforce_active_workspace_lifecycle BEFORE INSERT OR UPDATE ON better_auth.invitation FOR EACH ROW EXECUTE FUNCTION private.enforce_active_better_auth_workspace_lifecycle();

CREATE TRIGGER enforce_active_workspace_lifecycle BEFORE INSERT OR UPDATE ON better_auth.member FOR EACH ROW EXECUTE FUNCTION private.enforce_active_better_auth_workspace_lifecycle();

CREATE TRIGGER enforce_individual_membership_boundary BEFORE INSERT OR UPDATE OF "organizationId", role ON better_auth.member FOR EACH ROW EXECUTE FUNCTION private.enforce_individual_membership_boundary();

CREATE TRIGGER guard_linked_workspace_delete BEFORE DELETE ON better_auth.organization FOR EACH ROW EXECUTE FUNCTION private.guard_linked_better_auth_organization_delete();

CREATE TRIGGER sync_workspace_name_from_better_auth_organization AFTER UPDATE OF name ON better_auth.organization FOR EACH ROW WHEN ((old.name IS DISTINCT FROM new.name)) EXECUTE FUNCTION sync_workspace_name_from_better_auth_organization();

CREATE TRIGGER sync_account_sessions_after_better_auth_delete AFTER DELETE ON better_auth.session FOR EACH ROW EXECUTE FUNCTION private.revoke_account_sessions_for_better_auth_delete();

CREATE TRIGGER sync_better_auth_email_to_profile AFTER UPDATE OF email ON better_auth."user" FOR EACH ROW EXECUTE FUNCTION private.sync_better_auth_email_to_profile();

CREATE TRIGGER delete_better_auth_session_after_account_revoke AFTER UPDATE OF revoked_at ON public.account_sessions FOR EACH ROW WHEN (((old.revoked_at IS NULL) AND (new.revoked_at IS NOT NULL))) EXECUTE FUNCTION private.delete_better_auth_session_for_account_revoke();

CREATE TRIGGER enforce_borrowers_active_quota BEFORE INSERT OR DELETE OR UPDATE OF deleted_at, workspace_id ON public.borrowers FOR EACH ROW EXECUTE FUNCTION private.enforce_active_inventory_quota();

CREATE TRIGGER enforce_items_active_quota BEFORE INSERT OR DELETE OR UPDATE OF deleted_at, workspace_id ON public.items FOR EACH ROW EXECUTE FUNCTION private.enforce_active_inventory_quota();

CREATE TRIGGER legal_acceptances_immutable_row BEFORE DELETE OR UPDATE ON public.legal_acceptances FOR EACH ROW EXECUTE FUNCTION private.legal_acceptances_immutable();

CREATE TRIGGER legal_acceptances_immutable_truncate BEFORE TRUNCATE ON public.legal_acceptances FOR EACH STATEMENT EXECUTE FUNCTION private.legal_acceptances_immutable();

CREATE TRIGGER enforce_individual_profile_boundary BEFORE INSERT OR UPDATE OF workspace_id, role, is_active, deleted_at ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.enforce_individual_profile_boundary();

CREATE TRIGGER apply_workspace_purge_external_cleanup_receipt BEFORE INSERT ON public.workspace_deletion_certificates FOR EACH ROW EXECUTE FUNCTION private.apply_workspace_purge_external_cleanup_receipt();

CREATE TRIGGER enforce_individual_policy_boundary BEFORE INSERT OR UPDATE OF account_category, plan_code ON public.workspace_policies FOR EACH ROW EXECUTE FUNCTION private.enforce_individual_policy_boundary();

CREATE TRIGGER initialize_workspace_usage AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION private.initialize_workspace_usage();

CREATE TRIGGER workspaces_validate_primary_admin BEFORE INSERT OR UPDATE OF primary_admin_profile_id ON public.workspaces FOR EACH ROW EXECUTE FUNCTION private.validate_workspace_primary_admin();

revoke all on schema better_auth from public, anon, authenticated, service_role;

revoke all on schema private from public, anon, authenticated, service_role;

revoke all on schema public from public, anon, authenticated, service_role;

grant USAGE on schema better_auth to service_role;

grant USAGE on schema public to anon;

grant USAGE on schema public to authenticated;

grant USAGE on schema public to postgres;

grant USAGE on schema public to service_role;

grant USAGE on schema public to public;

revoke all on table better_auth.account from public, anon, authenticated, service_role;

revoke all on table better_auth.invitation from public, anon, authenticated, service_role;

revoke all on table better_auth.jwks from public, anon, authenticated, service_role;

revoke all on table better_auth.member from public, anon, authenticated, service_role;

revoke all on table better_auth.organization from public, anon, authenticated, service_role;

revoke all on table better_auth.passkey from public, anon, authenticated, service_role;

revoke all on table better_auth.session from public, anon, authenticated, service_role;

revoke all on table better_auth."ssoProvider" from public, anon, authenticated, service_role;

revoke all on table better_auth."twoFactor" from public, anon, authenticated, service_role;

revoke all on table better_auth."user" from public, anon, authenticated, service_role;

revoke all on table better_auth.verification from public, anon, authenticated, service_role;

revoke all on table private.turnstile_token_redemptions from public, anon, authenticated, service_role;

revoke all on table private.workspace_purge_external_cleanup from public, anon, authenticated, service_role;

revoke all on table public.account_sessions from public, anon, authenticated, service_role;

revoke all on table public.admin_audit_logs from public, anon, authenticated, service_role;

revoke all on table public.app_runtime_config from public, anon, authenticated, service_role;

revoke all on table public.better_auth_email_change_requests from public, anon, authenticated, service_role;

revoke all on table public.borrower_access_grants from public, anon, authenticated, service_role;

revoke all on table public.borrowers from public, anon, authenticated, service_role;

revoke all on table public.customer_status_logs from public, anon, authenticated, service_role;

revoke all on table public.item_access_grants from public, anon, authenticated, service_role;

revoke all on table public.item_logs from public, anon, authenticated, service_role;

revoke all on table public.item_status_history from public, anon, authenticated, service_role;

revoke all on table public.items from public, anon, authenticated, service_role;

revoke all on table public.legal_acceptances from public, anon, authenticated, service_role;

revoke all on table public.legal_document_versions from public, anon, authenticated, service_role;

revoke all on table public.offline_checkout_conflicts from public, anon, authenticated, service_role;

revoke all on table public.offline_checkout_pack_borrowers from public, anon, authenticated, service_role;

revoke all on table public.offline_checkout_pack_items from public, anon, authenticated, service_role;

revoke all on table public.offline_checkout_packs from public, anon, authenticated, service_role;

revoke all on table public.privileged_session_stepups from public, anon, authenticated, service_role;

revoke all on table public.profiles from public, anon, authenticated, service_role;

revoke all on table public.rate_limits from public, anon, authenticated, service_role;

revoke all on table public.rate_limits_prelogin from public, anon, authenticated, service_role;

revoke all on table public.sales_leads from public, anon, authenticated, service_role;

revoke all on table public.security_audit_logs from public, anon, authenticated, service_role;

revoke all on table public.super_admin_sessions from public, anon, authenticated, service_role;

revoke all on table public.super_reporting_workspace_metrics from public, anon, authenticated, service_role;

revoke all on table public.workspace_account_invitations from public, anon, authenticated, service_role;

revoke all on table public.workspace_deletion_certificates from public, anon, authenticated, service_role;

revoke all on table public.workspace_policies from public, anon, authenticated, service_role;

revoke all on table public.workspace_security_controls from public, anon, authenticated, service_role;

revoke all on table public.workspace_usage from public, anon, authenticated, service_role;

revoke all on table public.workspaces from public, anon, authenticated, service_role;

grant DELETE on table better_auth.account to service_role;

grant INSERT on table better_auth.account to service_role;

grant MAINTAIN on table better_auth.account to service_role;

grant REFERENCES on table better_auth.account to service_role;

grant SELECT on table better_auth.account to service_role;

grant TRIGGER on table better_auth.account to service_role;

grant TRUNCATE on table better_auth.account to service_role;

grant UPDATE on table better_auth.account to service_role;

grant DELETE on table better_auth.invitation to service_role;

grant INSERT on table better_auth.invitation to service_role;

grant MAINTAIN on table better_auth.invitation to service_role;

grant REFERENCES on table better_auth.invitation to service_role;

grant SELECT on table better_auth.invitation to service_role;

grant TRIGGER on table better_auth.invitation to service_role;

grant TRUNCATE on table better_auth.invitation to service_role;

grant UPDATE on table better_auth.invitation to service_role;

grant DELETE on table better_auth.jwks to service_role;

grant INSERT on table better_auth.jwks to service_role;

grant MAINTAIN on table better_auth.jwks to service_role;

grant REFERENCES on table better_auth.jwks to service_role;

grant SELECT on table better_auth.jwks to service_role;

grant TRIGGER on table better_auth.jwks to service_role;

grant TRUNCATE on table better_auth.jwks to service_role;

grant UPDATE on table better_auth.jwks to service_role;

grant DELETE on table better_auth.member to service_role;

grant INSERT on table better_auth.member to service_role;

grant MAINTAIN on table better_auth.member to service_role;

grant REFERENCES on table better_auth.member to service_role;

grant SELECT on table better_auth.member to service_role;

grant TRIGGER on table better_auth.member to service_role;

grant TRUNCATE on table better_auth.member to service_role;

grant UPDATE on table better_auth.member to service_role;

grant DELETE on table better_auth.organization to service_role;

grant INSERT on table better_auth.organization to service_role;

grant MAINTAIN on table better_auth.organization to service_role;

grant REFERENCES on table better_auth.organization to service_role;

grant SELECT on table better_auth.organization to service_role;

grant TRIGGER on table better_auth.organization to service_role;

grant TRUNCATE on table better_auth.organization to service_role;

grant UPDATE on table better_auth.organization to service_role;

grant DELETE on table better_auth.passkey to service_role;

grant INSERT on table better_auth.passkey to service_role;

grant MAINTAIN on table better_auth.passkey to service_role;

grant REFERENCES on table better_auth.passkey to service_role;

grant SELECT on table better_auth.passkey to service_role;

grant TRIGGER on table better_auth.passkey to service_role;

grant TRUNCATE on table better_auth.passkey to service_role;

grant UPDATE on table better_auth.passkey to service_role;

grant DELETE on table better_auth.session to service_role;

grant INSERT on table better_auth.session to service_role;

grant MAINTAIN on table better_auth.session to service_role;

grant REFERENCES on table better_auth.session to service_role;

grant SELECT on table better_auth.session to service_role;

grant TRIGGER on table better_auth.session to service_role;

grant TRUNCATE on table better_auth.session to service_role;

grant UPDATE on table better_auth.session to service_role;

grant DELETE on table better_auth."ssoProvider" to service_role;

grant INSERT on table better_auth."ssoProvider" to service_role;

grant MAINTAIN on table better_auth."ssoProvider" to service_role;

grant REFERENCES on table better_auth."ssoProvider" to service_role;

grant SELECT on table better_auth."ssoProvider" to service_role;

grant TRIGGER on table better_auth."ssoProvider" to service_role;

grant TRUNCATE on table better_auth."ssoProvider" to service_role;

grant UPDATE on table better_auth."ssoProvider" to service_role;

grant DELETE on table better_auth."twoFactor" to service_role;

grant INSERT on table better_auth."twoFactor" to service_role;

grant MAINTAIN on table better_auth."twoFactor" to service_role;

grant REFERENCES on table better_auth."twoFactor" to service_role;

grant SELECT on table better_auth."twoFactor" to service_role;

grant TRIGGER on table better_auth."twoFactor" to service_role;

grant TRUNCATE on table better_auth."twoFactor" to service_role;

grant UPDATE on table better_auth."twoFactor" to service_role;

grant DELETE on table better_auth."user" to service_role;

grant INSERT on table better_auth."user" to service_role;

grant MAINTAIN on table better_auth."user" to service_role;

grant REFERENCES on table better_auth."user" to service_role;

grant SELECT on table better_auth."user" to service_role;

grant TRIGGER on table better_auth."user" to service_role;

grant TRUNCATE on table better_auth."user" to service_role;

grant UPDATE on table better_auth."user" to service_role;

grant DELETE on table better_auth.verification to service_role;

grant INSERT on table better_auth.verification to service_role;

grant MAINTAIN on table better_auth.verification to service_role;

grant REFERENCES on table better_auth.verification to service_role;

grant SELECT on table better_auth.verification to service_role;

grant TRIGGER on table better_auth.verification to service_role;

grant TRUNCATE on table better_auth.verification to service_role;

grant UPDATE on table better_auth.verification to service_role;

grant DELETE on table public.account_sessions to anon;

grant INSERT on table public.account_sessions to anon;

grant MAINTAIN on table public.account_sessions to anon;

grant REFERENCES on table public.account_sessions to anon;

grant SELECT on table public.account_sessions to anon;

grant TRIGGER on table public.account_sessions to anon;

grant TRUNCATE on table public.account_sessions to anon;

grant UPDATE on table public.account_sessions to anon;

grant DELETE on table public.account_sessions to authenticated;

grant INSERT on table public.account_sessions to authenticated;

grant MAINTAIN on table public.account_sessions to authenticated;

grant REFERENCES on table public.account_sessions to authenticated;

grant SELECT on table public.account_sessions to authenticated;

grant TRIGGER on table public.account_sessions to authenticated;

grant TRUNCATE on table public.account_sessions to authenticated;

grant UPDATE on table public.account_sessions to authenticated;

grant DELETE on table public.account_sessions to service_role;

grant INSERT on table public.account_sessions to service_role;

grant MAINTAIN on table public.account_sessions to service_role;

grant REFERENCES on table public.account_sessions to service_role;

grant SELECT on table public.account_sessions to service_role;

grant TRIGGER on table public.account_sessions to service_role;

grant TRUNCATE on table public.account_sessions to service_role;

grant UPDATE on table public.account_sessions to service_role;

grant DELETE on table public.admin_audit_logs to anon;

grant INSERT on table public.admin_audit_logs to anon;

grant MAINTAIN on table public.admin_audit_logs to anon;

grant REFERENCES on table public.admin_audit_logs to anon;

grant SELECT on table public.admin_audit_logs to anon;

grant TRIGGER on table public.admin_audit_logs to anon;

grant TRUNCATE on table public.admin_audit_logs to anon;

grant UPDATE on table public.admin_audit_logs to anon;

grant INSERT on table public.admin_audit_logs to authenticated;

grant MAINTAIN on table public.admin_audit_logs to authenticated;

grant REFERENCES on table public.admin_audit_logs to authenticated;

grant SELECT on table public.admin_audit_logs to authenticated;

grant TRIGGER on table public.admin_audit_logs to authenticated;

grant TRUNCATE on table public.admin_audit_logs to authenticated;

grant DELETE on table public.admin_audit_logs to service_role;

grant INSERT on table public.admin_audit_logs to service_role;

grant MAINTAIN on table public.admin_audit_logs to service_role;

grant REFERENCES on table public.admin_audit_logs to service_role;

grant SELECT on table public.admin_audit_logs to service_role;

grant TRIGGER on table public.admin_audit_logs to service_role;

grant TRUNCATE on table public.admin_audit_logs to service_role;

grant UPDATE on table public.admin_audit_logs to service_role;

grant DELETE on table public.app_runtime_config to service_role;

grant INSERT on table public.app_runtime_config to service_role;

grant MAINTAIN on table public.app_runtime_config to service_role;

grant REFERENCES on table public.app_runtime_config to service_role;

grant SELECT on table public.app_runtime_config to service_role;

grant TRIGGER on table public.app_runtime_config to service_role;

grant TRUNCATE on table public.app_runtime_config to service_role;

grant UPDATE on table public.app_runtime_config to service_role;

grant DELETE on table public.better_auth_email_change_requests to service_role;

grant INSERT on table public.better_auth_email_change_requests to service_role;

grant MAINTAIN on table public.better_auth_email_change_requests to service_role;

grant REFERENCES on table public.better_auth_email_change_requests to service_role;

grant SELECT on table public.better_auth_email_change_requests to service_role;

grant TRIGGER on table public.better_auth_email_change_requests to service_role;

grant TRUNCATE on table public.better_auth_email_change_requests to service_role;

grant UPDATE on table public.better_auth_email_change_requests to service_role;

grant DELETE on table public.borrower_access_grants to anon;

grant INSERT on table public.borrower_access_grants to anon;

grant MAINTAIN on table public.borrower_access_grants to anon;

grant REFERENCES on table public.borrower_access_grants to anon;

grant SELECT on table public.borrower_access_grants to anon;

grant TRIGGER on table public.borrower_access_grants to anon;

grant TRUNCATE on table public.borrower_access_grants to anon;

grant UPDATE on table public.borrower_access_grants to anon;

grant MAINTAIN on table public.borrower_access_grants to authenticated;

grant REFERENCES on table public.borrower_access_grants to authenticated;

grant SELECT on table public.borrower_access_grants to authenticated;

grant TRIGGER on table public.borrower_access_grants to authenticated;

grant TRUNCATE on table public.borrower_access_grants to authenticated;

grant DELETE on table public.borrower_access_grants to service_role;

grant INSERT on table public.borrower_access_grants to service_role;

grant MAINTAIN on table public.borrower_access_grants to service_role;

grant REFERENCES on table public.borrower_access_grants to service_role;

grant SELECT on table public.borrower_access_grants to service_role;

grant TRIGGER on table public.borrower_access_grants to service_role;

grant TRUNCATE on table public.borrower_access_grants to service_role;

grant UPDATE on table public.borrower_access_grants to service_role;

grant DELETE on table public.borrowers to anon;

grant INSERT on table public.borrowers to anon;

grant MAINTAIN on table public.borrowers to anon;

grant REFERENCES on table public.borrowers to anon;

grant SELECT on table public.borrowers to anon;

grant TRIGGER on table public.borrowers to anon;

grant TRUNCATE on table public.borrowers to anon;

grant UPDATE on table public.borrowers to anon;

grant MAINTAIN on table public.borrowers to authenticated;

grant REFERENCES on table public.borrowers to authenticated;

grant SELECT on table public.borrowers to authenticated;

grant TRIGGER on table public.borrowers to authenticated;

grant TRUNCATE on table public.borrowers to authenticated;

grant DELETE on table public.borrowers to service_role;

grant INSERT on table public.borrowers to service_role;

grant MAINTAIN on table public.borrowers to service_role;

grant REFERENCES on table public.borrowers to service_role;

grant SELECT on table public.borrowers to service_role;

grant TRIGGER on table public.borrowers to service_role;

grant TRUNCATE on table public.borrowers to service_role;

grant UPDATE on table public.borrowers to service_role;

grant DELETE on table public.customer_status_logs to anon;

grant INSERT on table public.customer_status_logs to anon;

grant MAINTAIN on table public.customer_status_logs to anon;

grant REFERENCES on table public.customer_status_logs to anon;

grant SELECT on table public.customer_status_logs to anon;

grant TRIGGER on table public.customer_status_logs to anon;

grant TRUNCATE on table public.customer_status_logs to anon;

grant UPDATE on table public.customer_status_logs to anon;

grant DELETE on table public.customer_status_logs to authenticated;

grant INSERT on table public.customer_status_logs to authenticated;

grant MAINTAIN on table public.customer_status_logs to authenticated;

grant REFERENCES on table public.customer_status_logs to authenticated;

grant SELECT on table public.customer_status_logs to authenticated;

grant TRIGGER on table public.customer_status_logs to authenticated;

grant TRUNCATE on table public.customer_status_logs to authenticated;

grant UPDATE on table public.customer_status_logs to authenticated;

grant DELETE on table public.customer_status_logs to service_role;

grant INSERT on table public.customer_status_logs to service_role;

grant MAINTAIN on table public.customer_status_logs to service_role;

grant REFERENCES on table public.customer_status_logs to service_role;

grant SELECT on table public.customer_status_logs to service_role;

grant TRIGGER on table public.customer_status_logs to service_role;

grant TRUNCATE on table public.customer_status_logs to service_role;

grant UPDATE on table public.customer_status_logs to service_role;

grant DELETE on table public.item_access_grants to anon;

grant INSERT on table public.item_access_grants to anon;

grant MAINTAIN on table public.item_access_grants to anon;

grant REFERENCES on table public.item_access_grants to anon;

grant SELECT on table public.item_access_grants to anon;

grant TRIGGER on table public.item_access_grants to anon;

grant TRUNCATE on table public.item_access_grants to anon;

grant UPDATE on table public.item_access_grants to anon;

grant MAINTAIN on table public.item_access_grants to authenticated;

grant REFERENCES on table public.item_access_grants to authenticated;

grant SELECT on table public.item_access_grants to authenticated;

grant TRIGGER on table public.item_access_grants to authenticated;

grant TRUNCATE on table public.item_access_grants to authenticated;

grant DELETE on table public.item_access_grants to service_role;

grant INSERT on table public.item_access_grants to service_role;

grant MAINTAIN on table public.item_access_grants to service_role;

grant REFERENCES on table public.item_access_grants to service_role;

grant SELECT on table public.item_access_grants to service_role;

grant TRIGGER on table public.item_access_grants to service_role;

grant TRUNCATE on table public.item_access_grants to service_role;

grant UPDATE on table public.item_access_grants to service_role;

grant DELETE on table public.item_logs to anon;

grant INSERT on table public.item_logs to anon;

grant MAINTAIN on table public.item_logs to anon;

grant REFERENCES on table public.item_logs to anon;

grant SELECT on table public.item_logs to anon;

grant TRIGGER on table public.item_logs to anon;

grant TRUNCATE on table public.item_logs to anon;

grant UPDATE on table public.item_logs to anon;

grant DELETE on table public.item_logs to authenticated;

grant INSERT on table public.item_logs to authenticated;

grant MAINTAIN on table public.item_logs to authenticated;

grant REFERENCES on table public.item_logs to authenticated;

grant SELECT on table public.item_logs to authenticated;

grant TRIGGER on table public.item_logs to authenticated;

grant TRUNCATE on table public.item_logs to authenticated;

grant UPDATE on table public.item_logs to authenticated;

grant DELETE on table public.item_logs to service_role;

grant INSERT on table public.item_logs to service_role;

grant MAINTAIN on table public.item_logs to service_role;

grant REFERENCES on table public.item_logs to service_role;

grant SELECT on table public.item_logs to service_role;

grant TRIGGER on table public.item_logs to service_role;

grant TRUNCATE on table public.item_logs to service_role;

grant UPDATE on table public.item_logs to service_role;

grant DELETE on table public.item_status_history to anon;

grant INSERT on table public.item_status_history to anon;

grant MAINTAIN on table public.item_status_history to anon;

grant REFERENCES on table public.item_status_history to anon;

grant SELECT on table public.item_status_history to anon;

grant TRIGGER on table public.item_status_history to anon;

grant TRUNCATE on table public.item_status_history to anon;

grant UPDATE on table public.item_status_history to anon;

grant MAINTAIN on table public.item_status_history to authenticated;

grant REFERENCES on table public.item_status_history to authenticated;

grant SELECT on table public.item_status_history to authenticated;

grant TRIGGER on table public.item_status_history to authenticated;

grant TRUNCATE on table public.item_status_history to authenticated;

grant DELETE on table public.item_status_history to service_role;

grant INSERT on table public.item_status_history to service_role;

grant MAINTAIN on table public.item_status_history to service_role;

grant REFERENCES on table public.item_status_history to service_role;

grant SELECT on table public.item_status_history to service_role;

grant TRIGGER on table public.item_status_history to service_role;

grant TRUNCATE on table public.item_status_history to service_role;

grant UPDATE on table public.item_status_history to service_role;

grant DELETE on table public.items to anon;

grant INSERT on table public.items to anon;

grant MAINTAIN on table public.items to anon;

grant REFERENCES on table public.items to anon;

grant SELECT on table public.items to anon;

grant TRIGGER on table public.items to anon;

grant TRUNCATE on table public.items to anon;

grant UPDATE on table public.items to anon;

grant MAINTAIN on table public.items to authenticated;

grant REFERENCES on table public.items to authenticated;

grant SELECT on table public.items to authenticated;

grant TRIGGER on table public.items to authenticated;

grant TRUNCATE on table public.items to authenticated;

grant DELETE on table public.items to service_role;

grant INSERT on table public.items to service_role;

grant MAINTAIN on table public.items to service_role;

grant REFERENCES on table public.items to service_role;

grant SELECT on table public.items to service_role;

grant TRIGGER on table public.items to service_role;

grant TRUNCATE on table public.items to service_role;

grant UPDATE on table public.items to service_role;

grant INSERT on table public.legal_acceptances to service_role;

grant MAINTAIN on table public.legal_acceptances to service_role;

grant REFERENCES on table public.legal_acceptances to service_role;

grant SELECT on table public.legal_acceptances to service_role;

grant TRIGGER on table public.legal_acceptances to service_role;

grant DELETE on table public.legal_document_versions to service_role;

grant INSERT on table public.legal_document_versions to service_role;

grant MAINTAIN on table public.legal_document_versions to service_role;

grant REFERENCES on table public.legal_document_versions to service_role;

grant SELECT on table public.legal_document_versions to service_role;

grant TRIGGER on table public.legal_document_versions to service_role;

grant TRUNCATE on table public.legal_document_versions to service_role;

grant UPDATE on table public.legal_document_versions to service_role;

grant DELETE on table public.offline_checkout_conflicts to service_role;

grant INSERT on table public.offline_checkout_conflicts to service_role;

grant MAINTAIN on table public.offline_checkout_conflicts to service_role;

grant REFERENCES on table public.offline_checkout_conflicts to service_role;

grant SELECT on table public.offline_checkout_conflicts to service_role;

grant TRIGGER on table public.offline_checkout_conflicts to service_role;

grant TRUNCATE on table public.offline_checkout_conflicts to service_role;

grant UPDATE on table public.offline_checkout_conflicts to service_role;

grant DELETE on table public.offline_checkout_pack_borrowers to service_role;

grant INSERT on table public.offline_checkout_pack_borrowers to service_role;

grant MAINTAIN on table public.offline_checkout_pack_borrowers to service_role;

grant REFERENCES on table public.offline_checkout_pack_borrowers to service_role;

grant SELECT on table public.offline_checkout_pack_borrowers to service_role;

grant TRIGGER on table public.offline_checkout_pack_borrowers to service_role;

grant TRUNCATE on table public.offline_checkout_pack_borrowers to service_role;

grant UPDATE on table public.offline_checkout_pack_borrowers to service_role;

grant DELETE on table public.offline_checkout_pack_items to service_role;

grant INSERT on table public.offline_checkout_pack_items to service_role;

grant MAINTAIN on table public.offline_checkout_pack_items to service_role;

grant REFERENCES on table public.offline_checkout_pack_items to service_role;

grant SELECT on table public.offline_checkout_pack_items to service_role;

grant TRIGGER on table public.offline_checkout_pack_items to service_role;

grant TRUNCATE on table public.offline_checkout_pack_items to service_role;

grant UPDATE on table public.offline_checkout_pack_items to service_role;

grant DELETE on table public.offline_checkout_packs to service_role;

grant INSERT on table public.offline_checkout_packs to service_role;

grant MAINTAIN on table public.offline_checkout_packs to service_role;

grant REFERENCES on table public.offline_checkout_packs to service_role;

grant SELECT on table public.offline_checkout_packs to service_role;

grant TRIGGER on table public.offline_checkout_packs to service_role;

grant TRUNCATE on table public.offline_checkout_packs to service_role;

grant UPDATE on table public.offline_checkout_packs to service_role;

grant DELETE on table public.privileged_session_stepups to service_role;

grant INSERT on table public.privileged_session_stepups to service_role;

grant MAINTAIN on table public.privileged_session_stepups to service_role;

grant REFERENCES on table public.privileged_session_stepups to service_role;

grant SELECT on table public.privileged_session_stepups to service_role;

grant TRIGGER on table public.privileged_session_stepups to service_role;

grant TRUNCATE on table public.privileged_session_stepups to service_role;

grant UPDATE on table public.privileged_session_stepups to service_role;

grant DELETE on table public.profiles to anon;

grant INSERT on table public.profiles to anon;

grant MAINTAIN on table public.profiles to anon;

grant REFERENCES on table public.profiles to anon;

grant SELECT on table public.profiles to anon;

grant TRIGGER on table public.profiles to anon;

grant TRUNCATE on table public.profiles to anon;

grant UPDATE on table public.profiles to anon;

grant DELETE on table public.profiles to authenticated;

grant INSERT on table public.profiles to authenticated;

grant MAINTAIN on table public.profiles to authenticated;

grant REFERENCES on table public.profiles to authenticated;

grant SELECT on table public.profiles to authenticated;

grant TRIGGER on table public.profiles to authenticated;

grant TRUNCATE on table public.profiles to authenticated;

grant UPDATE on table public.profiles to authenticated;

grant DELETE on table public.profiles to service_role;

grant INSERT on table public.profiles to service_role;

grant MAINTAIN on table public.profiles to service_role;

grant REFERENCES on table public.profiles to service_role;

grant SELECT on table public.profiles to service_role;

grant TRIGGER on table public.profiles to service_role;

grant TRUNCATE on table public.profiles to service_role;

grant UPDATE on table public.profiles to service_role;

grant DELETE on table public.rate_limits to service_role;

grant INSERT on table public.rate_limits to service_role;

grant MAINTAIN on table public.rate_limits to service_role;

grant REFERENCES on table public.rate_limits to service_role;

grant SELECT on table public.rate_limits to service_role;

grant TRIGGER on table public.rate_limits to service_role;

grant TRUNCATE on table public.rate_limits to service_role;

grant UPDATE on table public.rate_limits to service_role;

grant DELETE on table public.rate_limits_prelogin to service_role;

grant INSERT on table public.rate_limits_prelogin to service_role;

grant MAINTAIN on table public.rate_limits_prelogin to service_role;

grant REFERENCES on table public.rate_limits_prelogin to service_role;

grant SELECT on table public.rate_limits_prelogin to service_role;

grant TRIGGER on table public.rate_limits_prelogin to service_role;

grant TRUNCATE on table public.rate_limits_prelogin to service_role;

grant UPDATE on table public.rate_limits_prelogin to service_role;

grant DELETE on table public.sales_leads to anon;

grant INSERT on table public.sales_leads to anon;

grant MAINTAIN on table public.sales_leads to anon;

grant REFERENCES on table public.sales_leads to anon;

grant SELECT on table public.sales_leads to anon;

grant TRIGGER on table public.sales_leads to anon;

grant TRUNCATE on table public.sales_leads to anon;

grant UPDATE on table public.sales_leads to anon;

grant DELETE on table public.sales_leads to authenticated;

grant INSERT on table public.sales_leads to authenticated;

grant MAINTAIN on table public.sales_leads to authenticated;

grant REFERENCES on table public.sales_leads to authenticated;

grant SELECT on table public.sales_leads to authenticated;

grant TRIGGER on table public.sales_leads to authenticated;

grant TRUNCATE on table public.sales_leads to authenticated;

grant UPDATE on table public.sales_leads to authenticated;

grant DELETE on table public.sales_leads to service_role;

grant INSERT on table public.sales_leads to service_role;

grant MAINTAIN on table public.sales_leads to service_role;

grant REFERENCES on table public.sales_leads to service_role;

grant SELECT on table public.sales_leads to service_role;

grant TRIGGER on table public.sales_leads to service_role;

grant TRUNCATE on table public.sales_leads to service_role;

grant UPDATE on table public.sales_leads to service_role;

grant DELETE on table public.security_audit_logs to service_role;

grant INSERT on table public.security_audit_logs to service_role;

grant MAINTAIN on table public.security_audit_logs to service_role;

grant REFERENCES on table public.security_audit_logs to service_role;

grant SELECT on table public.security_audit_logs to service_role;

grant TRIGGER on table public.security_audit_logs to service_role;

grant TRUNCATE on table public.security_audit_logs to service_role;

grant UPDATE on table public.security_audit_logs to service_role;

grant DELETE on table public.super_admin_sessions to service_role;

grant INSERT on table public.super_admin_sessions to service_role;

grant MAINTAIN on table public.super_admin_sessions to service_role;

grant REFERENCES on table public.super_admin_sessions to service_role;

grant SELECT on table public.super_admin_sessions to service_role;

grant TRIGGER on table public.super_admin_sessions to service_role;

grant TRUNCATE on table public.super_admin_sessions to service_role;

grant UPDATE on table public.super_admin_sessions to service_role;

grant DELETE on table public.super_reporting_workspace_metrics to service_role;

grant INSERT on table public.super_reporting_workspace_metrics to service_role;

grant MAINTAIN on table public.super_reporting_workspace_metrics to service_role;

grant REFERENCES on table public.super_reporting_workspace_metrics to service_role;

grant SELECT on table public.super_reporting_workspace_metrics to service_role;

grant TRIGGER on table public.super_reporting_workspace_metrics to service_role;

grant TRUNCATE on table public.super_reporting_workspace_metrics to service_role;

grant UPDATE on table public.super_reporting_workspace_metrics to service_role;

grant DELETE on table public.workspace_account_invitations to service_role;

grant INSERT on table public.workspace_account_invitations to service_role;

grant MAINTAIN on table public.workspace_account_invitations to service_role;

grant REFERENCES on table public.workspace_account_invitations to service_role;

grant SELECT on table public.workspace_account_invitations to service_role;

grant TRIGGER on table public.workspace_account_invitations to service_role;

grant TRUNCATE on table public.workspace_account_invitations to service_role;

grant UPDATE on table public.workspace_account_invitations to service_role;

grant DELETE on table public.workspace_deletion_certificates to service_role;

grant INSERT on table public.workspace_deletion_certificates to service_role;

grant MAINTAIN on table public.workspace_deletion_certificates to service_role;

grant REFERENCES on table public.workspace_deletion_certificates to service_role;

grant SELECT on table public.workspace_deletion_certificates to service_role;

grant TRIGGER on table public.workspace_deletion_certificates to service_role;

grant TRUNCATE on table public.workspace_deletion_certificates to service_role;

grant UPDATE on table public.workspace_deletion_certificates to service_role;

grant DELETE on table public.workspace_policies to anon;

grant INSERT on table public.workspace_policies to anon;

grant MAINTAIN on table public.workspace_policies to anon;

grant REFERENCES on table public.workspace_policies to anon;

grant SELECT on table public.workspace_policies to anon;

grant TRIGGER on table public.workspace_policies to anon;

grant TRUNCATE on table public.workspace_policies to anon;

grant UPDATE on table public.workspace_policies to anon;

grant MAINTAIN on table public.workspace_policies to authenticated;

grant REFERENCES on table public.workspace_policies to authenticated;

grant SELECT on table public.workspace_policies to authenticated;

grant TRIGGER on table public.workspace_policies to authenticated;

grant TRUNCATE on table public.workspace_policies to authenticated;

grant DELETE on table public.workspace_policies to service_role;

grant INSERT on table public.workspace_policies to service_role;

grant MAINTAIN on table public.workspace_policies to service_role;

grant REFERENCES on table public.workspace_policies to service_role;

grant SELECT on table public.workspace_policies to service_role;

grant TRIGGER on table public.workspace_policies to service_role;

grant TRUNCATE on table public.workspace_policies to service_role;

grant UPDATE on table public.workspace_policies to service_role;

grant DELETE on table public.workspace_security_controls to anon;

grant INSERT on table public.workspace_security_controls to anon;

grant MAINTAIN on table public.workspace_security_controls to anon;

grant REFERENCES on table public.workspace_security_controls to anon;

grant SELECT on table public.workspace_security_controls to anon;

grant TRIGGER on table public.workspace_security_controls to anon;

grant TRUNCATE on table public.workspace_security_controls to anon;

grant UPDATE on table public.workspace_security_controls to anon;

grant DELETE on table public.workspace_security_controls to authenticated;

grant INSERT on table public.workspace_security_controls to authenticated;

grant MAINTAIN on table public.workspace_security_controls to authenticated;

grant REFERENCES on table public.workspace_security_controls to authenticated;

grant SELECT on table public.workspace_security_controls to authenticated;

grant TRIGGER on table public.workspace_security_controls to authenticated;

grant TRUNCATE on table public.workspace_security_controls to authenticated;

grant UPDATE on table public.workspace_security_controls to authenticated;

grant DELETE on table public.workspace_security_controls to service_role;

grant INSERT on table public.workspace_security_controls to service_role;

grant MAINTAIN on table public.workspace_security_controls to service_role;

grant REFERENCES on table public.workspace_security_controls to service_role;

grant SELECT on table public.workspace_security_controls to service_role;

grant TRIGGER on table public.workspace_security_controls to service_role;

grant TRUNCATE on table public.workspace_security_controls to service_role;

grant UPDATE on table public.workspace_security_controls to service_role;

grant DELETE on table public.workspace_usage to authenticated;

grant INSERT on table public.workspace_usage to authenticated;

grant MAINTAIN on table public.workspace_usage to authenticated;

grant REFERENCES on table public.workspace_usage to authenticated;

grant SELECT on table public.workspace_usage to authenticated;

grant TRIGGER on table public.workspace_usage to authenticated;

grant TRUNCATE on table public.workspace_usage to authenticated;

grant UPDATE on table public.workspace_usage to authenticated;

grant DELETE on table public.workspace_usage to service_role;

grant INSERT on table public.workspace_usage to service_role;

grant MAINTAIN on table public.workspace_usage to service_role;

grant REFERENCES on table public.workspace_usage to service_role;

grant SELECT on table public.workspace_usage to service_role;

grant TRIGGER on table public.workspace_usage to service_role;

grant TRUNCATE on table public.workspace_usage to service_role;

grant UPDATE on table public.workspace_usage to service_role;

grant DELETE on table public.workspaces to anon;

grant INSERT on table public.workspaces to anon;

grant MAINTAIN on table public.workspaces to anon;

grant REFERENCES on table public.workspaces to anon;

grant SELECT on table public.workspaces to anon;

grant TRIGGER on table public.workspaces to anon;

grant TRUNCATE on table public.workspaces to anon;

grant UPDATE on table public.workspaces to anon;

grant DELETE on table public.workspaces to authenticated;

grant INSERT on table public.workspaces to authenticated;

grant MAINTAIN on table public.workspaces to authenticated;

grant REFERENCES on table public.workspaces to authenticated;

grant SELECT on table public.workspaces to authenticated;

grant TRIGGER on table public.workspaces to authenticated;

grant TRUNCATE on table public.workspaces to authenticated;

grant UPDATE on table public.workspaces to authenticated;

grant DELETE on table public.workspaces to service_role;

grant INSERT on table public.workspaces to service_role;

grant MAINTAIN on table public.workspaces to service_role;

grant REFERENCES on table public.workspaces to service_role;

grant SELECT on table public.workspaces to service_role;

grant TRIGGER on table public.workspaces to service_role;

grant TRUNCATE on table public.workspaces to service_role;

grant UPDATE on table public.workspaces to service_role;

revoke all on function accept_workspace_account_invitation(text,uuid,text,text,text,text) from public, anon, authenticated, service_role;

revoke all on function append_security_audit_entries(jsonb) from public, anon, authenticated, service_role;

revoke all on function apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid) from public, anon, authenticated, service_role;

revoke all on function apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean) from public, anon, authenticated, service_role;

revoke all on function apply_offline_checkout_item_unchecked(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean) from public, anon, authenticated, service_role;

revoke all on function approve_better_auth_email_change(text,text) from public, anon, authenticated, service_role;

revoke all on function archive_borrower_with_audit(uuid,uuid,uuid) from public, anon, authenticated, service_role;

revoke all on function better_auth_create_organization(uuid,text,text) from public, anon, authenticated, service_role;

revoke all on function better_auth_create_user(uuid,text,text,text,text,text,text,uuid,text,text) from public, anon, authenticated, service_role;

revoke all on function claim_workspaces_due_for_purge(integer) from public, anon, authenticated, service_role;

revoke all on function complete_better_auth_email_change(text) from public, anon, authenticated, service_role;

revoke all on function complete_offline_checkout_pack(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;

revoke all on function consume_rate_limit(text,integer,integer) from public, anon, authenticated, service_role;

revoke all on function consume_rate_limit_prelogin(text,text,integer,integer) from public, anon, authenticated, service_role;

revoke all on function consume_turnstile_token(text) from public, anon, authenticated, service_role;

revoke all on function create_better_auth_email_change_request(uuid,text,text,timestamp with time zone) from public, anon, authenticated, service_role;

revoke all on function create_borrower_identity(uuid,text,text,text,uuid[],uuid) from public, anon, authenticated, service_role;

revoke all on function create_item_with_access_and_audit(uuid,text,text,text,text,text,text,uuid[],uuid) from public, anon, authenticated, service_role;

revoke all on function create_workspace_account_invitation(uuid,uuid,text,text,text,timestamp with time zone) from public, anon, authenticated, service_role;

revoke all on function current_session_binding_key() from public, anon, authenticated, service_role;

revoke all on function current_user_role() from public, anon, authenticated, service_role;

revoke all on function current_workspace_id() from public, anon, authenticated, service_role;

revoke all on function has_recent_privileged_step_up(text) from public, anon, authenticated, service_role;

revoke all on function is_better_auth_session_active(text) from public, anon, authenticated, service_role;

revoke all on function list_pending_legal_acceptances(uuid) from public, anon, authenticated, service_role;

revoke all on function list_workspace_support_attachment_paths(uuid) from public, anon, authenticated, service_role;

revoke all on function private.apply_workspace_purge_external_cleanup_receipt() from public, anon, authenticated, service_role;

revoke all on function private.borrower_is_in_current_workspace(uuid) from public, anon, authenticated, service_role;

revoke all on function private.current_account_session_is_active() from public, anon, authenticated, service_role;

revoke all on function private.current_profile_can_access_borrower(uuid,text) from public, anon, authenticated, service_role;

revoke all on function private.current_profile_can_access_item(uuid,text) from public, anon, authenticated, service_role;

revoke all on function private.delete_better_auth_session_for_account_revoke() from public, anon, authenticated, service_role;

revoke all on function private.enforce_active_better_auth_workspace_lifecycle() from public, anon, authenticated, service_role;

revoke all on function private.enforce_active_inventory_quota() from public, anon, authenticated, service_role;

revoke all on function private.enforce_individual_membership_boundary() from public, anon, authenticated, service_role;

revoke all on function private.enforce_individual_policy_boundary() from public, anon, authenticated, service_role;

revoke all on function private.enforce_individual_profile_boundary() from public, anon, authenticated, service_role;

revoke all on function private.guard_linked_better_auth_organization_delete() from public, anon, authenticated, service_role;

revoke all on function private.initialize_workspace_usage() from public, anon, authenticated, service_role;

revoke all on function private.item_is_in_current_workspace(uuid) from public, anon, authenticated, service_role;

revoke all on function private.legal_acceptances_immutable() from public, anon, authenticated, service_role;

revoke all on function private.revoke_account_sessions_for_better_auth_delete() from public, anon, authenticated, service_role;

revoke all on function private.super_admin_session_not_revoked() from public, anon, authenticated, service_role;

revoke all on function private.sync_better_auth_email_to_profile() from public, anon, authenticated, service_role;

revoke all on function private.validate_workspace_primary_admin() from public, anon, authenticated, service_role;

revoke all on function purge_workspace_better_auth_user(uuid,uuid) from public, anon, authenticated, service_role;

revoke all on function purge_workspace_data(uuid,jsonb) from public, anon, authenticated, service_role;

revoke all on function record_legal_acceptance(uuid,text,text,text,text,text,text) from public, anon, authenticated, service_role;

revoke all on function refresh_super_reporting_views() from public, anon, authenticated, service_role;

revoke all on function release_workspace_purge_claim(uuid) from public, anon, authenticated, service_role;

revoke all on function resolve_public_workspace_by_id(uuid) from public, anon, authenticated, service_role;

revoke all on function resolve_public_workspace_by_slug(text) from public, anon, authenticated, service_role;

revoke all on function restore_borrower_with_audit(uuid,uuid,uuid) from public, anon, authenticated, service_role;

revoke all on function run_data_retention() from public, anon, authenticated, service_role;

revoke all on function store_offline_checkout_pack_chunk(uuid,uuid,uuid,text,jsonb,jsonb,integer) from public, anon, authenticated, service_role;

revoke all on function sync_workspace_name_from_better_auth_organization() from public, anon, authenticated, service_role;

revoke all on function update_borrower_access_with_audit(uuid,uuid,uuid,text,uuid[]) from public, anon, authenticated, service_role;

revoke all on function update_item_with_access_and_audit(uuid,uuid,text,text,text,text,text,uuid[],uuid,text,uuid,timestamp with time zone) from public, anon, authenticated, service_role;

revoke all on function workspace_account_dashboard() from public, anon, authenticated, service_role;

revoke all on function workspace_admin_create_profile(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;

revoke all on function workspace_admin_set_profile_role(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;

grant EXECUTE on function accept_workspace_account_invitation(text,uuid,text,text,text,text) to service_role;

grant EXECUTE on function append_security_audit_entries(jsonb) to service_role;

grant EXECUTE on function apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid) to service_role;

grant EXECUTE on function apply_offline_checkout_item(uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean) to service_role;

grant EXECUTE on function approve_better_auth_email_change(text,text) to service_role;

grant EXECUTE on function archive_borrower_with_audit(uuid,uuid,uuid) to service_role;

grant EXECUTE on function better_auth_create_organization(uuid,text,text) to service_role;

grant EXECUTE on function better_auth_create_user(uuid,text,text,text,text,text,text,uuid,text,text) to service_role;

grant EXECUTE on function claim_workspaces_due_for_purge(integer) to service_role;

grant EXECUTE on function complete_better_auth_email_change(text) to service_role;

grant EXECUTE on function complete_offline_checkout_pack(uuid,uuid,uuid,text) to service_role;

grant EXECUTE on function consume_rate_limit(text,integer,integer) to authenticated;

grant EXECUTE on function consume_rate_limit(text,integer,integer) to service_role;

grant EXECUTE on function consume_rate_limit_prelogin(text,text,integer,integer) to service_role;

grant EXECUTE on function consume_turnstile_token(text) to service_role;

grant EXECUTE on function create_better_auth_email_change_request(uuid,text,text,timestamp with time zone) to service_role;

grant EXECUTE on function create_borrower_identity(uuid,text,text,text,uuid[],uuid) to service_role;

grant EXECUTE on function create_item_with_access_and_audit(uuid,text,text,text,text,text,text,uuid[],uuid) to service_role;

grant EXECUTE on function create_workspace_account_invitation(uuid,uuid,text,text,text,timestamp with time zone) to service_role;

grant EXECUTE on function current_session_binding_key() to authenticated;

grant EXECUTE on function current_session_binding_key() to service_role;

grant EXECUTE on function current_user_role() to authenticated;

grant EXECUTE on function current_user_role() to service_role;

grant EXECUTE on function current_workspace_id() to authenticated;

grant EXECUTE on function current_workspace_id() to service_role;

grant EXECUTE on function has_recent_privileged_step_up(text) to authenticated;

grant EXECUTE on function has_recent_privileged_step_up(text) to service_role;

grant EXECUTE on function is_better_auth_session_active(text) to service_role;

grant EXECUTE on function list_pending_legal_acceptances(uuid) to service_role;

grant EXECUTE on function list_workspace_support_attachment_paths(uuid) to service_role;

grant EXECUTE on function private.borrower_is_in_current_workspace(uuid) to authenticated;

grant EXECUTE on function private.borrower_is_in_current_workspace(uuid) to service_role;

grant EXECUTE on function private.current_account_session_is_active() to authenticated;

grant EXECUTE on function private.current_account_session_is_active() to service_role;

grant EXECUTE on function private.current_profile_can_access_borrower(uuid,text) to authenticated;

grant EXECUTE on function private.current_profile_can_access_borrower(uuid,text) to service_role;

grant EXECUTE on function private.current_profile_can_access_item(uuid,text) to authenticated;

grant EXECUTE on function private.current_profile_can_access_item(uuid,text) to service_role;

grant EXECUTE on function private.item_is_in_current_workspace(uuid) to authenticated;

grant EXECUTE on function private.item_is_in_current_workspace(uuid) to service_role;

grant execute on function private.legal_acceptances_immutable() to public;

grant EXECUTE on function private.super_admin_session_not_revoked() to authenticated;

grant EXECUTE on function private.super_admin_session_not_revoked() to service_role;

grant EXECUTE on function purge_workspace_better_auth_user(uuid,uuid) to service_role;

grant EXECUTE on function purge_workspace_data(uuid,jsonb) to service_role;

grant EXECUTE on function record_legal_acceptance(uuid,text,text,text,text,text,text) to service_role;

grant EXECUTE on function refresh_super_reporting_views() to service_role;

grant EXECUTE on function release_workspace_purge_claim(uuid) to service_role;

grant EXECUTE on function resolve_public_workspace_by_id(uuid) to anon;

grant EXECUTE on function resolve_public_workspace_by_id(uuid) to authenticated;

grant EXECUTE on function resolve_public_workspace_by_id(uuid) to service_role;

grant EXECUTE on function resolve_public_workspace_by_slug(text) to anon;

grant EXECUTE on function resolve_public_workspace_by_slug(text) to authenticated;

grant EXECUTE on function resolve_public_workspace_by_slug(text) to service_role;

grant EXECUTE on function restore_borrower_with_audit(uuid,uuid,uuid) to service_role;

grant EXECUTE on function run_data_retention() to service_role;

grant EXECUTE on function store_offline_checkout_pack_chunk(uuid,uuid,uuid,text,jsonb,jsonb,integer) to service_role;

grant EXECUTE on function sync_workspace_name_from_better_auth_organization() to service_role;

grant EXECUTE on function update_borrower_access_with_audit(uuid,uuid,uuid,text,uuid[]) to service_role;

grant EXECUTE on function update_item_with_access_and_audit(uuid,uuid,text,text,text,text,text,uuid[],uuid,text,uuid,timestamp with time zone) to service_role;

grant EXECUTE on function workspace_account_dashboard() to service_role;

grant EXECUTE on function workspace_admin_create_profile(uuid,uuid,uuid,text) to service_role;

grant EXECUTE on function workspace_admin_set_profile_role(uuid,uuid,uuid,text) to service_role;
