-- Enforce tenant-scoped borrower identity uniqueness for active borrower rows.
-- Run this before deploying admin-student-mutate changes.
--
-- Preflight duplicate checks. These should return zero rows before indexes are created:
-- select tenant_id, student_id, count(*)
-- from public.students
-- where deleted_at is null
-- group by tenant_id, student_id
-- having count(*) > 1;
--
-- select tenant_id, lower(username), count(*)
-- from public.students
-- where deleted_at is null
-- group by tenant_id, lower(username)
-- having count(*) > 1;

create unique index if not exists students_active_tenant_student_id_unique
  on public.students (tenant_id, student_id)
  where deleted_at is null;

create unique index if not exists students_active_tenant_username_unique
  on public.students (tenant_id, lower(username))
  where deleted_at is null;

create or replace function public.create_student_identity(
  p_tenant_id uuid,
  p_username text,
  p_student_id text
)
returns table (
  id uuid,
  tenant_id uuid,
  username text,
  student_id text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_username text := coalesce(trim(p_username), '');
  normalized_student_id text := upper(coalesce(trim(p_student_id), ''));
begin
  if p_tenant_id is null then
    raise exception 'Tenant is required' using errcode = '22023';
  end if;

  if normalized_username = '' or normalized_student_id = '' then
    raise exception 'Borrower identity is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':student_id:' || normalized_student_id, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':username:' || lower(normalized_username), 0)
  );

  if exists (
    select 1
    from public.students s
    where s.tenant_id = p_tenant_id
      and s.deleted_at is null
      and (
        s.student_id = normalized_student_id
        or lower(s.username) = lower(normalized_username)
      )
  ) then
    raise exception 'Borrower identity already exists' using errcode = '23505';
  end if;

  return query
  insert into public.students as s (tenant_id, username, student_id)
  values (p_tenant_id, normalized_username, normalized_student_id)
  returning s.id, s.tenant_id, s.username, s.student_id;
end;
$$;

revoke all on function public.create_student_identity(uuid, text, text) from public;
revoke all on function public.create_student_identity(uuid, text, text) from anon;
revoke all on function public.create_student_identity(uuid, text, text) from authenticated;
grant execute on function public.create_student_identity(uuid, text, text) to service_role;
