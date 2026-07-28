alter table if exists public.item_logs
  add column if not exists operation_id text;

create unique index if not exists idx_item_logs_operation_dedupe
  on public.item_logs (tenant_id, item_id, action_type, operation_id)
  where operation_id is not null;
