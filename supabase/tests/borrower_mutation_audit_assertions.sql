\set ON_ERROR_STOP on

do $$
declare
  target record;
  function_oid oid;
  function_definition text;
  audit_position integer;
  mutation_position integer;
begin
  for target in
    select * from (values
      (
        'public.create_borrower_identity(uuid,text,text,text,uuid[],uuid)',
        'insert into public.borrowers',
        'insert into public.borrower_access_grants'
      ),
      (
        'public.archive_borrower_with_audit(uuid,uuid,uuid)',
        'update public.borrowers',
        null::text
      ),
      (
        'public.restore_borrower_with_audit(uuid,uuid,uuid)',
        'update public.borrowers',
        null::text
      ),
      (
        'public.update_borrower_access_with_audit(uuid,uuid,uuid,text,uuid[])',
        'update public.borrowers',
        'delete from public.borrower_access_grants'
      )
    ) as required_functions(signature, first_mutation, second_mutation)
  loop
    function_oid := to_regprocedure(target.signature);
    if function_oid is null then
      raise exception 'required borrower audit function missing: %', target.signature;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_proc where oid = function_oid and prosecdef
    ) then
      raise exception 'borrower audit function must be SECURITY DEFINER: %', target.signature;
    end if;
    if has_function_privilege('authenticated', function_oid, 'EXECUTE') then
      raise exception 'authenticated users can call the service-role-only function: %', target.signature;
    end if;
    if not has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'service_role cannot call the borrower audit function: %', target.signature;
    end if;

    function_definition := lower(pg_catalog.pg_get_functiondef(function_oid));
    audit_position := position('insert into public.admin_audit_logs' in function_definition);
    mutation_position := position(target.first_mutation in function_definition);
    if audit_position = 0 or mutation_position = 0 or audit_position < mutation_position then
      raise exception 'borrower mutation and audit insert must share the function transaction: %', target.signature;
    end if;
    if target.second_mutation is not null then
      mutation_position := position(target.second_mutation in function_definition);
      if mutation_position = 0 or audit_position < mutation_position then
        raise exception 'borrower grants and audit insert must share the function transaction: %', target.signature;
      end if;
    end if;
  end loop;

  function_oid := to_regprocedure(
    'public.update_borrower_access_with_audit(uuid,uuid,uuid,text,uuid[])'
  );
  function_definition := lower(pg_catalog.pg_get_functiondef(function_oid));
  if position('insert into public.borrower_access_grants' in function_definition) = 0
     or position('p_actor_id' in function_definition) = 0
     or position('before' in function_definition) = 0
     or position('after' in function_definition) = 0 then
    raise exception 'access change must restore grants and record actor-attributed before/after state';
  end if;

  function_oid := to_regprocedure(
    'public.create_borrower_identity(uuid,text,text,text,uuid[],uuid)'
  );
  function_definition := lower(pg_catalog.pg_get_functiondef(function_oid));
  if position('p_granted_by is null' in function_definition) = 0
     or position('''borrower_create''' in function_definition) = 0
     or position('profile_ids' in function_definition) = 0 then
    raise exception 'borrower creation must audit the verified actor and access grant details';
  end if;
end $$;

select 'borrower mutation audit assertions passed' as result;
