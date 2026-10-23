-- Usage telemetry is a privileged operational surface. Keep the authenticated
-- grant for reads, but require the same fresh, non-revoked super-admin session
-- used by the other privileged REST tables.
drop policy if exists super_admin_all_usage on public.workspace_usage;
create policy super_admin_all_usage on public.workspace_usage
for select to authenticated
using (
  (select public.current_user_role()) = 'super_admin'
  and (select public.has_recent_privileged_step_up('super_admin'))
  and (select private.super_admin_session_not_revoked())
  and (select private.current_account_session_is_active())
);
