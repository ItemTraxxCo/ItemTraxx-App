-- Better Auth lives in a private schema so PostgREST cannot expose its
-- credentials, sessions, TOTP secrets, backup codes, or SSO configuration.
create schema if not exists better_auth;
revoke all on schema better_auth from public, anon, authenticated;

create table better_auth."user" (
  id text primary key, name text not null, email text not null unique,
  "emailVerified" boolean not null, image text,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz default current_timestamp not null,
  role text, banned boolean, "banReason" text, "banExpires" timestamptz,
  "twoFactorEnabled" boolean default false
);
create table better_auth.session (
  id text primary key, "expiresAt" timestamptz not null, token text not null unique,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text,
  "userId" text not null references better_auth."user"(id) on delete cascade,
  "activeOrganizationId" text, "impersonatedBy" text
);
create table better_auth.account (
  id text primary key, "accountId" text not null, "providerId" text not null,
  "userId" text not null references better_auth."user"(id) on delete cascade,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text, "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz not null
);
create table better_auth.verification (
  id text primary key, identifier text not null, value text not null,
  "expiresAt" timestamptz not null, "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz default current_timestamp not null
);
create table better_auth.organization (
  id text primary key, name text not null, slug text not null unique, logo text,
  "createdAt" timestamptz not null, metadata text
);
create table better_auth.member (
  id text primary key,
  "organizationId" text not null references better_auth.organization(id) on delete cascade,
  "userId" text not null references better_auth."user"(id) on delete cascade,
  role text not null, "createdAt" timestamptz not null,
  unique ("organizationId", "userId")
);
create table better_auth.invitation (
  id text primary key,
  "organizationId" text not null references better_auth.organization(id) on delete cascade,
  email text not null, role text, status text not null, "expiresAt" timestamptz not null,
  "createdAt" timestamptz default current_timestamp not null,
  "inviterId" text not null references better_auth."user"(id) on delete cascade
);
create table better_auth.passkey (
  id text primary key, name text, "publicKey" text not null,
  "userId" text not null references better_auth."user"(id) on delete cascade,
  "credentialID" text not null unique, counter integer not null,
  "deviceType" text not null, "backedUp" boolean not null, transports text,
  "createdAt" timestamptz, aaguid text
);
create table better_auth."twoFactor" (
  id text primary key, secret text not null, "backupCodes" text not null,
  "userId" text not null references better_auth."user"(id) on delete cascade,
  verified boolean default false, "failedVerificationCount" integer default 0,
  "lockedUntil" timestamptz
);
create table better_auth."ssoProvider" (
  id text primary key, issuer text not null, "oidcConfig" text, "samlConfig" text,
  "userId" text not null references better_auth."user"(id) on delete cascade,
  "providerId" text not null unique,
  "organizationId" text references better_auth.organization(id) on delete cascade,
  domain text not null, "domainVerified" boolean default false
);
create table better_auth.jwks (
  id text primary key, "publicKey" text not null, "privateKey" text not null,
  "createdAt" timestamptz not null, "expiresAt" timestamptz, alg text, crv text
);

-- The schema is not exposed through PostgREST and grants are revoked below.
-- RLS is also enabled as defense-in-depth in case the exposed-schema list or
-- grants are changed later. Better Auth connects as the database owner.
alter table better_auth."user" enable row level security;
alter table better_auth.session enable row level security;
alter table better_auth.account enable row level security;
alter table better_auth.verification enable row level security;
alter table better_auth.organization enable row level security;
alter table better_auth.member enable row level security;
alter table better_auth.invitation enable row level security;
alter table better_auth.passkey enable row level security;
alter table better_auth."twoFactor" enable row level security;
alter table better_auth."ssoProvider" enable row level security;
alter table better_auth.jwks enable row level security;

create index session_user_id_idx on better_auth.session("userId");
create index account_user_id_idx on better_auth.account("userId");
create index verification_identifier_idx on better_auth.verification(identifier);
create index member_organization_id_idx on better_auth.member("organizationId");
create index member_user_id_idx on better_auth.member("userId");
create index invitation_organization_id_idx on better_auth.invitation("organizationId");
create index invitation_email_idx on better_auth.invitation(email);
create index passkey_user_id_idx on better_auth.passkey("userId");
create index two_factor_user_id_idx on better_auth."twoFactor"("userId");
create index two_factor_secret_idx on better_auth."twoFactor"(secret);

alter table public.profiles
  add column if not exists better_auth_user_id text unique
  references better_auth."user"(id) on delete restrict;
alter table public.workspaces
  add column if not exists better_auth_organization_id text unique
  references better_auth.organization(id) on delete restrict;

-- Detach application identities from GoTrue. Historical actor references are
-- preserved; NOT VALID avoids deleting unrelated application/audit data while
-- enforcing the ItemTraxx profile relationship for every new write.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.borrowers drop constraint if exists students_deleted_by_fkey;
alter table public.borrowers add constraint borrowers_deleted_by_profile_fkey foreign key (deleted_by) references public.profiles(id) on delete set null not valid;
alter table public.items drop constraint if exists gear_deleted_by_fkey;
alter table public.items add constraint items_deleted_by_profile_fkey foreign key (deleted_by) references public.profiles(id) on delete set null not valid;
alter table public.item_logs drop constraint if exists gear_logs_performed_by_fkey;
alter table public.item_logs add constraint item_logs_performed_by_profile_fkey foreign key (performed_by) references public.profiles(id) not valid;
alter table public.item_status_history drop constraint if exists gear_status_history_changed_by_fkey;
alter table public.item_status_history add constraint item_status_history_changed_by_profile_fkey foreign key (changed_by) references public.profiles(id) on delete set null not valid;
alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_actor_id_fkey;
alter table public.admin_audit_logs add constraint admin_audit_logs_actor_id_profile_fkey foreign key (actor_id) references public.profiles(id) not valid;
alter table public.workspace_policies drop constraint if exists workspace_policies_updated_by_fkey;
alter table public.workspace_policies add constraint workspace_policies_updated_by_profile_fkey foreign key (updated_by) references public.profiles(id) on delete set null not valid;
alter table public.workspace_security_controls drop constraint if exists workspace_security_controls_updated_by_fkey;
alter table public.workspace_security_controls add constraint workspace_security_controls_updated_by_profile_fkey foreign key (updated_by) references public.profiles(id) on delete set null not valid;
alter table public.app_runtime_config drop constraint if exists app_runtime_config_updated_by_fkey;
alter table public.app_runtime_config add constraint app_runtime_config_updated_by_profile_fkey foreign key (updated_by) references public.profiles(id) on delete set null not valid;

-- The ItemTraxx workspace UUID is reused as the organization text ID. This is
-- deliberate and removes ambiguity while the explicit foreign key keeps the
-- two models synchronized.
insert into better_auth.organization (id, name, slug, "createdAt")
select w.id::text, w.name, w.slug, coalesce(w.created_at, now())
from public.workspaces w
on conflict (id) do update set name = excluded.name, slug = excluded.slug;

update public.workspaces
set better_auth_organization_id = id::text
where better_auth_organization_id is distinct from id::text;

comment on column public.profiles.better_auth_user_id is
  'Stable mapping to Better Auth. Better Auth JWT sub remains the ItemTraxx profile UUID for existing RLS.';
comment on column public.workspaces.better_auth_organization_id is
  'Stable one-to-one mapping to the Better Auth organization used for membership and enterprise SSO.';

revoke all on all tables in schema better_auth from public, anon, authenticated;
grant usage on schema better_auth to postgres, service_role;
grant all on all tables in schema better_auth to postgres, service_role;

-- Preserve the existing RLS contract without retaining Supabase Auth's
-- auth.sessions table. The externally minted JWT subject is the ItemTraxx
-- profile UUID; session_id is the Better Auth session UUID.
create or replace function private.current_account_session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select public.current_user_role()) = 'super_admin'
      then exists (
        select 1
        from better_auth.session s
        join public.profiles p on p.better_auth_user_id = s."userId"
        where p.id = (select auth.uid())
          and s.id = (select auth.jwt() ->> 'session_id')
          and s."expiresAt" > now()
      ) and (select private.super_admin_session_not_revoked())
    else exists (
      select 1
      from better_auth.session s
      join public.profiles p on p.better_auth_user_id = s."userId"
      where p.id = (select auth.uid())
        and s.id = (select auth.jwt() ->> 'session_id')
        and s."expiresAt" > now()
        and p.is_active
        and p.deleted_at is null
    )
  end;
$$;

revoke all on function private.current_account_session_is_active() from public, anon, authenticated;
grant execute on function private.current_account_session_is_active() to authenticated, service_role;
