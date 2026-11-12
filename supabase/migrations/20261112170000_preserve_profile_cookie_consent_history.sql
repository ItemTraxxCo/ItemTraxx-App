begin;

-- The prior staging migration created a unique profile/version index. A person
-- may accept or change preferences from multiple browser subjects, so preserve
-- every record and keep this index non-unique for profile lookups.
drop index if exists public.cookie_consent_profile_version_uidx;

create index if not exists cookie_consent_profile_version_idx
  on public.cookie_consent_records (profile_id, consent_version)
  where profile_id is not null;

commit;
