begin;

alter table public.rate_limits enable row level security;
alter table public.privileged_session_stepups enable row level security;
alter table public.super_admin_sessions enable row level security;
alter table public.app_runtime_config enable row level security;

revoke all on table public.rate_limits from anon, authenticated;
revoke all on table public.privileged_session_stepups from anon, authenticated;
revoke all on table public.super_admin_sessions from anon, authenticated;
revoke all on table public.app_runtime_config from anon, authenticated;
revoke all on table public.super_reporting_workspace_metrics from anon, authenticated;

revoke execute on function public.create_borrower_identity(uuid, text, text, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_borrower_identity(uuid, text, text, text, uuid[])
  to service_role;

commit;
