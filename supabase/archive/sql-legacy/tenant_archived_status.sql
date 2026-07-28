alter table if exists public.tenants
  drop constraint if exists tenants_status_check;

alter table if exists public.tenants
  add constraint tenants_status_check
  check (status in ('active', 'suspended', 'archived'));
