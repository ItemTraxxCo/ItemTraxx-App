-- Keep direct super_approvals reads tied to the caller's live Better Auth
-- session. A fresh step-up record alone can outlive explicit session revocation.
do $$
begin
  if to_regclass('public.super_approvals') is null then
    return;
  end if;

  if to_regprocedure('private.super_admin_session_not_revoked()') is null then
    raise exception 'private.super_admin_session_not_revoked() is required before hardening super_approvals';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'super_approvals'
      and policyname = 'super_admin_select_approvals'
  ) then
    raise exception 'super_admin_select_approvals must exist before hardening its session boundary';
  end if;

  execute $policy$
    alter policy super_admin_select_approvals
    on public.super_approvals
    using (
      public.current_user_role() = 'super_admin'
      and public.has_recent_privileged_step_up('super_admin')
      and (select private.super_admin_session_not_revoked())
    )
  $policy$;
end;
$$;
