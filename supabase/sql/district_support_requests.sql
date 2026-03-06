create table if not exists public.district_support_requests (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  requester_email text,
  requester_name text,
  subject text not null,
  message text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists district_support_requests_district_created_idx
  on public.district_support_requests (district_id, created_at desc);

alter table public.district_support_requests enable row level security;

drop policy if exists "district_admin_select_own_support_requests" on public.district_support_requests;
create policy "district_admin_select_own_support_requests"
  on public.district_support_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'district_admin'
        and p.district_id = district_support_requests.district_id
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'super_admin'
    )
  );

drop policy if exists "district_admin_insert_own_support_requests" on public.district_support_requests;
create policy "district_admin_insert_own_support_requests"
  on public.district_support_requests
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'district_admin'
        and p.district_id = district_support_requests.district_id
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'super_admin'
    )
  );
