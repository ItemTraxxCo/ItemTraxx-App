-- ITX-48: optimize RLS policies that re-evaluate auth.*/helpers per row
-- (advisor 0003_auth_rls_initplan). Wrapping each call in a scalar subquery
-- — (select auth.uid()) etc. — lets the planner evaluate it once per query
-- instead of once per row. Biggest payoff on the high-traffic tables; relates
-- to ITX-19 (large-dataset slowdowns).
--
-- WHY THIS IS A MIGRATION, NOT IN-PLACE SOURCE EDITS:
-- Most of these policies were created out-of-band (no definition in
-- supabase/sql/*). The few that do live in source (rbac_hardening.sql) are
-- recreated here too. The `z_` filename prefix makes this file sort LAST, so
-- when the SQL suite is re-applied in filename order it runs after the source
-- files and wins. If your runner does NOT apply in filename order, apply this
-- file last manually.
--
-- Scope: gear, students, gear_logs, profiles, admin_audit_logs (the 5 hottest
-- of the 38 flagged policies). Lower-traffic tables remain for a follow-up.

-- ============================ gear ============================
drop policy if exists gear_read_tenant on public.gear;
create policy gear_read_tenant on public.gear for select to public
  using (tenant_id = (select current_tenant_id()));

drop policy if exists gear_admin_delete on public.gear;
create policy gear_admin_delete on public.gear for delete to public
  using ((select current_user_role()) = 'tenant_admin' and gear.tenant_id = (select current_tenant_id()));

drop policy if exists gear_admin_insert on public.gear;
create policy gear_admin_insert on public.gear for insert to public
  with check ((select current_user_role()) = 'tenant_admin' and gear.tenant_id = (select current_tenant_id()));

drop policy if exists gear_admin_update on public.gear;
create policy gear_admin_update on public.gear for update to public
  using ((select current_user_role()) = 'tenant_admin' and gear.tenant_id = (select current_tenant_id()));

drop policy if exists gear_tenant_user_update on public.gear;
create policy gear_tenant_user_update on public.gear for update to public
  using ((select current_user_role()) = any (array['tenant_user','tenant_admin']) and gear.tenant_id = (select current_tenant_id()));

-- "student checkout gear" (with space) is an exact duplicate of
-- student_checkout_gear; drop the legacy spaced name, keep the canonical one.
drop policy if exists "student checkout gear" on public.gear;

drop policy if exists student_checkout_gear on public.gear;
create policy student_checkout_gear on public.gear for update to public
  using (exists (select 1 from students
    where students.id = (select auth.uid()) and students.tenant_id = gear.tenant_id));

drop policy if exists student_gear_update on public.gear;
create policy student_gear_update on public.gear for update to public
  using (exists (select 1 from students
    where students.id = (select auth.uid()) and students.id = gear.checked_out_by))
  with check (checked_out_by is null or checked_out_by = (select auth.uid()));

-- ============================ students ============================
drop policy if exists students_read_tenant on public.students;
create policy students_read_tenant on public.students for select to public
  using (tenant_id = (select current_tenant_id()));

drop policy if exists students_admin_delete on public.students;
create policy students_admin_delete on public.students for delete to public
  using ((select current_user_role()) = 'tenant_admin' and students.tenant_id = (select current_tenant_id()));

drop policy if exists students_admin_insert on public.students;
create policy students_admin_insert on public.students for insert to public
  with check ((select current_user_role()) = 'tenant_admin' and students.tenant_id = (select current_tenant_id()));

drop policy if exists students_admin_update on public.students;
create policy students_admin_update on public.students for update to public
  using ((select current_user_role()) = 'tenant_admin' and students.tenant_id = (select current_tenant_id()));

-- ============================ gear_logs ============================
drop policy if exists gear_logs_read_tenant on public.gear_logs;
create policy gear_logs_read_tenant on public.gear_logs for select to public
  using (tenant_id = (select current_tenant_id()));

drop policy if exists gear_logs_insert on public.gear_logs;
create policy gear_logs_insert on public.gear_logs for insert to public
  with check ((select current_user_role()) is not null and gear_logs.tenant_id = (select current_tenant_id()));

drop policy if exists gear_logs_insert_tenant_user on public.gear_logs;
create policy gear_logs_insert_tenant_user on public.gear_logs for insert to public
  with check ((select current_user_role()) = any (array['tenant_user','tenant_admin']) and gear_logs.tenant_id = (select current_tenant_id()));

-- ============================ profiles ============================
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to public
  using (id = (select auth.uid()));

drop policy if exists profiles_super_admin_read_all on public.profiles;
create policy profiles_super_admin_read_all on public.profiles for select to public
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists self_select_profile on public.profiles;
create policy self_select_profile on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- ============================ admin_audit_logs ============================
drop policy if exists admin_audit_logs_read on public.admin_audit_logs;
create policy admin_audit_logs_read on public.admin_audit_logs for select to authenticated
  using ((select current_user_role()) = 'tenant_admin' and tenant_id = (select current_tenant_id()));

drop policy if exists admin_audit_logs_read_super_admin on public.admin_audit_logs;
-- CodeRabbit: dropped — super_admin_all_admin_audit_logs already grants super_admin
-- SELECT *with* step-up; this permissive no-step-up policy was a bypass.

drop policy if exists admin_audit_logs_insert on public.admin_audit_logs;
-- CodeRabbit: dropped — tenant_admin_insert_admin_audit_logs covers tenant_admin
-- INSERT *with* step-up + actor_id check; this permissive policy bypassed it.

drop policy if exists super_admin_all_admin_audit_logs on public.admin_audit_logs;
create policy super_admin_all_admin_audit_logs on public.admin_audit_logs for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')) and actor_id = (select auth.uid()));

drop policy if exists tenant_admin_insert_admin_audit_logs on public.admin_audit_logs;
create policy tenant_admin_insert_admin_audit_logs on public.admin_audit_logs for insert to authenticated
  with check ((select current_user_role()) = 'tenant_admin' and actor_id = (select auth.uid())
    and tenant_id = (select current_tenant_id()) and (select has_recent_privileged_step_up('tenant_admin')));

-- ===================================================================
-- ITX-48 (cont.): lower-traffic tables. Same wrap pattern. Mostly
-- super_admin / tenant_admin management policies.
-- ===================================================================

-- app_runtime_config
drop policy if exists super_admin_all_runtime_config on public.app_runtime_config;
create policy super_admin_all_runtime_config on public.app_runtime_config for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- async_jobs
drop policy if exists super_admin_select_async_jobs on public.async_jobs;
create policy super_admin_select_async_jobs on public.async_jobs for select to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin')
    and (select has_recent_privileged_step_up('super_admin')));

-- client_error_reports
drop policy if exists super_admin_select_client_error_reports on public.client_error_reports;
create policy super_admin_select_client_error_reports on public.client_error_reports for select to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin')
    and (select has_recent_privileged_step_up('super_admin')));

-- customer_status_logs
drop policy if exists super_admin_select_customer_status_logs on public.customer_status_logs;
create policy super_admin_select_customer_status_logs on public.customer_status_logs for select to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin')
    and (select has_recent_privileged_step_up('super_admin')));

-- district_support_requests
drop policy if exists district_admin_insert_own_support_requests on public.district_support_requests;
create policy district_admin_insert_own_support_requests on public.district_support_requests for insert to authenticated
  with check (
    exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'district_admin' and p.district_id = district_support_requests.district_id)
    or (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin') and (select has_recent_privileged_step_up('super_admin'))));

drop policy if exists district_admin_select_own_support_requests on public.district_support_requests;
create policy district_admin_select_own_support_requests on public.district_support_requests for select to authenticated
  using (
    (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'district_admin' and p.district_id = district_support_requests.district_id) and (select has_recent_privileged_step_up('district_admin')))
    or (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin') and (select has_recent_privileged_step_up('super_admin'))));

-- districts
drop policy if exists super_admin_all_districts on public.districts;
create policy super_admin_all_districts on public.districts for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- gear_status_history
drop policy if exists super_admin_all_gear_status_history on public.gear_status_history;
create policy super_admin_all_gear_status_history on public.gear_status_history for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists tenant_admin_insert_gear_status_history on public.gear_status_history;
create policy tenant_admin_insert_gear_status_history on public.gear_status_history for insert to authenticated
  with check ((select current_user_role()) = 'tenant_admin' and tenant_id = (select current_tenant_id()) and (select has_recent_privileged_step_up('tenant_admin')));

drop policy if exists tenant_select_gear_status_history on public.gear_status_history;
create policy tenant_select_gear_status_history on public.gear_status_history for select to authenticated
  using ((select current_user_role()) = any (array['tenant_user','tenant_admin']) and tenant_id = (select current_tenant_id()));

-- rate_limits
drop policy if exists rate_limits_access on public.rate_limits;
create policy rate_limits_access on public.rate_limits for all to public
  using (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.is_active = true and profiles.tenant_id = rate_limits.tenant_id
    and (rate_limits.actor_id = (select auth.uid()) or rate_limits.actor_id = rate_limits.tenant_id)))
  with check (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.is_active = true and profiles.tenant_id = rate_limits.tenant_id
    and (rate_limits.actor_id = (select auth.uid()) or rate_limits.actor_id = rate_limits.tenant_id)));

-- sales_leads
drop policy if exists super_admin_select_sales_leads on public.sales_leads;
create policy super_admin_select_sales_leads on public.sales_leads for select to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin')
    and (select has_recent_privileged_step_up('super_admin')));

-- subprocessor_changes
drop policy if exists super_admin_select_subprocessor_changes on public.subprocessor_changes;
create policy super_admin_select_subprocessor_changes on public.subprocessor_changes for select to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin')
    and (select has_recent_privileged_step_up('super_admin')));

-- super_admin_audit_logs
drop policy if exists super_admin_insert_super_admin_audit_logs on public.super_admin_audit_logs;
create policy super_admin_insert_super_admin_audit_logs on public.super_admin_audit_logs for insert to authenticated
  with check (actor_id = (select auth.uid()) and exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin')
    and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists super_admin_insert_super_audit_logs on public.super_admin_audit_logs;
create policy super_admin_insert_super_audit_logs on public.super_admin_audit_logs for insert to authenticated
  with check (actor_id = (select auth.uid()) and (select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists super_admin_select_super_admin_audit_logs on public.super_admin_audit_logs;
create policy super_admin_select_super_admin_audit_logs on public.super_admin_audit_logs for select to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin')
    and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists super_admin_select_super_audit_logs on public.super_admin_audit_logs;
create policy super_admin_select_super_audit_logs on public.super_admin_audit_logs for select to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- super_admin_sessions
drop policy if exists super_admin_sessions_select_own on public.super_admin_sessions;
create policy super_admin_sessions_select_own on public.super_admin_sessions for select to authenticated
  using ((select auth.uid()) = profile_id and exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'super_admin')
    and (select has_recent_privileged_step_up('super_admin')));

-- super_alert_rules
drop policy if exists super_admin_all_alert_rules on public.super_alert_rules;
create policy super_admin_all_alert_rules on public.super_alert_rules for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- super_approvals
drop policy if exists super_admin_all_approvals on public.super_approvals;
create policy super_admin_all_approvals on public.super_approvals for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- super_jobs
drop policy if exists super_admin_all_jobs on public.super_jobs;
create policy super_admin_all_jobs on public.super_jobs for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- support_request_attachments
drop policy if exists super_admin_select_support_request_attachments on public.support_request_attachments;
create policy super_admin_select_support_request_attachments on public.support_request_attachments for select to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- support_request_events
drop policy if exists super_admin_insert_support_request_events on public.support_request_events;
create policy super_admin_insert_support_request_events on public.support_request_events for insert to authenticated
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')) and actor_id = (select auth.uid()));

drop policy if exists super_admin_select_support_request_events on public.support_request_events;
create policy super_admin_select_support_request_events on public.support_request_events for select to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- support_requests
drop policy if exists super_admin_select_support_requests on public.support_requests;
create policy super_admin_select_support_requests on public.support_requests for select to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists super_admin_update_support_requests on public.support_requests;
create policy super_admin_update_support_requests on public.support_requests for update to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

-- tenant_admin_sessions
drop policy if exists tenant_admin_sessions_select_own on public.tenant_admin_sessions;
create policy tenant_admin_sessions_select_own on public.tenant_admin_sessions for select to authenticated
  using ((select auth.uid()) = profile_id and tenant_id = (select current_tenant_id())
    and exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_active = true and p.role = 'tenant_admin' and p.is_active = true));

-- tenant_policies
drop policy if exists super_admin_all_tenant_policies on public.tenant_policies;
create policy super_admin_all_tenant_policies on public.tenant_policies for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists tenant_admin_write_tenant_policies on public.tenant_policies;
create policy tenant_admin_write_tenant_policies on public.tenant_policies for all to authenticated
  using ((select current_user_role()) = 'tenant_admin' and tenant_id = (select current_tenant_id()) and (select has_recent_privileged_step_up('tenant_admin')))
  with check ((select current_user_role()) = 'tenant_admin' and tenant_id = (select current_tenant_id()) and (select has_recent_privileged_step_up('tenant_admin')));

drop policy if exists tenant_select_tenant_policies on public.tenant_policies;
create policy tenant_select_tenant_policies on public.tenant_policies for select to authenticated
  using ((select current_user_role()) = any (array['tenant_user','tenant_admin']) and tenant_id = (select current_tenant_id()));

-- tenant_security_controls
drop policy if exists super_admin_all_security_controls on public.tenant_security_controls;
create policy super_admin_all_security_controls on public.tenant_security_controls for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists tenant_admin_select_security_controls on public.tenant_security_controls;
create policy tenant_admin_select_security_controls on public.tenant_security_controls for select to authenticated
  using ((select current_user_role()) = 'tenant_admin' and tenant_id = (select current_tenant_id()));

-- tenants
drop policy if exists super_admin_all_tenants on public.tenants;
create policy super_admin_all_tenants on public.tenants for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')));

drop policy if exists tenant_self_select_tenants on public.tenants;
create policy tenant_self_select_tenants on public.tenants for select to authenticated
  using ((select current_user_role()) = any (array['tenant_user','tenant_admin']) and id = (select current_tenant_id()));

drop policy if exists tenants_super_admin_read on public.tenants;
-- CodeRabbit: dropped — super_admin_all_tenants grants super_admin SELECT *with*
-- step-up; this no-step-up policy was a bypass.
