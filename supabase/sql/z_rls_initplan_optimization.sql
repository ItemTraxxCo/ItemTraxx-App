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
  using (tenant_id = (select profiles.tenant_id from profiles where profiles.id = (select auth.uid())));

drop policy if exists gear_admin_delete on public.gear;
create policy gear_admin_delete on public.gear for delete to public
  using (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'tenant_admin' and profiles.tenant_id = gear.tenant_id));

drop policy if exists gear_admin_insert on public.gear;
create policy gear_admin_insert on public.gear for insert to public
  with check (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'tenant_admin' and profiles.tenant_id = gear.tenant_id));

drop policy if exists gear_admin_update on public.gear;
create policy gear_admin_update on public.gear for update to public
  using (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'tenant_admin' and profiles.tenant_id = gear.tenant_id));

drop policy if exists gear_tenant_user_update on public.gear;
create policy gear_tenant_user_update on public.gear for update to public
  using (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.tenant_id = gear.tenant_id
      and profiles.role = any (array['tenant_user','tenant_admin'])));

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
  using (tenant_id = (select profiles.tenant_id from profiles where profiles.id = (select auth.uid())));

drop policy if exists students_admin_delete on public.students;
create policy students_admin_delete on public.students for delete to public
  using (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'tenant_admin' and profiles.tenant_id = students.tenant_id));

drop policy if exists students_admin_insert on public.students;
create policy students_admin_insert on public.students for insert to public
  with check (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'tenant_admin' and profiles.tenant_id = students.tenant_id));

drop policy if exists students_admin_update on public.students;
create policy students_admin_update on public.students for update to public
  using (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'tenant_admin' and profiles.tenant_id = students.tenant_id));

-- ============================ gear_logs ============================
drop policy if exists gear_logs_read_tenant on public.gear_logs;
create policy gear_logs_read_tenant on public.gear_logs for select to public
  using (tenant_id = (select profiles.tenant_id from profiles where profiles.id = (select auth.uid())));

drop policy if exists gear_logs_insert on public.gear_logs;
create policy gear_logs_insert on public.gear_logs for insert to public
  with check (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.tenant_id = gear_logs.tenant_id));

drop policy if exists gear_logs_insert_tenant_user on public.gear_logs;
create policy gear_logs_insert_tenant_user on public.gear_logs for insert to public
  with check (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.tenant_id = gear_logs.tenant_id
      and profiles.role = any (array['tenant_user','tenant_admin'])));

-- ============================ profiles ============================
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to public
  using (id = (select auth.uid()));

drop policy if exists profiles_super_admin_read_all on public.profiles;
create policy profiles_super_admin_read_all on public.profiles for select to public
  using ((select auth.role()) = 'super_admin');

drop policy if exists self_select_profile on public.profiles;
create policy self_select_profile on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- ============================ admin_audit_logs ============================
drop policy if exists admin_audit_logs_read on public.admin_audit_logs;
create policy admin_audit_logs_read on public.admin_audit_logs for select to public
  using (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'tenant_admin' and profiles.tenant_id = admin_audit_logs.tenant_id));

drop policy if exists admin_audit_logs_read_super_admin on public.admin_audit_logs;
create policy admin_audit_logs_read_super_admin on public.admin_audit_logs for select to public
  using (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'super_admin'));

drop policy if exists admin_audit_logs_insert on public.admin_audit_logs;
create policy admin_audit_logs_insert on public.admin_audit_logs for insert to public
  with check (exists (select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'tenant_admin' and profiles.tenant_id = admin_audit_logs.tenant_id));

drop policy if exists super_admin_all_admin_audit_logs on public.admin_audit_logs;
create policy super_admin_all_admin_audit_logs on public.admin_audit_logs for all to authenticated
  using ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')))
  with check ((select current_user_role()) = 'super_admin' and (select has_recent_privileged_step_up('super_admin')) and actor_id = (select auth.uid()));

drop policy if exists tenant_admin_insert_admin_audit_logs on public.admin_audit_logs;
create policy tenant_admin_insert_admin_audit_logs on public.admin_audit_logs for insert to authenticated
  with check ((select current_user_role()) = 'tenant_admin' and actor_id = (select auth.uid())
    and tenant_id = (select current_tenant_id()) and (select has_recent_privileged_step_up('tenant_admin')));
