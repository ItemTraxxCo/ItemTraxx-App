-- Isolated local database only. Restore the old production constraint and then
-- exercise the migration; the surrounding transaction rolls everything back.
\set ON_ERROR_STOP on
begin;
alter table public.borrowers drop constraint if exists borrowers_borrower_id_format_check;
alter table public.borrowers add constraint borrowers_borrower_id_format_check check (borrower_id ~ '^[0-9]{4}[A-Z]{2}$') not valid;
insert into public.workspaces(id,name,slug,status) values ('7e3c7242-9e28-420e-b32e-c88cc62c2b01','ID Test','synthetic-id-format','active');
do $$ begin
  begin
    insert into public.borrowers(workspace_id,username,borrower_id) values ('7e3c7242-9e28-420e-b32e-c88cc62c2b01','test-legacy','employee-42');
    raise exception 'legacy constraint did not reject the freeform ID';
  exception when check_violation then null; end;
end $$;
\ir ../migrations/20261124170718_remove_legacy_borrower_id_format.sql
insert into public.borrowers(workspace_id,username,borrower_id) values
 ('7e3c7242-9e28-420e-b32e-c88cc62c2b01','test-freeform','employee-42'),
 ('7e3c7242-9e28-420e-b32e-c88cc62c2b01','test-legacy','1234AB'),
 ('7e3c7242-9e28-420e-b32e-c88cc62c2b01','test-encrypted',null);
rollback;
