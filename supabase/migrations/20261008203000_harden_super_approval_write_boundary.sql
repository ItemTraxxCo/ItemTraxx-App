-- Keep approval reads available to step-up verified super admins, but route all
-- inserts and updates through the super-ops Edge Function so actor identities
-- cannot be supplied directly by an authenticated client.
do $$
declare
  policy_record record;
begin
  if to_regclass('public.super_approvals') is null then
    return;
  end if;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'super_approvals'
  loop
    execute format(
      'drop policy %I on public.super_approvals',
      policy_record.policyname
    );
  end loop;

  execute 'alter table public.super_approvals enable row level security';
  execute $policy$
    create policy super_admin_select_approvals
    on public.super_approvals
    for select to authenticated
    using (
      public.current_user_role() = 'super_admin'
      and public.has_recent_privileged_step_up('super_admin')
    )
  $policy$;

  execute 'revoke all on public.super_approvals from public, anon, authenticated';
  execute 'grant select on public.super_approvals to authenticated';
  execute 'grant all on public.super_approvals to service_role';
end;
$$;
