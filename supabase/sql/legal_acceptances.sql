create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  terms_version text not null check (length(terms_version) between 1 and 32),
  acceptance_method text not null check (acceptance_method in ('admin_login_clickwrap', 'signed_school_agreement')),
  agreement_context text not null,
  ip_hash text null check (ip_hash is null or length(ip_hash) = 64),
  user_agent text null check (user_agent is null or length(user_agent) <= 500),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (profile_id, terms_version)
);

create index if not exists legal_acceptances_accepted_at_idx
  on public.legal_acceptances (accepted_at desc);

alter table public.legal_acceptances enable row level security;

revoke all on table public.legal_acceptances from public, anon, authenticated;
grant select, insert, update on table public.legal_acceptances to service_role;
