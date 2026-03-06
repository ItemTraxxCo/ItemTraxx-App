create table if not exists public.districts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  support_email text,
  contact_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.districts
  drop constraint if exists districts_slug_format_check;

alter table if exists public.districts
  add constraint districts_slug_format_check
  check (slug ~ '^[a-z0-9-]{2,63}$');

create index if not exists idx_districts_slug
  on public.districts (slug);

alter table if exists public.tenants
  add column if not exists district_id uuid null references public.districts(id) on delete set null;

create index if not exists idx_tenants_district_id
  on public.tenants (district_id);

alter table if exists public.districts enable row level security;

drop policy if exists "super_admin_all_districts" on public.districts;
create policy "super_admin_all_districts"
  on public.districts
  for all
  to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');
