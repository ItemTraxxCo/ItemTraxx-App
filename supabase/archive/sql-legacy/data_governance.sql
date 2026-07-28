-- Data governance and retention baseline

create table if not exists public.data_retention_policies (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.data_retention_policies (key, value)
values
  ('soft_delete', '{"borrowers_days": 365, "borrowers_enabled": true, "item_days": 730, "item_enabled": true}'::jsonb),
  ('audit_logs', '{"admin_audit_days": 730, "super_audit_days": 1095, "enabled": true}'::jsonb)
on conflict (key) do nothing;

update public.data_retention_policies
set
  value = value || jsonb_build_object(
    'admin_audit_days', 730,
    'super_audit_days', 1095,
    'enabled', true
  ),
  updated_at = now()
where key = 'audit_logs';

update public.data_retention_policies
set
  value = (value - 'enabled') || jsonb_build_object(
    'borrowers_days', 365,
    'borrowers_enabled', true,
    'item_days', 730,
    'item_enabled', true
  ),
  updated_at = now()
where key = 'soft_delete';

create or replace function public.run_data_retention()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  soft_delete_cfg jsonb;
  audit_cfg jsonb;
  now_ts timestamptz := now();
  borrowers_deleted int := 0;
  item_deleted int := 0;
  admin_audit_deleted int := 0;
  super_audit_deleted int := 0;
begin
  select value into soft_delete_cfg
  from public.data_retention_policies
  where key = 'soft_delete';

  if coalesce((soft_delete_cfg->>'borrowers_enabled')::boolean, false) then
    delete from public.borrowers
    where deleted_at is not null
      and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg->>'borrowers_days')::int, 365)));
    get diagnostics borrowers_deleted = row_count;
  end if;

  if coalesce((soft_delete_cfg->>'item_enabled')::boolean, false) then
    delete from public.items
    where deleted_at is not null
      and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg->>'item_days')::int, 730)));
    get diagnostics item_deleted = row_count;
  end if;

  select value into audit_cfg
  from public.data_retention_policies
  where key = 'audit_logs';

  if coalesce((audit_cfg->>'enabled')::boolean, false) then
    delete from public.admin_audit_logs
    where created_at < now_ts - make_interval(days => greatest(30, coalesce((audit_cfg->>'admin_audit_days')::int, 730)));
    get diagnostics admin_audit_deleted = row_count;

    delete from public.super_admin_audit_logs
    where created_at < now_ts - make_interval(days => greatest(30, coalesce((audit_cfg->>'super_audit_days')::int, 1095)));
    get diagnostics super_audit_deleted = row_count;
  end if;

  return jsonb_build_object(
    'ran_at', now_ts,
    'borrowers_deleted', borrowers_deleted,
    'item_deleted', item_deleted,
    'admin_audit_deleted', admin_audit_deleted,
    'super_audit_deleted', super_audit_deleted
  );
end;
$$;

revoke all on function public.run_data_retention() from public, anon, authenticated;
grant execute on function public.run_data_retention() to service_role;

create extension if not exists pg_cron;

select cron.schedule(
  'itemtraxx-audit-log-retention',
  '30 3 * * *',
  'select public.run_data_retention();'
);
