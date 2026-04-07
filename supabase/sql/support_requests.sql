create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  requester_name text not null,
  reply_email text not null,
  subject text not null,
  category text not null check (category in ('general', 'bug', 'billing', 'access', 'feature', 'other')),
  message text not null,
  source text not null default 'public_form' check (source in ('public_form')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'spam')),
  assigned_to uuid null references auth.users(id) on delete set null,
  internal_notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_request_attachments (
  id uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests(id) on delete cascade,
  storage_bucket text not null default 'support-request-attachments',
  storage_path text not null unique,
  original_filename text,
  stored_filename text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.support_request_events (
  id uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests(id) on delete cascade,
  actor_id uuid null references auth.users(id) on delete set null,
  actor_email text null,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_requests_created_idx
  on public.support_requests (created_at desc);

create index if not exists support_requests_status_created_idx
  on public.support_requests (status, created_at desc);

create index if not exists support_request_attachments_request_idx
  on public.support_request_attachments (support_request_id, created_at asc);

create index if not exists support_request_events_request_idx
  on public.support_request_events (support_request_id, created_at asc);

create or replace function public.touch_support_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_support_requests_updated_at on public.support_requests;
create trigger trg_support_requests_updated_at
before update on public.support_requests
for each row
execute function public.touch_support_requests_updated_at();

alter table public.support_requests enable row level security;
alter table public.support_request_attachments enable row level security;
alter table public.support_request_events enable row level security;

drop policy if exists "super_admin_select_support_requests" on public.support_requests;
create policy "super_admin_select_support_requests"
  on public.support_requests
  for select
  to authenticated
  using (public.current_user_role() = 'super_admin');

drop policy if exists "super_admin_update_support_requests" on public.support_requests;
create policy "super_admin_update_support_requests"
  on public.support_requests
  for update
  to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists "super_admin_select_support_request_attachments" on public.support_request_attachments;
create policy "super_admin_select_support_request_attachments"
  on public.support_request_attachments
  for select
  to authenticated
  using (public.current_user_role() = 'super_admin');

drop policy if exists "super_admin_select_support_request_events" on public.support_request_events;
create policy "super_admin_select_support_request_events"
  on public.support_request_events
  for select
  to authenticated
  using (public.current_user_role() = 'super_admin');

drop policy if exists "super_admin_insert_support_request_events" on public.support_request_events;
create policy "super_admin_insert_support_request_events"
  on public.support_request_events
  for insert
  to authenticated
  with check (
    public.current_user_role() = 'super_admin'
    and actor_id = auth.uid()
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-request-attachments',
  'support-request-attachments',
  false,
  4194304,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
