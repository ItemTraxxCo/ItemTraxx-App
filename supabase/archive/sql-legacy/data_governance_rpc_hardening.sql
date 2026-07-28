-- Re-apply the retention RPC privilege boundary to existing environments.

do $$
begin
  if to_regprocedure('public.run_data_retention()') is not null then
    revoke all on function public.run_data_retention() from public, anon, authenticated;
    grant execute on function public.run_data_retention() to service_role;
  end if;
end;
$$;
