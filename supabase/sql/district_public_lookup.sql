create or replace function public.resolve_public_district_by_slug(input_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select d.id, d.name, d.slug, d.is_active
  from public.districts d
  where d.slug = lower(trim(input_slug))
    and d.is_active = true
  limit 1;
$$;

create or replace function public.resolve_public_district_by_id(input_id uuid)
returns table (
  id uuid,
  name text,
  slug text,
  is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select d.id, d.name, d.slug, d.is_active
  from public.districts d
  where d.id = input_id
    and d.is_active = true
  limit 1;
$$;

revoke all on function public.resolve_public_district_by_slug(text) from public;
revoke all on function public.resolve_public_district_by_id(uuid) from public;

grant execute on function public.resolve_public_district_by_slug(text) to anon;
grant execute on function public.resolve_public_district_by_slug(text) to authenticated;
grant execute on function public.resolve_public_district_by_id(uuid) to anon;
grant execute on function public.resolve_public_district_by_id(uuid) to authenticated;
