-- This table contains lifecycle metadata only, never wrapped or plaintext keys.
-- Rows are intentionally retained after workspace deletion to prevent reuse.
create table public.sgw_workspace_key_lifecycle (
  workspace_id uuid primary key,
  state text not null check (state in ('provisioning', 'active', 'revoking', 'revoked')),
  updated_at timestamptz not null default now()
);
alter table public.sgw_workspace_key_lifecycle enable row level security;
revoke all on public.sgw_workspace_key_lifecycle from public, anon, authenticated;
grant select, insert, update on public.sgw_workspace_key_lifecycle to service_role;

create function public.sgw_key_lifecycle_transition(p_workspace_id uuid, p_action text)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare changed integer;
begin
  if p_action = 'claim_provision' then
    insert into public.sgw_workspace_key_lifecycle (workspace_id, state)
    select p_workspace_id, 'provisioning'
    where exists (select 1 from public.workspaces where id = p_workspace_id)
    on conflict (workspace_id) do nothing;
  elsif p_action = 'finish_provision' then
    update public.sgw_workspace_key_lifecycle set state = 'active', updated_at = now()
    where workspace_id = p_workspace_id and state = 'provisioning';
  elsif p_action = 'claim_revoke' then
    update public.sgw_workspace_key_lifecycle set state = 'revoking', updated_at = now()
    where workspace_id = p_workspace_id and state = 'active';
  elsif p_action = 'finish_revoke' then
    update public.sgw_workspace_key_lifecycle set state = 'revoked', updated_at = now()
    where workspace_id = p_workspace_id and state = 'revoking';
  elsif p_action = 'is_active' then
    return exists (select 1 from public.sgw_workspace_key_lifecycle where workspace_id = p_workspace_id and state = 'active');
  else
    raise exception 'Invalid lifecycle action';
  end if;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.sgw_key_lifecycle_transition(uuid, text) from public, anon, authenticated;
grant execute on function public.sgw_key_lifecycle_transition(uuid, text) to service_role;
