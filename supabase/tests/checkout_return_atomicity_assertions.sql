\set ON_ERROR_STOP on

do $$
declare
  function_oid oid := to_regprocedure(
    'public.apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid)'
  );
  function_definition text;
begin
  if function_oid is null then
    raise exception 'atomic online checkout/return function missing';
  end if;

  if not exists (
    select 1 from pg_proc where oid = function_oid and prosecdef
  ) then
    raise exception 'online checkout/return function must be security definer';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can call the service-role-only transition function';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.apply_checkout_return_item(uuid,uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service role cannot call the online transition function';
  end if;

  function_definition := lower(pg_get_functiondef(function_oid));
  if position('for update' in function_definition) = 0
     or position('insert into public.item_logs' in function_definition) = 0
     or position('on conflict (workspace_id, item_id, action_type, operation_id)' in function_definition) = 0
     or position('has_existing_operation' in function_definition) = 0
     or position('actor_role <> ''workspace_admin''' in function_definition) = 0 then
    raise exception 'online checkout/return function is missing locking, audit, idempotency, or role checks';
  end if;
  if position('  v_operation_id text :=' in function_definition) = 0
     or position('  operation_id text :=' in function_definition) > 0 then
    raise exception 'online checkout/return function must avoid ambiguous operation_id variable references';
  end if;
end $$;

select 'online checkout/return atomicity assertions passed' as result;
