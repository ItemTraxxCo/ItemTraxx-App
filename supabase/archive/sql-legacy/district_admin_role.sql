alter table if exists public.profiles
  add column if not exists district_id uuid null references public.districts(id) on delete set null;

create index if not exists idx_profiles_district_id
  on public.profiles (district_id);

create or replace function public.current_district_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.district_id
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.current_district_id() from public;
grant execute on function public.current_district_id() to authenticated, service_role;
