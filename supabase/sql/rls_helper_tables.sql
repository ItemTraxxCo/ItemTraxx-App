create table if not exists public.rate_limits (
  tenant_id uuid not null,
  actor_id uuid not null,
  scope text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  primary key (tenant_id, actor_id, scope, window_start),
  constraint rate_limits_count_nonnegative check (count >= 0)
);

create table if not exists public.rate_limits_prelogin (
  rate_key text not null,
  scope text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  primary key (rate_key, scope, window_start),
  constraint rate_limits_prelogin_count_nonnegative check (count >= 0)
);

alter table if exists public.data_retention_policies enable row level security;
alter table if exists public.rate_limits enable row level security;
alter table if exists public.rate_limits_prelogin enable row level security;

drop policy if exists "deny_all_data_retention_policies" on public.data_retention_policies;
create policy "deny_all_data_retention_policies"
  on public.data_retention_policies
  for all
  to public
  using (false)
  with check (false);

drop policy if exists "deny_all_rate_limits" on public.rate_limits;
create policy "deny_all_rate_limits"
  on public.rate_limits
  for all
  to public
  using (false)
  with check (false);

drop policy if exists "deny_all_rate_limits_prelogin" on public.rate_limits_prelogin;
create policy "deny_all_rate_limits_prelogin"
  on public.rate_limits_prelogin
  for all
  to public
  using (false)
  with check (false);
