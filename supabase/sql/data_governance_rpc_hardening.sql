-- Re-apply the retention RPC privilege boundary to existing environments.

revoke all on function public.run_data_retention() from public, anon, authenticated;
grant execute on function public.run_data_retention() to service_role;
