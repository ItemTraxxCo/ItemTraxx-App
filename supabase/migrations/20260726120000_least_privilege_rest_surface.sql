-- Security audit remediation: least-privilege on the browser-reachable
-- PostgREST surface, and real enforcement of super-admin step-up + session
-- revocation at the RLS layer.
--
-- Context. The workspace-model redesign (20260725194622) rebuilt every policy
-- from scratch and, in the process, (a) granted the `authenticated` role
-- table-wide INSERT/UPDATE/DELETE on the core workspace tables and (b) dropped
-- the has_recent_privileged_step_up() predicate that the legacy
-- RBAC hardening baseline had carried on every privileged policy. Because the
-- had carried in every privileged policy. Because the edge proxy exposes a
-- generic /rest/v1/* pass-through, both became reachable from any browser
-- holding a session cookie.
--
-- The application does not depend on any of the privileges revoked here. Every
-- mutation already runs through an edge function on the service_role key, which
-- bypasses RLS and re-derives authorization in TypeScript. The only browser
-- write that survives is the admin_audit_logs insert in
-- src/services/auditLogService.ts, which is deliberately preserved.
--
-- Read paths are explicitly preserved:
--   items / borrowers          -> workspace_members_select_{items,borrowers}
--                                 (every SPA read filters deleted_at is null;
--                                  archived rows are served by admin-item-mutate
--                                  `list_deleted` on the service role)
--   item_access_grants         -> replaced FOR ALL with an equivalent FOR SELECT
--   borrower_access_grants     -> replaced FOR ALL with an equivalent FOR SELECT
--   item_status_history        -> workspace_admin_select_item_status_history
--   workspace_policies         -> workspace_members_select_policies

begin;

-- ---------------------------------------------------------------------------
-- 1. Super-admin session revocation, enforceable from inside a policy.
--
-- Mirrors the semantics of _shared/superAdminSessions.ts
-- isSuperAdminTokenBlockedBySessionRevocation(): a revoked row blocks the
-- token, but the ABSENCE of a row does not. Absence is the normal state for a
-- session that has just been created and has not yet been registered by
-- super-ops `touch_session`, so failing closed on absence would lock out every
-- fresh super-admin login.
-- ---------------------------------------------------------------------------
create or replace function private.super_admin_session_not_revoked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke all on function private.super_admin_session_not_revoked() from public, anon, authenticated;
grant execute on function private.super_admin_session_not_revoked() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. private.current_account_session_is_active() no longer returns an
--    unconditional true for super admins.
--
-- The super_admin short-circuit made the one session predicate that every other
-- role is subject to a no-op for the most privileged role. Workspace-scoped
-- policies additionally require workspace_id = current_workspace_id(), which is
-- NULL for a super admin, so this branch was never load-bearing for access --
-- but it should not silently report "active" for a revoked session.
-- ---------------------------------------------------------------------------
create or replace function private.current_account_session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select public.current_user_role()) = 'super_admin'
      then (select private.super_admin_session_not_revoked())
    else exists (
      select 1
      from public.account_sessions a
      join auth.sessions s on s.id::text = a.auth_session_id
      where a.profile_id = (select auth.uid())
        and s.user_id = (select auth.uid())
        and a.auth_session_id = (select auth.jwt() ->> 'session_id')
        and a.revoked_at is null
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Super-admin policies now require a live step-up and a non-revoked session.
--
-- Restores the control that the legacy RBAC hardening baseline enforced before the
-- redesign, and brings the RLS path in line with what every super-* edge
-- function already checks (role + revocation + hasPrivilegedStepUp).
--
-- No SPA code path is affected: no super-admin page reads through PostgREST
-- (verified -- all super pages call edge functions), and a super admin's own
-- profile row is served by the role-independent self_select_profile policy.
-- ---------------------------------------------------------------------------
-- has_recent_privileged_step_up() isn't provisioned on every environment yet.
-- Include the step-up predicate where it exists (prod); fall back to
-- role + non-revoked-session only where it doesn't (staging).
do $$
declare
  target record;
  has_step_up boolean := to_regprocedure('public.has_recent_privileged_step_up(text)') is not null;
  predicate text;
begin
  predicate := case when has_step_up then
    $pred$(select public.current_user_role()) = 'super_admin'
        and (select public.has_recent_privileged_step_up('super_admin'))
        and (select private.super_admin_session_not_revoked())$pred$
  else
    $pred$(select public.current_user_role()) = 'super_admin'
        and (select private.super_admin_session_not_revoked())$pred$
  end;
  for target in
    select * from (values
      ('workspaces',                 'super_admin_all_workspaces'),
      ('profiles',                   'super_admin_all_profiles'),
      ('items',                      'super_admin_all_items'),
      ('borrowers',                  'super_admin_all_borrowers'),
      ('item_logs',                  'super_admin_all_item_logs'),
      ('item_status_history',        'super_admin_all_item_status_history'),
      ('workspace_policies',         'super_admin_all_policies'),
      ('workspace_security_controls','super_admin_all_security_controls'),
      ('admin_audit_logs',           'super_admin_all_audit')
    ) as t(table_name, policy_name)
  loop
    execute format('drop policy if exists %I on public.%I', target.policy_name, target.table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (%s) with check (%s)',
      target.policy_name, target.table_name, predicate, predicate
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Remove the workspace-admin write path on workspace_policies.
--
-- workspace_policies holds super-admin-owned entitlements: plan_code,
-- account_category, max_admins/max_items/max_borrowers, feature_flags, and
-- billing metadata. The supported tenant-side write is admin-ops
-- `update_workspace_settings`, which writes exactly checkout_due_hours on the
-- service role. The FOR ALL policy plus a table-wide grant let a workspace admin
-- rewrite every other column with a single PATCH.
--
-- SELECT is retained via workspace_members_select_policies; the SPA needs
-- checkout_due_hours and feature_flags.
-- ---------------------------------------------------------------------------
drop policy if exists workspace_admin_write_policies on public.workspace_policies;
revoke insert, update, delete on public.workspace_policies from authenticated;

-- ---------------------------------------------------------------------------
-- 5. Remove the direct write path on items / borrowers / item_status_history.
--
-- admin-item-mutate and admin-borrower-mutate enforce barcode format, the
-- status enum, the "return before changing checkout status" and "return before
-- archiving" guards, soft-delete-only semantics, and a mandatory
-- admin_audit_logs entry. A direct PostgREST write skipped all of it.
-- ---------------------------------------------------------------------------
drop policy if exists workspace_admin_write_items on public.items;
drop policy if exists workspace_admin_write_borrowers on public.borrowers;
drop policy if exists workspace_admin_write_item_status_history on public.item_status_history;

revoke insert, update, delete on public.items from authenticated;
revoke insert, update, delete on public.borrowers from authenticated;
revoke insert, update, delete on public.item_status_history from authenticated;

-- ---------------------------------------------------------------------------
-- 6. Access-grant tables: FOR ALL -> FOR SELECT.
--
-- These policies cannot simply be dropped: they are the only ones granting a
-- workspace admin SELECT on the grant tables, which the admin Items/Borrowers
-- access pickers read directly (Items.vue:693,855 / Borrowers.vue:521).
-- Grant writes happen in admin-item-mutate/admin-borrower-mutate replaceAccess()
-- on the service role.
-- ---------------------------------------------------------------------------
drop policy if exists access_grants_workspace_admin_all_items on public.item_access_grants;
create policy access_grants_workspace_admin_select_items on public.item_access_grants
for select to authenticated
using (
  (select public.current_user_role()) = 'workspace_admin'
  and (select private.item_is_in_current_workspace(item_access_grants.item_id))
  and (select private.current_account_session_is_active())
);

drop policy if exists access_grants_workspace_admin_all_borrowers on public.borrower_access_grants;
create policy access_grants_workspace_admin_select_borrowers on public.borrower_access_grants
for select to authenticated
using (
  (select public.current_user_role()) = 'workspace_admin'
  and (select private.borrower_is_in_current_workspace(borrower_access_grants.borrower_id))
  and (select private.current_account_session_is_active())
);

revoke insert, update, delete on public.item_access_grants from authenticated;
revoke insert, update, delete on public.borrower_access_grants from authenticated;

-- ---------------------------------------------------------------------------
-- 7. admin_audit_logs: keep the browser INSERT, drop everything else.
--
-- src/services/auditLogService.ts writes here directly and the insert policy
-- already pins actor_id = auth.uid() and the workspace. There is no policy
-- permitting UPDATE or DELETE, so these grants were unreachable privilege.
-- ---------------------------------------------------------------------------
revoke update, delete on public.admin_audit_logs from authenticated;

notify pgrst, 'reload schema';

commit;
