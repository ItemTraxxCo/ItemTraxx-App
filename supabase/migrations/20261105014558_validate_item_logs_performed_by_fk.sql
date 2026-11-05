-- Validate the legacy actor FK after confirming there are no existing orphans.
-- This makes the full item_logs referential-integrity check explicit.
begin;

do $$
declare
  constraint_is_valid boolean;
begin
  select con.convalidated
    into constraint_is_valid
  from pg_catalog.pg_constraint con
  where con.conrelid = 'public.item_logs'::regclass
    and con.conname = 'item_logs_performed_by_profile_fkey'
    and con.contype = 'f';

  if not found then
    raise exception 'Expected item_logs profile foreign key is missing';
  end if;

  if not constraint_is_valid then
    execute 'alter table public.item_logs validate constraint item_logs_performed_by_profile_fkey';
  end if;
end;
$$;

commit;
