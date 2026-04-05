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

create or replace function public.current_session_binding_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when coalesce(auth.jwt() ->> 'session_id', '') <> ''
        then 'session:' || (auth.jwt() ->> 'session_id')
      else null
    end;
$$;

create or replace function public.has_recent_privileged_step_up(p_role_scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.privileged_session_stepups s
    where s.user_id = auth.uid()
      and s.role_scope = p_role_scope
      and s.binding_key = public.current_session_binding_key()
      and s.expires_at > now()
  );
$$;

revoke all on function public.current_session_binding_key() from public, anon, authenticated;
revoke all on function public.has_recent_privileged_step_up(text) from public, anon, authenticated;
grant execute on function public.current_session_binding_key() to authenticated, service_role;
grant execute on function public.has_recent_privileged_step_up(text) to authenticated, service_role;
