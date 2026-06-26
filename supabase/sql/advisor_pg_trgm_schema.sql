-- ITX-46: move pg_trgm out of the public schema (advisor 0014_extension_in_public).
--
-- REVIEW BEFORE APPLYING. Existing trigram indexes keep working (they store the
-- opclass OID), but any query using bare trigram operators/functions (`%`,
-- `similarity()`, `word_similarity()`) needs `extensions` on the role
-- search_path. Supabase includes `extensions` in the default search_path, so
-- this is normally safe — but verify trigram search still works in staging
-- first, since pg_trgm backs barcode/name lookups.

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
