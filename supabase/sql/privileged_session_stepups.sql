create table if not exists public.privileged_session_stepups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_scope text not null check (role_scope in ('super_admin', 'tenant_admin', 'district_admin')),
  binding_key text not null,
  issued_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists privileged_session_stepups_binding_uidx
  on public.privileged_session_stepups (user_id, role_scope, binding_key);

create index if not exists privileged_session_stepups_lookup_idx
  on public.privileged_session_stepups (user_id, role_scope, expires_at desc);

create or replace function public.touch_privileged_session_stepups_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_privileged_session_stepups_updated_at on public.privileged_session_stepups;
create trigger trg_privileged_session_stepups_updated_at
before update on public.privileged_session_stepups
for each row
execute function public.touch_privileged_session_stepups_updated_at();

alter table public.privileged_session_stepups enable row level security;
