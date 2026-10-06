begin;

-- Offline replay writes this marker with server-derived audit metadata. Keep
-- authenticated clients from pre-seeding the unique key used by replay's
-- idempotent audit insert. This restrictive policy also applies alongside
-- the workspace, individual-account, and super-admin permissive policies.
drop policy if exists admin_audit_logs_restrict_offline_quick_return
  on public.admin_audit_logs;
create policy admin_audit_logs_restrict_offline_quick_return
  on public.admin_audit_logs
  as restrictive
  for insert
  to authenticated
  with check (
    action_type is distinct from 'quick_return'
    or metadata ->> 'source' is distinct from 'offline_replay'
  );

commit;
