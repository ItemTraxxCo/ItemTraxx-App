-- Keep the reporting refresh RPC aligned with the workspace reporting view.
-- The workspace migration removed the legacy tenant-named materialized view,
-- but the pre-migration function body survived because PL/pgSQL dependencies
-- are resolved when the function runs.

begin;

create or replace function public.refresh_super_reporting_views()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view public.super_reporting_workspace_metrics;
end;
$$;

revoke all on function public.refresh_super_reporting_views() from public, anon, authenticated;
grant execute on function public.refresh_super_reporting_views() to service_role;

commit;
