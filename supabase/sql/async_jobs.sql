create table if not exists public.async_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'completed', 'failed')
  ),
  payload jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  worker_id uuid null,
  started_at timestamptz null,
  completed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists async_jobs_status_run_after_idx
  on public.async_jobs (status, run_after, priority, created_at);
create index if not exists async_jobs_worker_idx
  on public.async_jobs (worker_id, status);
create index if not exists async_jobs_created_idx
  on public.async_jobs (created_at desc);

create or replace function public.touch_async_job_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_async_jobs_updated_at on public.async_jobs;
create trigger trg_async_jobs_updated_at
before update on public.async_jobs
for each row
execute function public.touch_async_job_updated_at();

create or replace function public.enqueue_async_job(
  p_job_type text,
  p_payload jsonb,
  p_priority integer default 100,
  p_run_after timestamptz default now(),
  p_max_attempts integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  insert into public.async_jobs (
    job_type,
    payload,
    priority,
    run_after,
    max_attempts
  )
  values (
    p_job_type,
    coalesce(p_payload, '{}'::jsonb),
    greatest(0, coalesce(p_priority, 100)),
    coalesce(p_run_after, now()),
    greatest(1, coalesce(p_max_attempts, 5))
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

create or replace function public.claim_async_jobs(
  p_worker_id uuid,
  p_limit integer default 20
)
returns setof public.async_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select j.id
    from public.async_jobs j
    where j.status = 'queued'
      and j.run_after <= now()
    order by j.priority asc, j.created_at asc
    limit greatest(1, coalesce(p_limit, 20))
    for update skip locked
  )
  update public.async_jobs target
  set
    status = 'processing',
    worker_id = p_worker_id,
    attempts = target.attempts + 1,
    started_at = now(),
    completed_at = null
  where target.id in (select id from picked)
  returning target.*;
end;
$$;

alter table public.async_jobs enable row level security;

drop policy if exists "super_admin_select_async_jobs" on public.async_jobs;
create policy "super_admin_select_async_jobs"
  on public.async_jobs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'super_admin'
    )
  );
