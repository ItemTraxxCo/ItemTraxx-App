-- Data governance and retention baseline

create table if not exists public.data_retention_policies (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.data_retention_policies (key, value)
values
  ('soft_delete', '{"students_days": 365, "gear_days": 365, "enabled": false}'::jsonb),
  ('audit_logs', '{"admin_audit_days": 730, "super_audit_days": 1095, "enabled": false}'::jsonb)
on conflict (key) do nothing;

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
  students_deleted int := 0;
  gear_deleted int := 0;
  admin_audit_deleted int := 0;
  super_audit_deleted int := 0;
begin
  select value into soft_delete_cfg
  from public.data_retention_policies
  where key = 'soft_delete';

  if coalesce((soft_delete_cfg->>'enabled')::boolean, false) then
    delete from public.students
    where deleted_at is not null
      and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg->>'students_days')::int, 365)));
    get diagnostics students_deleted = row_count;

    delete from public.gear
    where deleted_at is not null
      and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg->>'gear_days')::int, 365)));
    get diagnostics gear_deleted = row_count;
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
    'students_deleted', students_deleted,
    'gear_deleted', gear_deleted,
    'admin_audit_deleted', admin_audit_deleted,
    'super_audit_deleted', super_audit_deleted
  );
end;
$$;

revoke all on function public.run_data_retention() from public;
grant execute on function public.run_data_retention() to service_role;
