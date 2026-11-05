-- Durable, append-only legal assent trail.
--
-- public.legal_acceptances already exists in production (created from
-- supabase/archive/sql-legacy/legal_acceptances.sql, never in the migration
-- chain). This migration brings that table under migration control and extends
-- it so every acceptance of a Terms of Service, Privacy Policy, Student
-- Privacy Notice, or DPA records WHO (profile + workspace), WHAT (document
-- type, version, content hash), and WHERE/WHEN (IP, user agent, timestamp).
--
-- Server-side registry: the browser cannot invent a document. A row may only
-- be accepted when (document_type, document_version, document_hash) matches
-- an active row in public.legal_document_versions, which only service_role /
-- migrations can write.

begin;

-- 1. Baseline (no-op where the table already exists).
create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  terms_version text not null check (length(terms_version) between 1 and 32),
  acceptance_method text not null,
  agreement_context text not null,
  ip_hash text null check (ip_hash is null or length(ip_hash) = 64),
  user_agent text null check (user_agent is null or length(user_agent) <= 500),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 2. New columns.
alter table public.legal_acceptances
  add column if not exists workspace_id uuid null,
  add column if not exists document_type text null,
  add column if not exists document_version text null,
  add column if not exists document_hash text null,
  add column if not exists ip_address inet null;

-- 3. Loosen legacy constraints that block the richer model.
--    * one row per (profile, terms_version) can no longer hold several
--      document types that share a version label;
--    * legacy acceptance_method allow-list gains the generic 'clickwrap';
--    * identity links must survive profile/workspace deletion as nulls so the
--      evidence is not destroyed with the account.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.legal_acceptances'::regclass
      and (
        (con.contype = 'u' and pg_get_constraintdef(con.oid) ilike '%terms_version%')
        or (con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%acceptance_method%')
        or (con.contype = 'f' and con.confrelid = 'public.profiles'::regclass)
      )
  loop
    execute format('alter table public.legal_acceptances drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table public.legal_acceptances
  alter column profile_id drop not null,
  alter column terms_version drop not null,
  alter column agreement_context drop not null;

alter table public.legal_acceptances
  add constraint legal_acceptances_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete set null,
  add constraint legal_acceptances_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete set null,
  add constraint legal_acceptances_method_check
    check (acceptance_method in ('admin_login_clickwrap', 'signed_school_agreement', 'clickwrap')),
  add constraint legal_acceptances_document_type_check
    check (document_type is null or document_type in
      ('terms_of_service', 'privacy_policy', 'student_privacy_notice', 'dpa')),
  add constraint legal_acceptances_document_hash_check
    check (document_hash is null or document_hash ~ '^[0-9a-f]{64}$'),
  add constraint legal_acceptances_document_version_check
    check (document_version is null or length(document_version) between 1 and 64),
  add constraint legal_acceptances_document_fields_check
    check (
      (document_type is null and document_version is null and document_hash is null)
      or (document_type is not null and document_version is not null and document_hash is not null)
    );

create unique index if not exists legal_acceptances_profile_document_uidx
  on public.legal_acceptances (profile_id, document_type, document_version)
  where profile_id is not null and document_type is not null;

create index if not exists legal_acceptances_workspace_idx
  on public.legal_acceptances (workspace_id, accepted_at desc)
  where workspace_id is not null;

-- 4. Immutability. Rows are append-only; the only permitted change is the
--    foreign-key nulling of profile_id / workspace_id when an account or
--    workspace is deleted.
create or replace function private.legal_acceptances_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'profile_id' - 'workspace_id')
         is not distinct from (to_jsonb(old) - 'profile_id' - 'workspace_id')
       and (new.profile_id is null or new.profile_id is not distinct from old.profile_id)
       and (new.workspace_id is null or new.workspace_id is not distinct from old.workspace_id) then
      return new;
    end if;
  end if;
  raise exception 'legal_acceptances is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists legal_acceptances_immutable_row on public.legal_acceptances;
create trigger legal_acceptances_immutable_row
  before update or delete on public.legal_acceptances
  for each row execute function private.legal_acceptances_immutable();

drop trigger if exists legal_acceptances_immutable_truncate on public.legal_acceptances;
create trigger legal_acceptances_immutable_truncate
  before truncate on public.legal_acceptances
  for each statement execute function private.legal_acceptances_immutable();

alter table public.legal_acceptances enable row level security;
revoke all on table public.legal_acceptances from public, anon, authenticated;
revoke update, delete, truncate on table public.legal_acceptances from service_role;
grant select, insert on table public.legal_acceptances to service_role;

-- 5. Registry of publishable document versions.
create table if not exists public.legal_document_versions (
  document_type text not null
    check (document_type in ('terms_of_service', 'privacy_policy', 'student_privacy_notice', 'dpa')),
  version text not null check (length(version) between 1 and 64),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  url_path text not null check (url_path ~ '^/'),
  required_for_roles text[] not null
    default array['workspace_admin', 'tenant_account', 'individual_account']::text[],
  effective_at timestamptz not null default now(),
  retired_at timestamptz null,
  created_at timestamptz not null default now(),
  primary key (document_type, version)
);

alter table public.legal_document_versions enable row level security;
revoke all on table public.legal_document_versions from public, anon, authenticated;
grant select, insert, update on table public.legal_document_versions to service_role;

-- 6. Documents a profile still has to accept: for each document type, the
--    newest effective, non-retired version that applies to the profile's role
--    and that the profile has not yet accepted.
create or replace function public.list_pending_legal_acceptances(p_profile_id uuid)
returns table (
  document_type text,
  document_version text,
  document_hash text,
  url_path text,
  effective_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_role text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select p.role into profile_role from public.profiles p where p.id = p_profile_id;
  if profile_role is null then
    return;
  end if;

  return query
  with current_documents as (
    select distinct on (v.document_type)
      v.document_type, v.version, v.content_sha256, v.url_path, v.effective_at
    from public.legal_document_versions v
    where v.retired_at is null
      and v.effective_at <= now()
      and profile_role = any (v.required_for_roles)
    order by v.document_type, v.effective_at desc, v.version desc
  )
  select c.document_type, c.version, c.content_sha256, c.url_path, c.effective_at
  from current_documents c
  where not exists (
    select 1 from public.legal_acceptances a
    where a.profile_id = p_profile_id
      and a.document_type = c.document_type
      and a.document_version = c.version
  )
  order by c.document_type;
end;
$$;

-- 7. Record an acceptance. Idempotent per (profile, type, version); validates
--    the submitted version/hash against the registry.
create or replace function public.record_legal_acceptance(
  p_profile_id uuid,
  p_document_type text,
  p_document_version text,
  p_document_hash text,
  p_ip_address text,
  p_user_agent text,
  p_acceptance_method text default 'clickwrap'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles%rowtype;
  registry_row public.legal_document_versions%rowtype;
  existing_row public.legal_acceptances%rowtype;
  inserted_row public.legal_acceptances%rowtype;
  parsed_ip inet;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select * into profile_row from public.profiles where id = p_profile_id;
  if not found or profile_row.is_active is not true or profile_row.deleted_at is not null then
    raise exception 'Account access denied' using errcode = '42501';
  end if;

  select * into registry_row
  from public.legal_document_versions v
  where v.document_type = p_document_type
    and v.version = p_document_version
    and v.content_sha256 = lower(p_document_hash)
    and v.retired_at is null
    and v.effective_at <= now();
  if not found then
    raise exception 'Unknown or retired legal document version' using errcode = '22023';
  end if;

  if not (profile_row.role = any (registry_row.required_for_roles)) then
    raise exception 'Document does not apply to this account' using errcode = '42501';
  end if;

  select * into existing_row
  from public.legal_acceptances a
  where a.profile_id = p_profile_id
    and a.document_type = p_document_type
    and a.document_version = p_document_version;
  if found then
    return jsonb_build_object('accepted_at', existing_row.accepted_at, 'already_accepted', true);
  end if;

  begin
    parsed_ip := nullif(btrim(p_ip_address), '')::inet;
  exception when others then
    parsed_ip := null;
  end;

  insert into public.legal_acceptances (
    profile_id, workspace_id, document_type, document_version, document_hash,
    terms_version, acceptance_method, agreement_context, ip_address, user_agent
  )
  values (
    p_profile_id, profile_row.workspace_id, p_document_type, p_document_version,
    registry_row.content_sha256, left(p_document_version, 32),
    case when p_acceptance_method in ('clickwrap', 'admin_login_clickwrap', 'signed_school_agreement')
      then p_acceptance_method else 'clickwrap' end,
    'document_acceptance', parsed_ip, left(p_user_agent, 500)
  )
  returning * into inserted_row;

  return jsonb_build_object('accepted_at', inserted_row.accepted_at, 'already_accepted', false);
end;
$$;

revoke all on function public.list_pending_legal_acceptances(uuid) from public, anon, authenticated;
revoke all on function public.record_legal_acceptance(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.list_pending_legal_acceptances(uuid) to service_role;
grant execute on function public.record_legal_acceptance(uuid, text, text, text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
