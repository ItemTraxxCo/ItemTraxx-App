-- Remove anonymous table-level write access from peripheral tables.
-- Some environments do not have the full legacy table set yet, so each
-- REVOKE is guarded and the migration remains safe to apply across schema drift.
-- These writes remain available to server-side service_role code. Other anon
-- privileges (including SELECT, REFERENCES, TRIGGER, and MAINTAIN) are unchanged.
do $migration$
begin
  if pg_catalog.to_regclass('public.async_jobs') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.async_jobs FROM anon';
  end if;

  if pg_catalog.to_regclass('public.client_error_reports') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.client_error_reports FROM anon';
  end if;

  if pg_catalog.to_regclass('public.data_retention_policies') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.data_retention_policies FROM anon';
  end if;

  if pg_catalog.to_regclass('public.email_delivery_logs') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.email_delivery_logs FROM anon';
  end if;

  if pg_catalog.to_regclass('public.subprocessor_changes') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.subprocessor_changes FROM anon';
  end if;

  if pg_catalog.to_regclass('public.super_admin_audit_logs') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.super_admin_audit_logs FROM anon';
  end if;

  if pg_catalog.to_regclass('public.super_admin_email_challenges') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.super_admin_email_challenges FROM anon';
  end if;

  if pg_catalog.to_regclass('public.super_alert_rules') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.super_alert_rules FROM anon';
  end if;

  if pg_catalog.to_regclass('public.super_jobs') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.super_jobs FROM anon';
  end if;

  if pg_catalog.to_regclass('public.support_request_attachments') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.support_request_attachments FROM anon';
  end if;

  if pg_catalog.to_regclass('public.support_request_events') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.support_request_events FROM anon';
  end if;

  if pg_catalog.to_regclass('public.support_requests') is not null then
    execute 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.support_requests FROM anon';
  end if;
end;
$migration$;
