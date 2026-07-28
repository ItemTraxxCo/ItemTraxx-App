-- Enforce reasonable email syntax for new and updated rows without blocking rollout on legacy data.
do $$
declare
  target record;
  constraint_name text;
begin
  for target in
    select * from (values
      ('district_support_requests', 'requester_email'),
      ('districts', 'support_email'),
      ('super_admin_email_challenges', 'email'),
      ('super_admin_audit_logs', 'actor_email'),
      ('email_delivery_logs', 'recipient_email'),
      ('district_subscriptions', 'billing_email'),
      ('support_requests', 'reply_email'),
      ('support_request_events', 'actor_email'),
      ('district_session_handoffs', 'auth_email'),
      ('sales_leads', 'reply_email')
    ) as columns(table_name, column_name)
  loop
    if to_regclass('public.' || target.table_name) is null then
      continue;
    end if;
    constraint_name := target.table_name || '_' || target.column_name || '_email_format_check';
    if not exists (
      select 1 from pg_constraint
      where conname = constraint_name
        and conrelid = to_regclass('public.' || target.table_name)
    ) then
      execute format(
        'alter table public.%I add constraint %I check (%I is null or %I ~* %L) not valid',
        target.table_name,
        constraint_name,
        target.column_name,
        target.column_name,
        '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
      );
    end if;
  end loop;
end
$$;
