\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','c63381c3-259c-44f6-98d6-ad24d5eab301',true);
select set_config('request.jwt.claims','{"sub":"c63381c3-259c-44f6-98d6-ad24d5eab301"}',true);
do $$ declare allowed boolean; begin
  for i in 1..240 loop
    select r.allowed into allowed from public.consume_rate_limit('borrower_directory',240,60) r;
    if not allowed then raise exception 'directory limit rejected request %',i; end if;
  end loop;
  select r.allowed into allowed from public.consume_rate_limit('borrower_directory',9999,60) r;
  if allowed then raise exception 'directory limit was bypassed'; end if;
  select r.allowed into allowed from public.consume_rate_limit('borrower_directory_archived',240,60) r;
  if not allowed then raise exception 'active directory exhausted archived bucket'; end if;
  for i in 1..30 loop
    select r.allowed into allowed from public.consume_rate_limit('admin',30,60) r;
    if not allowed then raise exception 'directory used mutation bucket'; end if;
  end loop;
  select r.allowed into allowed from public.consume_rate_limit('admin',9999,60) r;
  if allowed then raise exception 'admin limit was bypassed'; end if;
end $$;
rollback;
