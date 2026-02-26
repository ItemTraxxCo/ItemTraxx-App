drop materialized view if exists public.super_reporting_tenant_metrics;

create materialized view public.super_reporting_tenant_metrics as
with gear_counts as (
  select
    g.tenant_id,
    count(*) filter (where g.deleted_at is null) as gear_total,
    count(*) filter (
      where g.deleted_at is null
        and g.status = 'checked_out'
    ) as active_checkouts,
    count(*) filter (
      where g.deleted_at is null
        and g.status = 'checked_out'
        and g.created_at <= now() - interval '14 days'
    ) as overdue_items
  from public.gear g
  group by g.tenant_id
),
student_counts as (
  select
    s.tenant_id,
    count(*) filter (where s.deleted_at is null) as students_total
  from public.students s
  group by s.tenant_id
),
tx_counts as (
  select
    gl.tenant_id,
    count(*) filter (
      where gl.action_time >= now() - interval '7 days'
    ) as transactions_7d
  from public.gear_logs gl
  group by gl.tenant_id
)
select
  t.id as tenant_id,
  t.name as tenant_name,
  coalesce(gc.gear_total, 0)::bigint as gear_total,
  coalesce(sc.students_total, 0)::bigint as students_total,
  coalesce(gc.active_checkouts, 0)::bigint as active_checkouts,
  coalesce(gc.overdue_items, 0)::bigint as overdue_items,
  coalesce(tx.transactions_7d, 0)::bigint as transactions_7d,
  now() as computed_at
from public.tenants t
left join gear_counts gc on gc.tenant_id = t.id
left join student_counts sc on sc.tenant_id = t.id
left join tx_counts tx on tx.tenant_id = t.id;

create unique index if not exists super_reporting_tenant_metrics_tenant_id_idx
  on public.super_reporting_tenant_metrics (tenant_id);

create or replace function public.refresh_super_reporting_views()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.super_reporting_tenant_metrics;
end;
$$;
