-- Enforce tenant-scoped borrower identity uniqueness for active borrower rows.
-- Run this before deploying admin-borrower-mutate changes.
--
-- Preflight duplicate checks. These should return zero rows before indexes are created:
-- select tenant_id, borrower_id, count(*)
-- from public.borrowers
-- where deleted_at is null
-- group by tenant_id, borrower_id
-- having count(*) > 1;
--
-- select tenant_id, lower(username), count(*)
-- from public.borrowers
-- where deleted_at is null
-- group by tenant_id, lower(username)
-- having count(*) > 1;

create unique index if not exists borrowers_active_tenant_borrower_id_unique
  on public.borrowers (tenant_id, borrower_id)
  where deleted_at is null;

create unique index if not exists borrowers_active_tenant_username_unique
  on public.borrowers (tenant_id, lower(username))
  where deleted_at is null;

create or replace function public.create_borrower_identity(
  p_tenant_id uuid,
  p_username text,
  p_borrower_id text
)
returns table (
  id uuid,
  tenant_id uuid,
  username text,
  borrower_id text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_username text := coalesce(trim(p_username), '');
  normalized_borrower_id text := upper(coalesce(trim(p_borrower_id), ''));
begin
  if p_tenant_id is null then
    raise exception 'Tenant is required' using errcode = '22023';
  end if;

  if normalized_username = '' or normalized_borrower_id = '' then
    raise exception 'Borrower identity is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':borrower_id:' || normalized_borrower_id, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':username:' || lower(normalized_username), 0)
  );

  if exists (
    select 1
    from public.borrowers s
    where s.tenant_id = p_tenant_id
      and s.deleted_at is null
      and (
        s.borrower_id = normalized_borrower_id
        or lower(s.username) = lower(normalized_username)
      )
  ) then
    raise exception 'Borrower identity already exists' using errcode = '23505';
  end if;

  return query
  insert into public.borrowers as s (tenant_id, username, borrower_id)
  values (p_tenant_id, normalized_username, normalized_borrower_id)
  returning s.id, s.tenant_id, s.username, s.borrower_id;
end;
$$;

revoke all on function public.create_borrower_identity(uuid, text, text) from public;
revoke all on function public.create_borrower_identity(uuid, text, text) from anon;
revoke all on function public.create_borrower_identity(uuid, text, text) from authenticated;
grant execute on function public.create_borrower_identity(uuid, text, text) to service_role;
