-- Rebuilds schema-only DDL for the application schemas from the system
-- catalog. Run read-only against the staging project through the Supabase
-- Management API (`npm run test:security:baseline`); the result is
-- tests/security/postgres/baseline/schema.sql.
--
-- Why not pg_dump: staging/production enforce a database network allow-list,
-- while the Management API query endpoint is reachable. Why not the migration
-- chain: production predates supabase/migrations (legacy SQL was applied first)
-- and several migrations were applied out of filename order, so replaying the
-- files from an empty database fails.
--
-- Emits no table rows. Ordering: roles, schemas, extensions, tables (columns
-- only), functions (bodies unchecked), defaults, keys/checks, foreign keys,
-- indexes, materialized views, RLS, policies, triggers, privileges.
with
ns as (
  select oid, nspname
  from pg_namespace
  where nspname in ('public', 'private', 'better_auth')
),
ext_dep as (
  select classid, objid from pg_depend where deptype = 'e'
),
tbl as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity,
    c.relforcerowsecurity, c.relacl
  from pg_class c
  join ns n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'm')
    and not exists (
      select 1 from ext_dep d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid
    )
),
fn as (
  select p.oid, n.nspname, p.proacl
  from pg_proc p
  join ns n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and not exists (
      select 1 from ext_dep d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid
    )
),
standard_roles(rolname) as (
  values ('postgres'), ('anon'), ('authenticated'), ('service_role'),
    ('supabase_admin'), ('supabase_auth_admin'), ('authenticator'),
    ('supabase_storage_admin'), ('dashboard_user'), ('pgbouncer')
),
referenced_roles as (
  select distinct pg_get_userbyid(acl.grantee) as rolname
  from tbl t, aclexplode(t.relacl) acl
  where acl.grantee <> 0
  union
  select distinct pg_get_userbyid(acl.grantee)
  from fn f, aclexplode(f.proacl) acl
  where acl.grantee <> 0
  union
  select distinct pg_get_userbyid(acl.grantee)
  from pg_namespace n, aclexplode(n.nspacl) acl
  where n.oid in (select oid from ns) and acl.grantee <> 0
  union
  select distinct pg_get_userbyid(r)
  from pg_policy pol
  join tbl t on t.oid = pol.polrelid,
  unnest(pol.polroles) r
  where r <> 0
),
migrations as (
  select coalesce(
    string_agg(
      '--   ' || version || case
        when coalesce(name, '') = '' then ''
        else ' ' || name
      end,
      E'\n' order by version
    ),
    '--   (none recorded)'
  ) as listing
  from supabase_migrations.schema_migrations
),
parts(ord, sub, ddl) as (
  select 0, '',
    '-- GENERATED FILE: do not edit by hand. Regenerate with' || E'\n' ||
    '-- `npm run test:security:baseline` (see generate-baseline.sql).' || E'\n' ||
    '-- Schema-only DDL for public, private and better_auth; contains no rows.' || E'\n' ||
    '-- Source: staging project; generated ' ||
      to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || E'\n' ||
    '-- Applied migrations captured by this baseline:' || E'\n' ||
    (select listing from migrations) || E'\n' ||
    '-- END MIGRATIONS' || E'\n\n' ||
    'set check_function_bodies = off;' || E'\n' ||
    'set client_min_messages = warning;'

  union all
  select 1, r.rolname,
    format(
      'do $role$ begin if not exists (select 1 from pg_roles where rolname = %L) then create role %I nologin; end if; end $role$;',
      r.rolname, r.rolname
    )
  from referenced_roles r
  where r.rolname not in (select rolname from standard_roles)

  union all
  select 2, n.nspname, format('create schema if not exists %I;', n.nspname)
  from ns n
  where n.nspname <> 'public'

  union all
  select 3, e.extname,
    format(
      'create extension if not exists %I with schema %I;',
      e.extname, en.nspname
    )
  from pg_extension e
  join pg_namespace en on en.oid = e.extnamespace
  where e.extname in ('pgcrypto', 'uuid-ossp', 'pg_trgm')

  union all
  select 4, t.nspname || '.' || t.relname,
    format(
      E'create table %I.%I (\n%s\n);',
      t.nspname, t.relname,
      (
        select string_agg(
          format(
            '  %I %s%s',
            a.attname,
            format_type(a.atttypid, a.atttypmod),
            case when a.attnotnull then ' not null' else '' end
          ),
          E',\n' order by a.attnum
        )
        from pg_attribute a
        where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
      )
    )
  from tbl t
  where t.relkind in ('r', 'p')

  union all
  select 5, f.oid::regprocedure::text, pg_get_functiondef(f.oid) || ';'
  from fn f

  union all
  select 6, t.nspname || '.' || t.relname || '.' || a.attname,
    format(
      'alter table only %I.%I alter column %I set default %s;',
      t.nspname, t.relname, a.attname, pg_get_expr(d.adbin, d.adrelid)
    )
  from tbl t
  join pg_attribute a on a.attrelid = t.oid
  join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped

  union all
  select case when co.contype = 'f' then 8 else 7 end,
    t.nspname || '.' || t.relname || '.' || co.conname,
    format(
      'alter table only %I.%I add constraint %I %s;',
      t.nspname, t.relname, co.conname, pg_get_constraintdef(co.oid)
    )
  from tbl t
  join pg_constraint co on co.conrelid = t.oid
  where co.contype in ('p', 'u', 'c', 'x', 'f')
    and t.relkind in ('r', 'p')

  union all
  select case when t.relkind = 'm' then 11 else 9 end,
    i.indexrelid::regclass::text,
    pg_get_indexdef(i.indexrelid) || ';'
  from tbl t
  join pg_index i on i.indrelid = t.oid
  where not exists (
    select 1 from pg_constraint co
    where co.conindid = i.indexrelid and co.contype in ('p', 'u', 'x')
  )

  union all
  select 10, t.nspname || '.' || t.relname,
    format(
      E'create materialized view %I.%I as\n%s\nwith no data;',
      t.nspname, t.relname, rtrim(rtrim(pg_get_viewdef(t.oid)), ';')
    )
  from tbl t
  where t.relkind = 'm'

  union all
  select 12, t.nspname || '.' || t.relname,
    format('alter table %I.%I enable row level security;', t.nspname, t.relname)
  from tbl t
  where t.relrowsecurity

  union all
  select 12, t.nspname || '.' || t.relname || '.force',
    format('alter table %I.%I force row level security;', t.nspname, t.relname)
  from tbl t
  where t.relforcerowsecurity

  union all
  select 13, t.nspname || '.' || t.relname || '.' || pol.polname,
    format(
      'create policy %I on %I.%I as %s for %s to %s%s%s;',
      pol.polname, t.nspname, t.relname,
      case when pol.polpermissive then 'permissive' else 'restrictive' end,
      case pol.polcmd
        when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
        when 'd' then 'delete' else 'all'
      end,
      (
        select string_agg(
          case when r = 0 then 'public' else quote_ident(pg_get_userbyid(r)) end,
          ', ' order by r
        )
        from unnest(pol.polroles) r
      ),
      case when pol.polqual is not null
        then ' using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')'
        else '' end,
      case when pol.polwithcheck is not null
        then ' with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')'
        else '' end
    )
  from pg_policy pol
  join tbl t on t.oid = pol.polrelid

  union all
  select 14, t.nspname || '.' || t.relname || '.' || tg.tgname,
    pg_get_triggerdef(tg.oid) || ';'
  from pg_trigger tg
  join tbl t on t.oid = tg.tgrelid
  where not tg.tgisinternal

  -- Privileges: objects created locally inherit the image's default ACLs, so
  -- reset each object to owner-only and replay the staging ACL exactly.
  union all
  select 15, n.nspname,
    format(
      'revoke all on schema %I from public, anon, authenticated, service_role;',
      n.nspname
    )
  from ns n

  union all
  select 16, n.nspname || '.' || pg_get_userbyid(acl.grantee) || '.' || acl.privilege_type,
    format(
      'grant %s on schema %I to %s%s;',
      acl.privilege_type, n.nspname,
      case when acl.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(acl.grantee)) end,
      case when acl.is_grantable then ' with grant option' else '' end
    )
  from pg_namespace n, aclexplode(n.nspacl) acl
  where n.oid in (select oid from ns)
    and acl.grantee <> n.nspowner

  union all
  select 17, t.nspname || '.' || t.relname,
    format(
      'revoke all on table %I.%I from public, anon, authenticated, service_role;',
      t.nspname, t.relname
    )
  from tbl t

  union all
  select 18, t.nspname || '.' || t.relname || '.' || pg_get_userbyid(acl.grantee) || '.' || acl.privilege_type,
    format(
      'grant %s on table %I.%I to %s%s;',
      acl.privilege_type, t.nspname, t.relname,
      case when acl.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(acl.grantee)) end,
      case when acl.is_grantable then ' with grant option' else '' end
    )
  from tbl t, aclexplode(t.relacl) acl
  where acl.grantee <> (select relowner from pg_class where oid = t.oid)

  union all
  select 19, f.oid::regprocedure::text,
    format(
      'revoke all on function %s from public, anon, authenticated, service_role;',
      f.oid::regprocedure
    )
  from fn f

  union all
  -- A NULL proacl means the built-in default: EXECUTE granted to PUBLIC.
  select 20, f.oid::regprocedure::text || '.public-default',
    format('grant execute on function %s to public;', f.oid::regprocedure)
  from fn f
  where f.proacl is null

  union all
  select 20, f.oid::regprocedure::text || '.' || pg_get_userbyid(acl.grantee),
    format(
      'grant %s on function %s to %s%s;',
      acl.privilege_type, f.oid::regprocedure,
      case when acl.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(acl.grantee)) end,
      case when acl.is_grantable then ' with grant option' else '' end
    )
  from fn f, aclexplode(f.proacl) acl
  where acl.grantee <> (select proowner from pg_proc where oid = f.oid)
)
select string_agg(ddl, E'\n\n' order by ord, sub) || E'\n' as baseline
from parts;
