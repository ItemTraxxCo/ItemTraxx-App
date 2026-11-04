-- Borrower retention purge was latent-broken: item_logs.checked_out_by was
-- NOT NULL with an implicit NO ACTION foreign key, so the first expired
-- soft-deleted borrower that had any checkout history would raise a
-- foreign_key_violation and abort the whole run_data_retention() transaction
-- (including the audit-log purges that follow it).
--
-- Fix: keep the asset history row, drop the link to the purged person.
--   1. item_logs.checked_out_by becomes nullable with ON DELETE SET NULL, so
--      a hard-deleted borrower anonymizes their history instead of blocking.
--   2. run_data_retention() runs each purge step in its own sub-transaction so
--      one failing step can never stop the others, and reports failures.

begin;

alter table public.item_logs
  alter column checked_out_by drop not null;

do $$
declare
  existing_constraint text;
begin
  for existing_constraint in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.item_logs'::regclass
      and con.contype = 'f'
      and con.confrelid = 'public.borrowers'::regclass
      and con.conkey = array[(
        select att.attnum from pg_attribute att
        where att.attrelid = 'public.item_logs'::regclass
          and att.attname = 'checked_out_by'
      )]
  loop
    execute format('alter table public.item_logs drop constraint %I', existing_constraint);
  end loop;
end;
$$;

alter table public.item_logs
  add constraint item_logs_checked_out_by_fkey
  foreign key (checked_out_by) references public.borrowers(id)
  on delete set null;

create or replace function public.run_data_retention()
returns jsonb
language plpgsql security definer
set search_path = 'public'
as $$
declare
  soft_delete_cfg jsonb;
  audit_cfg jsonb;
  now_ts timestamptz := now();
  borrowers_deleted int := 0;
  items_deleted int := 0;
  admin_audit_deleted int := 0;
  super_audit_deleted int := 0;
  step_errors jsonb := '[]'::jsonb;
begin
  if to_regclass('public.data_retention_policies') is null then
    return jsonb_build_object('ran_at', now_ts, 'skipped', 'retention policy table unavailable');
  end if;

  select value into soft_delete_cfg
  from public.data_retention_policies
  where key = 'soft_delete';

  select value into audit_cfg
  from public.data_retention_policies
  where key = 'audit_logs';

  -- Each step is its own sub-transaction: a failure is recorded and the
  -- remaining steps still run.
  if coalesce((soft_delete_cfg ->> 'borrowers_enabled')::boolean, false) then
    begin
      delete from public.borrowers
      where deleted_at is not null
        and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg ->> 'borrowers_days')::int, 365)));
      get diagnostics borrowers_deleted = row_count;
    exception when others then
      step_errors := step_errors || jsonb_build_object('step', 'borrowers', 'sqlstate', sqlstate, 'message', sqlerrm);
      raise warning 'run_data_retention step borrowers failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  if coalesce((soft_delete_cfg ->> 'items_enabled')::boolean, false) then
    begin
      delete from public.items
      where deleted_at is not null
        and deleted_at < now_ts - make_interval(days => greatest(1, coalesce((soft_delete_cfg ->> 'items_days')::int, 730)));
      get diagnostics items_deleted = row_count;
    exception when others then
      step_errors := step_errors || jsonb_build_object('step', 'items', 'sqlstate', sqlstate, 'message', sqlerrm);
      raise warning 'run_data_retention step items failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  if coalesce((audit_cfg ->> 'enabled')::boolean, false) then
    begin
      delete from public.admin_audit_logs
      where created_at < now_ts - make_interval(days => greatest(30, coalesce((audit_cfg ->> 'admin_audit_days')::int, 730)));
      get diagnostics admin_audit_deleted = row_count;
    exception when others then
      step_errors := step_errors || jsonb_build_object('step', 'admin_audit_logs', 'sqlstate', sqlstate, 'message', sqlerrm);
      raise warning 'run_data_retention step admin_audit_logs failed: % (%)', sqlerrm, sqlstate;
    end;

    begin
      delete from public.super_admin_audit_logs
      where created_at < now_ts - make_interval(days => greatest(30, coalesce((audit_cfg ->> 'super_audit_days')::int, 1095)));
      get diagnostics super_audit_deleted = row_count;
    exception when others then
      step_errors := step_errors || jsonb_build_object('step', 'super_admin_audit_logs', 'sqlstate', sqlstate, 'message', sqlerrm);
      raise warning 'run_data_retention step super_admin_audit_logs failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  return jsonb_build_object(
    'ran_at', now_ts,
    'borrowers_deleted', borrowers_deleted,
    'items_deleted', items_deleted,
    'admin_audit_deleted', admin_audit_deleted,
    'super_audit_deleted', super_audit_deleted,
    'errors', step_errors
  );
end;
$$;

revoke all on function public.run_data_retention() from public, anon, authenticated;
grant execute on function public.run_data_retention() to service_role;

notify pgrst, 'reload schema';

commit;
