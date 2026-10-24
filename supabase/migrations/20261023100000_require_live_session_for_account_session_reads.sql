drop policy if exists account_sessions_select_own on public.account_sessions;

create policy account_sessions_select_own on public.account_sessions
for select to authenticated
using (
  profile_id = (select auth.uid())
  and workspace_id = (select public.current_workspace_id())
  and (select private.current_account_session_is_active())
);
