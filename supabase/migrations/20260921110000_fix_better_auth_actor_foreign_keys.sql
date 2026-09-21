begin;

-- Better Auth profile UUIDs are the application actor IDs now. The original
-- GoTrue foreign keys were left behind because the Better Auth migration used
-- pre-rename constraint names (for example, gear_logs_performed_by_fkey).
-- Those stale references reject valid individual-account writes because the
-- profile UUID intentionally has no matching auth.users row.
alter table public.borrowers
  drop constraint if exists borrowers_deleted_by_fkey;
alter table public.items
  drop constraint if exists item_deleted_by_fkey;
alter table public.item_logs
  drop constraint if exists item_logs_performed_by_fkey;
alter table public.item_status_history
  drop constraint if exists item_status_history_changed_by_fkey;
alter table public.workspace_policies
  drop constraint if exists tenant_policies_updated_by_fkey;
alter table public.workspace_security_controls
  drop constraint if exists tenant_security_controls_updated_by_fkey;

commit;
