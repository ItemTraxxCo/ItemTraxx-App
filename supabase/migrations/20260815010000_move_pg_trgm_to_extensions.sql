-- Keep the pg_trgm extension outside public while preserving existing indexes.
-- Supabase includes the extensions schema in its default search_path, and the
-- explicit grants keep trigram operators/functions available to app roles.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
alter extension pg_trgm set schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;
