-- Run after the migration in an isolated Supabase test database.
begin;
do $$
declare
  ws uuid;
begin
  select id into ws from public.workspaces limit 1;
  if ws is null then raise exception 'A workspace fixture is required'; end if;
  if not public.sgw_key_lifecycle_transition(ws, 'claim_provision') then raise exception 'first claim failed'; end if;
  if public.sgw_key_lifecycle_transition(ws, 'claim_provision') then raise exception 'duplicate claim succeeded'; end if;
  if public.sgw_key_lifecycle_transition(ws, 'is_active') then raise exception 'pending key is active'; end if;
  if not public.sgw_key_lifecycle_transition(ws, 'finish_provision') then raise exception 'activation failed'; end if;
  if not public.sgw_key_lifecycle_transition(ws, 'claim_revoke') then raise exception 'revocation claim failed'; end if;
  if public.sgw_key_lifecycle_transition(ws, 'is_active') then raise exception 'revoking key is active'; end if;
  if not public.sgw_key_lifecycle_transition(ws, 'finish_revoke') then raise exception 'revocation completion failed'; end if;
  if public.sgw_key_lifecycle_transition(ws, 'claim_provision') then raise exception 'revoked key re-created'; end if;
  if has_function_privilege('anon', 'public.sgw_key_lifecycle_transition(uuid,text)', 'execute') then raise exception 'anon can call lifecycle'; end if;
  if has_function_privilege('authenticated', 'public.sgw_key_lifecycle_transition(uuid,text)', 'execute') then raise exception 'authenticated can call lifecycle'; end if;
end;
$$;
rollback;
