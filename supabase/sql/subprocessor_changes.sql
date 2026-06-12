-- Tracks subprocessor change events and associated customer notice delivery.

create table if not exists public.subprocessor_changes (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  change_type text not null,
  effective_date date not null,
  description text,
  notice_sent_at timestamptz,
  objection_deadline date,
  recipients_count int not null default 0,
  status text not null default 'pending',
  created_by_email text,
  created_at timestamptz not null default now()
);

alter table public.subprocessor_changes
  drop constraint if exists subprocessor_changes_change_type_check;
alter table public.subprocessor_changes
  add constraint subprocessor_changes_change_type_check
  check (change_type in ('added', 'replaced', 'removed'));

alter table public.subprocessor_changes
  drop constraint if exists subprocessor_changes_status_check;
alter table public.subprocessor_changes
  add constraint subprocessor_changes_status_check
  check (status in ('pending', 'sent', 'failed'));

alter table public.subprocessor_changes enable row level security;

-- Super admins with an active privileged step-up may read records.
-- Writes are performed exclusively by the service role via edge functions.
drop policy if exists "super_admin_select_subprocessor_changes"
  on public.subprocessor_changes;

create policy "super_admin_select_subprocessor_changes"
  on public.subprocessor_changes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
    and public.has_recent_privileged_step_up('super_admin')
  );

create index if not exists idx_subprocessor_changes_created_at
  on public.subprocessor_changes (created_at desc);

-- Partial index used to surface notices whose objection window is still open.
create index if not exists idx_subprocessor_changes_objection_deadline
  on public.subprocessor_changes (objection_deadline)
  where objection_deadline is not null;
