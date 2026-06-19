alter table if exists public.gear_logs
  add column if not exists operation_id text;

create unique index if not exists idx_gear_logs_operation_dedupe
  on public.gear_logs (tenant_id, gear_id, action_type, operation_id)
  where operation_id is not null;
