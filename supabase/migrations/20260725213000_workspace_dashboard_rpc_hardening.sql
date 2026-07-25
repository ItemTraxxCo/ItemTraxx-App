begin;

revoke execute on function public.workspace_account_dashboard()
  from public, anon, authenticated;

commit;
