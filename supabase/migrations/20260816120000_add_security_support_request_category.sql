do $$
begin
  if to_regclass('public.support_requests') is not null then
    alter table public.support_requests
      drop constraint if exists support_requests_category_check;

    alter table public.support_requests
      add constraint support_requests_category_check
      check (category in ('general', 'bug', 'billing', 'access', 'feature', 'privacy', 'security', 'other'));
  end if;
end $$;
