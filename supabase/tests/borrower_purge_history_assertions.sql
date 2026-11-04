\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'item_logs'
      and column_name = 'checked_out_by' and is_nullable = 'NO'
  ) then
    raise exception 'item_logs.checked_out_by must be nullable so history survives borrower purge';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.item_logs'::regclass
      and confrelid = 'public.borrowers'::regclass
      and contype = 'f'
      and confdeltype = 'n'
  ) then
    raise exception 'item_logs -> borrowers foreign key must be ON DELETE SET NULL';
  end if;

  if position('step_errors' in lower(pg_get_functiondef('public.run_data_retention()'::regprocedure))) = 0 then
    raise exception 'run_data_retention must isolate and report per-step failures';
  end if;
end;
$$;
