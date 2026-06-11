create table if not exists public.cookie_consent_records (
  subject_id uuid not null default gen_random_uuid(),
  profile_id uuid null references public.profiles(id) on delete set null,
  consent_version integer not null check (consent_version > 0),
  analytics boolean not null,
  diagnostics boolean not null,
  consented_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (subject_id, consent_version)
);

alter table public.cookie_consent_records
  add column if not exists subject_id uuid;
alter table public.cookie_consent_records
  drop constraint if exists cookie_consent_records_pkey;
alter table public.cookie_consent_records
  drop constraint if exists cookie_consent_records_profile_id_fkey;
alter table public.cookie_consent_records
  alter column profile_id drop not null;
update public.cookie_consent_records
set subject_id = gen_random_uuid()
where subject_id is null;
alter table public.cookie_consent_records
  alter column subject_id set not null;
alter table public.cookie_consent_records
  add constraint cookie_consent_records_pkey primary key (subject_id, consent_version);
alter table public.cookie_consent_records
  add constraint cookie_consent_records_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;
create unique index if not exists cookie_consent_subject_version_uidx
  on public.cookie_consent_records (subject_id, consent_version);
create unique index if not exists cookie_consent_profile_version_uidx
  on public.cookie_consent_records (profile_id, consent_version)
  where profile_id is not null;

alter table public.cookie_consent_records enable row level security;
revoke all on table public.cookie_consent_records from public, anon, authenticated;
grant select, insert, update on table public.cookie_consent_records to service_role;
