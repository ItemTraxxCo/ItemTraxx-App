create table if not exists public.super_admin_email_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  purpose text not null default 'super_admin_login' check (purpose in ('super_admin_login')),
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists super_admin_email_challenges_user_idx
  on public.super_admin_email_challenges (user_id, purpose, created_at desc);

create index if not exists super_admin_email_challenges_active_idx
  on public.super_admin_email_challenges (user_id, purpose, used_at, expires_at);

create or replace function public.touch_super_admin_email_challenges_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_super_admin_email_challenges_updated_at on public.super_admin_email_challenges;
create trigger trg_super_admin_email_challenges_updated_at
before update on public.super_admin_email_challenges
for each row
execute function public.touch_super_admin_email_challenges_updated_at();

alter table public.super_admin_email_challenges enable row level security;
